/**
 * Carrier detection patterns and URL generation.
 *
 * Supports UPS, Amazon, FedEx, and USPS for detection, plus URL-only
 * support for carriers whose numbers are too ambiguous to detect from text
 * (DHL, OnTrac, LaserShip).
 */

// ---------------------------------------------------------------------------
// Carrier detection patterns (in order of specificity)
// ---------------------------------------------------------------------------

export interface CarrierPattern {
  name: string;
  patterns: string[];
  url_template: string;
}

export const CARRIER_PATTERNS: CarrierPattern[] = [
  {
    name: "UPS",
    patterns: ["\\b1Z[A-Z0-9]{16}\\b"],
    url_template: "https://www.ups.com/track?tracknum={tracking_number}",
  },
  {
    name: "Amazon",
    patterns: ["\\bTBA[0-9]{12}US\\b"],
    url_template: "https://track.amazon.com/tracking/{tracking_number}",
  },
  {
    name: "FedEx",
    patterns: ["\\b[0-9]{12}\\b", "\\b[0-9]{15}\\b", "\\b[0-9]{20}\\b"],
    url_template:
      "https://www.fedex.com/fedextrack/?trknbr={tracking_number}",
  },
  {
    name: "USPS",
    patterns: [
      "\\b420[0-9]{31}\\b",      // 34-digit Click-N-Ship (420 + ZIP + 22-digit tracking)
      "\\b94[0-9]{20}\\b",
      "\\b9[2-5][0-9]{20}\\b",
      "\\b[0-9]{20,22}\\b",
    ],
    url_template:
      "https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1={tracking_number}",
  },
];

export interface ValidationPattern {
  name: string;
  patterns: string[];
}

export const VALIDATION_PATTERNS: ValidationPattern[] = [
  { name: "UPS", patterns: ["^1Z[A-Z0-9]{16}$"] },
  { name: "Amazon", patterns: ["^TBA[0-9]{12}US$"] },
  {
    name: "FedEx",
    patterns: ["^[0-9]{12}$", "^[0-9]{15}$", "^[0-9]{20}$"],
  },
  {
    name: "USPS",
    patterns: [
      "^420[0-9]{31}$",           // 34-digit Click-N-Ship
      "^94[0-9]{20}$",
      "^9[2-5][0-9]{20}$",
      "^[0-9]{20,22}$",
    ],
  },
];

/**
 * Carriers we can link to but never auto-detect from free text — their number
 * formats collide with other carriers or with order/account IDs. They are only
 * used when the caller names the carrier explicitly.
 */
export const EXTRA_CARRIER_URL_TEMPLATES: Record<string, string> = {
  DHL: "https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id={tracking_number}",
  OnTrac: "https://www.ontrac.com/tracking/?number={tracking_number}",
  LaserShip: "https://www.ontrac.com/tracking/?number={tracking_number}",
};

// ---------------------------------------------------------------------------
// Carrier name normalisation
// ---------------------------------------------------------------------------

/**
 * Map a free-form carrier name (as reported by retailers, e.g. "Shipped with
 * Amazon", "Amazon Logistics", "Federal Express", "Unknown") to a canonical
 * carrier name. Amazon TBA numbers always map to "Amazon". When the name is
 * empty or "Unknown", falls back to detecting from the tracking number.
 * Unrecognised names are returned trimmed, unchanged.
 */
export function normalizeCarrier(
  carrier: string | null | undefined,
  trackingNumber?: string | null,
): string | null {
  const upper = (trackingNumber ?? "").trim().toUpperCase();
  if (/^TBA[0-9]{12}US$/.test(upper)) return "Amazon";

  const raw = (carrier ?? "").trim();
  const n = raw.toLowerCase();
  if (!n || n === "unknown" || n === "other") {
    return upper ? detectCarrier(upper) : null;
  }
  if (n.includes("amazon") || n === "amzl") return "Amazon";
  if (n.includes("fedex") || n.includes("federal express")) return "FedEx";
  if (n.includes("usps") || n.includes("postal")) return "USPS";
  if (/\bups\b/.test(n) || n.includes("united parcel")) return "UPS";
  if (n.includes("dhl")) return "DHL";
  if (n.includes("ontrac")) return "OnTrac";
  if (n.includes("lasership")) return "LaserShip";
  return raw;
}

// ---------------------------------------------------------------------------
// Carrier detection
// ---------------------------------------------------------------------------

export function detectCarrier(trackingNumber: string): string | null {
  const upper = trackingNumber.trim().toUpperCase();
  for (const carrier of VALIDATION_PATTERNS) {
    for (const pattern of carrier.patterns) {
      if (new RegExp(pattern).test(upper)) {
        return carrier.name;
      }
    }
  }
  return null;
}

export function getTrackingUrl(
  trackingNumber: string,
  carrier?: string | null,
): string | null {
  const upper = trackingNumber.trim().toUpperCase();
  const resolvedCarrier = normalizeCarrier(carrier, upper);
  if (!resolvedCarrier) return null;

  const carrierUpper = resolvedCarrier.toUpperCase();
  for (const info of CARRIER_PATTERNS) {
    if (info.name.toUpperCase() === carrierUpper) {
      return info.url_template.replace("{tracking_number}", upper);
    }
  }
  for (const [name, template] of Object.entries(EXTRA_CARRIER_URL_TEMPLATES)) {
    if (name.toUpperCase() === carrierUpper) {
      return template.replace("{tracking_number}", upper);
    }
  }
  return null;
}
