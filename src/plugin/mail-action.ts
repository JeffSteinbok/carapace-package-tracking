/**
 * Mail action: detect_tracking
 *
 * Implements the ActionPlugin interface from carapace-mail-runtime.
 * Scans incoming emails for tracking numbers and auto-adds/removes
 * packages from the tracking list.
 *
 * Usage:
 *   import { register } from 'carapace-package-tracking/mail-action';
 *   register(actionRegistry);
 *
 * Or load dynamically via action_plugins config path.
 */

import type {
  ActionPlugin,
  ActionRegistry,
  ActionContext,
  ActionResult,
  MailEnvelope,
} from "carapace-mail-runtime";
import { detectCarrier } from "../lib/carriers.js";
import { addPackage, removePackage } from "../lib/storage.js";
import { scanTextForTrackingNumbers, extractTrackingFromUrls } from "../lib/scanning.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DELIVERY_KEYWORDS = [
  "delivered",
  "package delivered",
  "your order has been delivered",
  "delivery complete",
  "successfully delivered",
  "has been delivered",
  "your package was delivered",
  "item delivered",
  "order delivered",
];

const AMAZON_DOMAINS = ["amazon.com", "amazonlogistics.com"];
const NARVAR_URL_PATTERN = /https?:\/\/[^\s"'<>]*narvar\.com\/[^\s"'<>]*/gi;

// ---------------------------------------------------------------------------
// Shipping sender list (subset relevant to tracking detection)
// ---------------------------------------------------------------------------

const SHIPPING_DOMAINS = [
  "fedex.com", "ups.com", "usps.com",
  "dhl.com", "ontrac.com", "lasership.com",
  "narvar.com", "aftership.com",
  "costco.com", "walmart.com", "target.com",
  "bestbuy.com", "homedepot.com", "lowes.com",
];

function isShippingSender(senderEmail: string): boolean {
  const low = (senderEmail ?? "").toLowerCase();
  return SHIPPING_DOMAINS.some(
    (domain) => low.endsWith("@" + domain) || low.includes("." + domain),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isDeliveryNotification(subject: string | null | undefined): boolean {
  const low = (subject ?? "").toLowerCase();
  return DELIVERY_KEYWORDS.some((kw) => low.includes(kw));
}

function isAmazonSender(senderEmail: string): boolean {
  const low = (senderEmail ?? "").toLowerCase();
  return AMAZON_DOMAINS.some(
    (domain) =>
      low.endsWith("@" + domain) ||
      new RegExp(`@(?:[a-z0-9-]+\\.)*${domain.replace(/\./g, "\\.")}$`).test(low),
  );
}

function combinedBody(envelope: MailEnvelope): string {
  return [envelope.body_text, envelope.body_html].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

export async function scanAndAddPackages(
  envelope: MailEnvelope,
  options: {
    accountLabel: string;
    logger: (msg: string) => void;
  },
): Promise<Array<{ trackingNumber: string; carrier: string; label: string }>> {
  const senderEmail = envelope.sender_email || "unknown";
  const senderName = envelope.sender_name || "";
  const subject = envelope.subject || "(no subject)";

  try {
    if (!isShippingSender(senderEmail)) {
      options.logger(`skipping tracking scan: non-shipping sender ${senderEmail}`);
      return [];
    }

    if (isAmazonSender(senderEmail)) {
      options.logger(`skipping tracking scan: Amazon sender ${senderEmail} (not trackable externally)`);
      return [];
    }

    const combined = combinedBody(envelope);
    const urlFound = extractTrackingFromUrls(combined);
    const bodyText = envelope.body_text || "";
    const found = urlFound.length > 0
      ? [...urlFound]
      : (bodyText ? scanTextForTrackingNumbers(bodyText, { strict: true }) : []);

    if (found.length === 0) return [];

    // Try to extract a "Shipped To" recipient from the body for a better label.
    const shipToMatch = bodyText.match(
      /shipped\s+to[:\s]+([A-Za-z][^\n]{2,60})/i,
    ) ?? (envelope.body_html || "").match(
      /Shipped\s+To[:<\/][^>]*>?\s*([A-Za-z][^<\n]{2,60})/i,
    );
    const recipientHint = shipToMatch
      ? shipToMatch[1].replace(/<[^>]+>/g, "").trim().split(/\n/)[0].trim()
      : null;

    const added: Array<{ trackingNumber: string; carrier: string; label: string }> = [];
    for (const trackingInfo of found) {
      const { tracking_number: trackingNumber, carrier } = trackingInfo;
      const labelBase = recipientHint ?? (senderName || senderEmail);
      const label = `${options.accountLabel}: ${labelBase} — ${subject.slice(0, 40)}`;
      const result = addPackage(trackingNumber, carrier, label);
      if ("error" in result) {
        options.logger(`warn: failed to add package ${trackingNumber}: ${result["error"]}`);
        continue;
      }
      added.push({ trackingNumber, carrier, label });
      options.logger(`📦 added package: ${trackingNumber} (${carrier}) — ${label}`);
    }

    return added;
  } catch (exc) {
    options.logger(`error: package tracking failed: ${exc}`);
    return [];
  }
}

export async function scanAndRemoveDelivered(
  envelope: MailEnvelope,
  options: {
    logger: (msg: string) => void;
  },
): Promise<Array<{ trackingNumber: string; carrier: string }>> {
  const scanText = envelope.body_text || envelope.subject || "";
  const combined = combinedBody(envelope);

  try {
    const urlFound = extractTrackingFromUrls(combined);
    const found = urlFound.length > 0
      ? urlFound
      : scanTextForTrackingNumbers(scanText, { strict: true });
    if (found.length === 0) {
      options.logger(`delivery email but no tracking number found: ${envelope.subject}`);
      return [];
    }

    const removed: Array<{ trackingNumber: string; carrier: string }> = [];
    for (const trackingInfo of found) {
      const { tracking_number: trackingNumber, carrier } = trackingInfo;
      const result = removePackage(trackingNumber);
      if ((result as Record<string, unknown>)["success"]) {
        removed.push({ trackingNumber, carrier });
        options.logger(`✅ removed delivered package: ${trackingNumber} (${carrier})`);
      } else if ((result as Record<string, unknown>)["error"] === "not_found") {
        options.logger(`delivery notice for untracked package: ${trackingNumber} — ignoring`);
      } else {
        options.logger(`warn: failed to remove ${trackingNumber}: ${JSON.stringify(result)}`);
      }
    }

    return removed;
  } catch (exc) {
    options.logger(`error: delivery removal failed: ${exc}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// buildDetectTrackingAction
// ---------------------------------------------------------------------------

export function buildDetectTrackingAction(options: {
  accountLabelResolver: (envelope: MailEnvelope) => string;
}): (ctx: ActionContext, params: Record<string, unknown>) => Promise<ActionResult[]> {
  const { accountLabelResolver } = options;

  return async (ctx: ActionContext, _params: Record<string, unknown>): Promise<ActionResult[]> => {
    if (isDeliveryNotification(ctx.envelope.subject)) {
      const removed = await scanAndRemoveDelivered(ctx.envelope, {
        logger: ctx.logger,
      });
      return removed.map(({ trackingNumber, carrier }) => ({
        kind: "message",
        payload: {
          message: `✅ Package delivered: ${trackingNumber} (${carrier}) — ${ctx.envelope.subject || "(no subject)"}`,
        },
      }));
    }

    const added = await scanAndAddPackages(ctx.envelope, {
      accountLabel: accountLabelResolver(ctx.envelope),
      logger: ctx.logger,
    });
    const date = ctx.envelope.received_at
      ? new Date(ctx.envelope.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return added.map(({ trackingNumber, carrier }) => ({
      kind: "message",
      payload: {
        message: `📦 New package tracked: ${trackingNumber}\n• Carrier: ${carrier}\n• From: ${ctx.envelope.sender_name || ctx.envelope.sender_email || "unknown"}\n• Subject: ${ctx.envelope.subject || "(no subject)"}\n• Date: ${date}`,
      },
    }));
  };
}

// ---------------------------------------------------------------------------
// ActionPlugin registration
// ---------------------------------------------------------------------------

/**
 * Register the detect_tracking mail action.
 *
 * @param registry — ActionRegistry from carapace-mail-runtime
 * @param options.accountLabelResolver — resolves an envelope to an account label for package labels
 */
export function registerDetectTracking(
  registry: ActionRegistry,
  options: {
    accountLabelResolver: (envelope: MailEnvelope) => string;
  },
): void {
  registry.register(
    "detect_tracking",
    buildDetectTrackingAction(options),
    { needs_body: true },
  );
}

/**
 * Default ActionPlugin register function.
 * Uses envelope.account_id as the account label.
 */
export const register: ActionPlugin["register"] = (registry) => {
  registerDetectTracking(registry, {
    accountLabelResolver: (envelope) => envelope.account_id,
  });
};
