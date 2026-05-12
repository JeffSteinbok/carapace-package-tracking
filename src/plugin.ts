/**
 * Package Tracking — OpenClaw plugin entry.
 *
 * Declares config schema and tools. Business logic lives in handlers.ts,
 * with carrier detection in carriers.ts, storage in storage.ts,
 * and text scanning in scanning.ts.
 *
 * Tools:
 *   package_track  — look up a package by tracking number
 *   package_add    — save a package to the tracking list
 *   package_remove — remove a saved package
 *   package_list   — list all saved packages
 *   package_scan   — scan text for tracking numbers
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import {
  handlePackageTrack,
  handlePackageAdd,
  handlePackageRemove,
  handlePackageList,
  handlePackageScan,
} from "./handlers.js";

// `createEntry` is a required export name — the SDK's build tools look for it by name.
export const createEntry = definePlugin({
  id: "package-tracking",
  name: "Package Tracking",
  description:
    "Track packages from UPS, FedEx, USPS, and Amazon. Detect carriers automatically, save packages for monitoring, and scan text for tracking numbers.",

  configSchema: Type.Object({}),

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
        if (!tracking_number?.trim()) return { error: "tracking_number is required" };
        return handlePackageTrack({ tracking_number, carrier });
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
        if (!tracking_number?.trim()) return { error: "tracking_number is required" };
        return handlePackageAdd({ tracking_number, carrier, label });
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
        if (!tracking_number?.trim()) return { error: "tracking_number is required" };
        return handlePackageRemove({ tracking_number });
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
        return handlePackageList();
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
        return handlePackageScan({ text });
      },
    }),
  ],
});
