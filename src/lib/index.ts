/**
 * carapace-package-tracking — public API barrel export.
 *
 * Consumers who use this package as a library (e.g., building a
 * CarrierStatusProvider or using storage functions) import from here.
 */

// Storage
export {
  type TrackedPackage,
  addPackage,
  removePackage,
  listPackages,
  getPackage,
} from "./storage.js";

// Carrier detection
export {
  type CarrierPattern,
  type ValidationPattern,
  CARRIER_PATTERNS,
  VALIDATION_PATTERNS,
  detectCarrier,
  getTrackingUrl,
} from "./carriers.js";

// Text scanning
export { scanTextForTrackingNumbers } from "./scanning.js";

// Status provider interfaces
export {
  type CarrierStatusResult,
  type CarrierStatusProvider,
  type CarrierStatusPlugin,
  StatusProviderRegistry,
  statusRegistry,
} from "./status.js";
