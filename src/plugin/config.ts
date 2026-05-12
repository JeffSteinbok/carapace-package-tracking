/**
 * Plugin configuration types and provider loading.
 */

import { statusRegistry, type CarrierStatusPlugin } from "../lib/status.js";
import { builtinProviders } from "./providers/index.js";

export interface PackageTrackingConfig {
  /** Paths to external ESM carrier status provider plugin modules to load at startup. */
  status_providers?: string[];
}

export async function loadProviders(providers: string[]): Promise<void> {
  // Register built-in providers first (USPS, FedEx, UPS)
  for (const provider of builtinProviders) {
    statusRegistry.register(provider);
  }

  // Then load any external/override providers (registered last = highest priority)
  for (const pluginPath of providers) {
    try {
      const mod = await import(pluginPath) as CarrierStatusPlugin;
      if (typeof mod.register !== "function") {
        console.warn(`[package-tracking] status provider ${pluginPath} does not export register() — skipping`);
        continue;
      }
      await mod.register(statusRegistry);
    } catch (e) {
      console.error(`[package-tracking] failed to load status provider ${pluginPath}: ${e}`);
    }
  }
}
