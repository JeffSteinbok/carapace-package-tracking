/**
 * Package Tracking — tool handlers.
 *
 * Pure logic with no knowledge of how it's invoked.
 */

import { detectCarrier, getTrackingUrl } from "./carriers.js";
import { getPackage, addPackage, removePackage, listPackages } from "./storage.js";
import { scanTextForTrackingNumbers } from "./scanning.js";

export function handlePackageTrack(args: Record<string, unknown>): Record<string, unknown> {
  const trackingNumber = ((args.tracking_number as string) ?? "").trim();

  if (!trackingNumber) {
    return { error: "tracking_number is required" };
  }

  const carrierArg = (args.carrier as string | undefined) ?? undefined;

  // Try to get from saved packages first
  const pkg = getPackage(trackingNumber);
  if (!("error" in pkg)) {
    return pkg;
  }

  // Not saved — detect carrier and generate URL
  let carrier = carrierArg;
  if (!carrier) {
    carrier = detectCarrier(trackingNumber) ?? undefined;
  }

  if (!carrier) {
    return {
      error: `Could not detect carrier for tracking number: ${trackingNumber}. Please specify carrier (UPS, FedEx, USPS, Amazon) manually.`,
    };
  }

  const url = getTrackingUrl(trackingNumber, carrier);
  if (!url) {
    return { error: `Could not generate tracking URL for carrier: ${carrier}` };
  }

  return {
    tracking_number: trackingNumber.toUpperCase(),
    carrier,
    url,
    saved: false,
  };
}

export function handlePackageAdd(args: Record<string, unknown>): Record<string, unknown> {
  const trackingNumber = ((args.tracking_number as string) ?? "").trim();

  if (!trackingNumber) {
    return { error: "tracking_number is required" };
  }

  const carrier = (args.carrier as string | undefined) ?? undefined;
  const label = (args.label as string | undefined) ?? undefined;

  return addPackage(trackingNumber, carrier, label);
}

export function handlePackageRemove(args: Record<string, unknown>): Record<string, unknown> {
  const trackingNumber = ((args.tracking_number as string) ?? "").trim();

  if (!trackingNumber) {
    return { error: "tracking_number is required" };
  }

  return removePackage(trackingNumber);
}

export function handlePackageList(): Record<string, unknown> {
  return listPackages();
}

export function handlePackageScan(args: Record<string, unknown>): Record<string, unknown> {
  const text = (args.text as string) ?? "";

  if (!text) {
    return { error: "text is required" };
  }

  const results = scanTextForTrackingNumbers(text);

  return {
    tracking_numbers: results,
    count: results.length,
  };
}
