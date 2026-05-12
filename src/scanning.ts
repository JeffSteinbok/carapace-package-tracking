/**
 * Text scanning for tracking numbers and URL extraction.
 */

import { CARRIER_PATTERNS, detectCarrier, getTrackingUrl } from "./carriers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrackingMatch {
  tracking_number: string;
  carrier: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Text scanning
// ---------------------------------------------------------------------------

export function scanTextForTrackingNumbers(text: string): TrackingMatch[] {
  if (!text) return [];

  const upper = text.toUpperCase();
  const results: TrackingMatch[] = [];
  const seen = new Set<string>();

  for (const carrier of CARRIER_PATTERNS) {
    for (const pattern of carrier.patterns) {
      const re = new RegExp(pattern, "gm");
      let match: RegExpExecArray | null;
      while ((match = re.exec(upper)) !== null) {
        const num = match[0];
        if (seen.has(num)) continue;
        seen.add(num);
        results.push({
          tracking_number: num,
          carrier: carrier.name,
          url: carrier.url_template.replace("{tracking_number}", num),
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// URL extraction rules
// ---------------------------------------------------------------------------

export interface UrlExtractionRule {
  name: string;
  url_pattern: string;
  param_patterns: string[];
  carrier_from_path: boolean;
}

export const URL_EXTRACTION_RULES: UrlExtractionRule[] = [
  {
    name: "Narvar",
    url_pattern: "https?://[^\\s\"'<>]*narvar\\.com/[^\\s\"'<>]*",
    param_patterns: [
      "[?&]tracking_numbers?=([A-Z0-9]{10,30})",
      "[?&]tracking=([A-Z0-9]{10,30})",
    ],
    carrier_from_path: true,
  },
  {
    name: "UPS",
    url_pattern: "https?://[^\\s\"'<>]*ups\\.com/track[^\\s\"'<>]*",
    param_patterns: [
      "[?&]tracknum=(1Z[A-Z0-9]{16})",
      "[?&]InquiryNumber1=(1Z[A-Z0-9]{16})",
    ],
    carrier_from_path: false,
  },
  {
    name: "FedEx",
    url_pattern:
      "https?://[^\\s\"'<>]*fedex\\.com/[^\\s\"'<>]*track[^\\s\"'<>]*",
    param_patterns: [
      "[?&]trknbr=(\\d{12,22})",
      "[?&]trackingnumber=(\\d{12,22})",
      "[?&]trackingNumber=(\\d{12,22})",
    ],
    carrier_from_path: false,
  },
  {
    name: "USPS",
    url_pattern: "https?://[^\\s\"'<>]*usps\\.com/[^\\s\"'<>]*",
    param_patterns: [
      "[?&]qtc_tLabels\\d?=(\\d{20,22})",
      "[?&]tLabels=(\\d{20,22})",
    ],
    carrier_from_path: false,
  },
  {
    name: "Amazon",
    url_pattern:
      "https?://[^\\s\"'<>]*amazon\\.com/[^\\s\"'<>]*(?:track|order)[^\\s\"'<>]*",
    param_patterns: ["[?&]tracking-id=(TBA[0-9]{12}US)"],
    carrier_from_path: false,
  },
];

const NARVAR_CARRIER_PATH_MAP: Record<string, string> = {
  ups: "UPS",
  fedex: "FedEx",
  usps: "USPS",
  dhl: "DHL",
  ontrac: "OnTrac",
  amazon: "Amazon",
};

function carrierFromNarvarUrl(url: string): string | null {
  const lower = url.toLowerCase();
  for (const [seg, carrier] of Object.entries(NARVAR_CARRIER_PATH_MAP)) {
    if (
      lower.includes(`/tracking/${seg}`) ||
      lower.includes(`/tracking/${seg}?`)
    ) {
      return carrier;
    }
  }
  return null;
}

export function extractTrackingFromUrls(text: string): TrackingMatch[] {
  if (!text) return [];

  const results: TrackingMatch[] = [];
  const seen = new Set<string>();

  for (const rule of URL_EXTRACTION_RULES) {
    const urlRe = new RegExp(rule.url_pattern, "gi");
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlRe.exec(text)) !== null) {
      const url = urlMatch[0];
      const carrierHint = rule.carrier_from_path
        ? carrierFromNarvarUrl(url) ?? rule.name
        : rule.name;

      for (const paramPattern of rule.param_patterns) {
        const paramMatch = new RegExp(paramPattern, "i").exec(url);
        if (!paramMatch) continue;
        const trackingNum = paramMatch[1].toUpperCase();
        if (seen.has(trackingNum)) break;
        seen.add(trackingNum);
        const carrier = carrierHint || detectCarrier(trackingNum) || "Unknown";
        const trackingUrl = getTrackingUrl(trackingNum, carrier) ?? url;
        results.push({
          tracking_number: trackingNum,
          carrier,
          url: trackingUrl,
        });
        break;
      }
    }
  }

  return results;
}
