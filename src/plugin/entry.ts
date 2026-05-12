/**
 * Package Tracking — OpenClaw plugin entry.
 *
 * Declares config schema and tools with handler logic inlined.
 * Library code lives in lib/, provider loading in config.ts.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import { detectCarrier, getTrackingUrl } from "../lib/carriers.js";
import { getPackage, addPackage, removePackage, listPackages } from "../lib/storage.js";
import { scanTextForTrackingNumbers } from "../lib/scanning.js";
import { statusRegistry } from "../lib/status.js";

export const createEntry = definePlugin({
  id: "package-tracking",
  name: "Package Tracking",
  description:
    "Track packages from UPS, FedEx, USPS, and Amazon. Detect carriers automatically, save packages for monitoring, and scan text for tracking numbers.",

  configSchema: Type.Object({
    status_providers: Type.Optional(
      Type.Array(Type.String(), {
        description: "Paths to external ESM carrier status provider plugin modules",
      }),
    ),
  }),

  tools: (tool) => [
    // -----------------------------------------------------------------
    // package_track — look up a single package
    // -----------------------------------------------------------------
    tool({
      name: "package_track",
      label: "Track Package",
      description:
        "Look up a package by tracking number and return the carrier and tracking URL.",
      parameters: Type.Object({
        tracking_number: Type.String({
          description:
            "Package tracking number (e.g., 1Z999AA10123456784, 940000000000000000000, TBA012345678901US)",
        }),
        carrier: Type.Optional(
          Type.String({
            description: "Optional carrier override: UPS, FedEx, USPS, or Amazon",
          }),
        ),
      }),
      execute: async ({ tracking_number, carrier }) => {
        const trackingNumber = (tracking_number ?? "").trim();
        if (!trackingNumber) return { error: "tracking_number is required" };

        // Try saved packages first
        const pkg = getPackage(trackingNumber);
        if (!("error" in pkg)) return pkg;

        // Detect carrier and generate URL
        const resolvedCarrier = carrier ?? detectCarrier(trackingNumber) ?? undefined;
        if (!resolvedCarrier) {
          return {
            error: `Could not detect carrier for tracking number: ${trackingNumber}. Please specify carrier (UPS, FedEx, USPS, or Amazon) manually.`,
          };
        }

        const url = getTrackingUrl(trackingNumber, resolvedCarrier);
        if (!url) return { error: `Could not generate tracking URL for carrier: ${resolvedCarrier}` };

        return {
          tracking_number: trackingNumber.toUpperCase(),
          carrier: resolvedCarrier,
          url,
          saved: false,
        };
      },
    }),

    // -----------------------------------------------------------------
    // package_add — save a package
    // -----------------------------------------------------------------
    tool({
      name: "package_add",
      label: "Add Package",
      description: "Save a package to the tracking list, with an optional label.",
      parameters: Type.Object({
        tracking_number: Type.String({
          description: "Package tracking number",
        }),
        carrier: Type.Optional(
          Type.String({
            description: "Optional carrier override: UPS, FedEx, USPS, or Amazon",
          }),
        ),
        label: Type.Optional(
          Type.String({
            description: "Optional label/description for the package",
          }),
        ),
      }),
      execute: async ({ tracking_number, carrier, label }) => {
        const trackingNumber = (tracking_number ?? "").trim();
        if (!trackingNumber) return { error: "tracking_number is required" };
        return addPackage(trackingNumber, carrier, label);
      },
    }),

    // -----------------------------------------------------------------
    // package_remove — remove a saved package
    // -----------------------------------------------------------------
    tool({
      name: "package_remove",
      label: "Remove Package",
      description: "Remove a saved package from the tracking list.",
      parameters: Type.Object({
        tracking_number: Type.String({
          description: "Package tracking number to remove",
        }),
      }),
      execute: async ({ tracking_number }) => {
        const trackingNumber = (tracking_number ?? "").trim();
        if (!trackingNumber) return { error: "tracking_number is required" };
        return removePackage(trackingNumber);
      },
    }),

    // -----------------------------------------------------------------
    // package_list — list all saved packages
    // -----------------------------------------------------------------
    tool({
      name: "package_list",
      label: "List Packages",
      description:
        "List saved packages with carriers, tracking URLs, labels, and added dates.",
      parameters: Type.Object({}),
      execute: async () => {
        return listPackages();
      },
    }),

    // -----------------------------------------------------------------
    // package_scan — scan text for tracking numbers
    // -----------------------------------------------------------------
    tool({
      name: "package_scan",
      label: "Scan for Tracking Numbers",
      description: "Scan text for package tracking numbers and identify their carriers.",
      parameters: Type.Object({
        text: Type.String({
          description: "Text to scan for tracking numbers (e.g., email body)",
        }),
      }),
      execute: async ({ text }) => {
        if (!text) return { error: "text is required" };
        const results = scanTextForTrackingNumbers(text);
        return { tracking_numbers: results, count: results.length };
      },
    }),

    // -----------------------------------------------------------------
    // get_package_status — live carrier status
    // -----------------------------------------------------------------
    tool({
      name: "get_package_status",
      label: "Get Package Status",
      description:
        "Get live carrier status for a tracking number. Requires carrier status providers to be configured.",
      parameters: Type.Object({
        tracking_number: Type.String({
          description: "Package tracking number to check status for",
        }),
        carrier: Type.Optional(
          Type.String({
            description: "Optional carrier override: UPS, FedEx, USPS, or Amazon",
          }),
        ),
      }),
      execute: async ({ tracking_number, carrier }) => {
        const trackingNumber = (tracking_number ?? "").trim();
        if (!trackingNumber) return { error: "tracking_number is required" };

        if (!statusRegistry.hasProviders) {
          return { error: "No carrier status providers are registered. Configure status_providers in plugin config." };
        }

        const result = await statusRegistry.getStatus(trackingNumber, carrier);
        if (!result) {
          return { error: `No status provider available for tracking number: ${trackingNumber}` };
        }
        return result as unknown as Record<string, unknown>;
      },
    }),
  ],
});
