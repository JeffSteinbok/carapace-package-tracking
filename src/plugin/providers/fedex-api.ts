/**
 * FedEx API status provider.
 *
 * Uses the FedEx Track API v1 (OAuth2 client credentials) instead of
 * scraping — more reliable since FedEx blocks headless browsers.
 *
 * Env vars:
 *   FEDEX_API_KEY    — API key (client ID)
 *   FEDEX_API_SECRET — API secret (client secret)
 *   FEDEX_API_URL    — Base URL (default: https://apis.fedex.com)
 */

import { request as httpsRequest } from "node:https";
import type { CarrierStatusProvider, CarrierStatusResult } from "../../lib/status.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getConfig() {
  const apiKey = process.env.FEDEX_API_KEY;
  const apiSecret = process.env.FEDEX_API_SECRET;
  const baseUrl = process.env.FEDEX_API_URL ?? "https://apis.fedex.com";

  if (!apiKey || !apiSecret) {
    return null;
  }

  return { apiKey, apiSecret, baseUrl };
}

// ---------------------------------------------------------------------------
// OAuth2 token cache
// ---------------------------------------------------------------------------

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const config = getConfig();
  if (!config) throw new Error("FEDEX_API_KEY and FEDEX_API_SECRET are required");

  const body = `grant_type=client_credentials&client_id=${encodeURIComponent(config.apiKey)}&client_secret=${encodeURIComponent(config.apiSecret)}`;

  const response = await httpPost(`${config.baseUrl}/oauth/token`, body, {
    "Content-Type": "application/x-www-form-urlencoded",
  });

  const data = JSON.parse(response) as {
    access_token: string;
    expires_in: number;
  };

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000 - TOKEN_REFRESH_BUFFER_MS,
  };

  return tokenCache.accessToken;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function httpPost(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body).toString(),
        },
        timeout: 15_000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
          } else {
            resolve(data);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("FedEx API request timed out"));
    });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// FedEx Track API types (subset)
// ---------------------------------------------------------------------------

interface FedExScanLocation {
  city?: string;
  stateOrProvinceCode?: string;
  countryCode?: string;
}

interface FedExStatusDetail {
  code?: string;
  statusByLocale?: string;
  description?: string;
  scanLocation?: FedExScanLocation;
}

interface FedExDateTime {
  type: string;
  dateTime?: string;
}

interface FedExAddress {
  city?: string;
  stateOrProvinceCode?: string;
  countryCode?: string;
}

interface FedExContactAddress {
  address?: FedExAddress;
}

interface FedExServiceDetail {
  description?: string;
  shortDescription?: string;
  type?: string;
}

interface FedExTrackResult {
  trackingNumberInfo?: {
    trackingNumber?: string;
    carrierCode?: string;
  };
  latestStatusDetail?: FedExStatusDetail;
  dateAndTimes?: FedExDateTime[];
  shipperInformation?: FedExContactAddress;
  recipientInformation?: FedExContactAddress;
  serviceDetail?: FedExServiceDetail;
  error?: { code?: string; message?: string };
}

interface FedExCompleteTrackResult {
  trackingNumber: string;
  trackResults?: FedExTrackResult[];
}

interface FedExTrackResponse {
  output?: {
    completeTrackResults?: FedExCompleteTrackResult[];
  };
  errors?: Array<{ code?: string; message?: string }>;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function formatLocation(loc?: FedExScanLocation): string | null {
  if (!loc) return null;
  const parts = [loc.city, loc.stateOrProvinceCode].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function formatAddress(addr?: FedExAddress): string | null {
  if (!addr) return null;
  const parts = [addr.city, addr.stateOrProvinceCode].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function findDate(
  dates: FedExDateTime[] | undefined,
  ...types: string[]
): string | null {
  if (!dates) return null;
  for (const type of types) {
    const found = dates.find((d) => d.type === type);
    if (found?.dateTime) return found.dateTime;
  }
  return null;
}

function parseTrackResult(
  trackingNumber: string,
  result: FedExTrackResult,
): CarrierStatusResult {
  const status = result.latestStatusDetail;
  const delivered = status?.code === "DL";

  const lastUpdate = delivered
    ? findDate(result.dateAndTimes, "ACTUAL_DELIVERY")
    : null;

  const estimatedDelivery = findDate(
    result.dateAndTimes,
    "ESTIMATED_DELIVERY",
    "COMMITMENT",
  );

  const location = formatLocation(status?.scanLocation);
  const description = [status?.description, location]
    .filter(Boolean)
    .join(" — ");

  return {
    tracking_number: trackingNumber,
    carrier: "FedEx",
    status: status?.statusByLocale ?? status?.description ?? "Unknown",
    delivered,
    last_update: lastUpdate,
    description: description || null,
    estimated_delivery: estimatedDelivery,
    service_type: result.serviceDetail?.description ?? null,
    ship_from: formatAddress(result.shipperInformation?.address),
    ship_to: formatAddress(result.recipientInformation?.address),
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const fedexApiProvider: CarrierStatusProvider = {
  name: "FedEx API",
  carriers: ["FedEx", "FEDEX"],

  async getStatus(
    trackingNumber: string,
  ): Promise<CarrierStatusResult | null> {
    const config = getConfig();
    if (!config) {
      // No API keys — fall through to Camoufox provider
      return null;
    }

    const token = await getAccessToken();

    const requestBody = JSON.stringify({
      trackingInfo: [
        {
          trackingNumberInfo: {
            trackingNumber,
          },
        },
      ],
      includeDetailedScans: false,
    });

    const responseText = await httpPost(
      `${config.baseUrl}/track/v1/trackingnumbers`,
      requestBody,
      {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-locale": "en_US",
      },
    );

    const response = JSON.parse(responseText) as FedExTrackResponse;

    if (response.errors?.length) {
      const err = response.errors[0];
      console.error(`[fedex-api-provider] API error: ${err.code} — ${err.message}`);
      return null;
    }

    const trackResult =
      response.output?.completeTrackResults?.[0]?.trackResults?.[0];
    if (!trackResult) return null;

    if (trackResult.error) {
      console.error(
        `[fedex-api-provider] tracking error: ${trackResult.error.code} — ${trackResult.error.message}`,
      );
      return null;
    }

    return parseTrackResult(trackingNumber, trackResult);
  },
};
