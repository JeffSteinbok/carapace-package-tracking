/**
 * Carrier status provider interfaces and registry.
 *
 * Extension point for external packages to add live tracking status
 * for any carrier (e.g., USPS, FedEx, UPS, Amazon).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The result returned by a carrier status provider for a given tracking number.
 */
export interface CarrierStatusResult {
  tracking_number: string;
  carrier: string;
  status: string;
  delivered: boolean;
  last_update: string | null;
  description: string | null;
  [key: string]: unknown;
}

/**
 * A pluggable carrier status provider.
 *
 * Implement this interface and register it with the StatusProviderRegistry
 * to add live tracking support for one or more carriers.
 *
 * @example
 * const myProvider: CarrierStatusProvider = {
 *   name: 'MyCarrier',
 *   carriers: ['MyCarrier'],
 *   async getStatus(trackingNumber) {
 *     return { tracking_number: trackingNumber, carrier: 'MyCarrier', status: 'In Transit',
 *              delivered: false, last_update: null, description: null };
 *   },
 * };
 * statusRegistry.register(myProvider);
 */
export interface CarrierStatusProvider {
  name: string;
  /** Carrier names this provider handles (case-insensitive). Use `['*']` for all. */
  carriers: string[];
  getStatus(
    trackingNumber: string,
    carrier?: string,
  ): CarrierStatusResult | null | Promise<CarrierStatusResult | null>;
}

/**
 * Interface for external carrier status plugin modules loaded dynamically.
 *
 * @example
 * import type { CarrierStatusPlugin, StatusProviderRegistry } from 'carapace-package-tracking';
 * export const register: CarrierStatusPlugin['register'] = (registry) => {
 *   registry.register({ name: 'MyCarrier', carriers: ['MyCarrier'], async getStatus(tn) { ... } });
 * };
 */
export interface CarrierStatusPlugin {
  register(registry: StatusProviderRegistry): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

import { detectCarrier } from "./carriers.js";

export class StatusProviderRegistry {
  private _providers: CarrierStatusProvider[] = [];

  /** Register a provider. Later registrations take priority. */
  register(provider: CarrierStatusProvider): void {
    this._providers.unshift(provider);
  }

  /** Find the first matching provider and return live status. */
  async getStatus(
    trackingNumber: string,
    carrier?: string | null,
  ): Promise<CarrierStatusResult | null> {
    const resolvedCarrier = carrier ?? detectCarrier(trackingNumber) ?? "Unknown";
    const carrierLower = resolvedCarrier.toLowerCase();

    for (const provider of this._providers) {
      const handles =
        provider.carriers.includes("*") ||
        provider.carriers.some((c) => c.toLowerCase() === carrierLower);
      if (!handles) continue;
      try {
        const result = await provider.getStatus(trackingNumber, resolvedCarrier);
        if (result !== null) return result;
      } catch {
        // provider failed — try next
      }
    }
    return null;
  }

  /** Returns true if at least one provider is registered. */
  get hasProviders(): boolean {
    return this._providers.length > 0;
  }
}

/** Shared singleton status registry. */
export const statusRegistry = new StatusProviderRegistry();
