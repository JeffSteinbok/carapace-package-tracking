/**
 * Package storage — persists tracked packages to ~/.openclaw/package_tracking.json.
 *
 * Wire-compatible with the Python version.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { detectCarrier, getTrackingUrl } from "./carriers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrackedPackage {
  tracking_number: string;
  carrier: string;
  url: string;
  label: string;
  added_at: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function getStoragePath(): string {
  const openclawDir = join(homedir(), ".openclaw");
  mkdirSync(openclawDir, { recursive: true });
  return join(openclawDir, "package_tracking.json");
}

function loadPackages(): Record<string, TrackedPackage> {
  const path = getStoragePath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function savePackages(packages: Record<string, TrackedPackage>): void {
  const path = getStoragePath();
  try {
    writeFileSync(path, JSON.stringify(packages, null, 2));
  } catch (e) {
    throw new Error(`Failed to save packages: ${e}`);
  }
}

function getTimestamp(): string {
  return new Date().toISOString().replace("+00:00", "Z");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function addPackage(
  trackingNumber: string,
  carrier?: string | null,
  label?: string | null,
): Record<string, unknown> {
  const upper = trackingNumber.trim().toUpperCase();
  if (!upper) return { error: "tracking_number is required" };

  const resolvedCarrier = carrier ?? detectCarrier(upper);
  if (!resolvedCarrier) {
    return { error: `Could not detect carrier for tracking number: ${upper}` };
  }

  const url = getTrackingUrl(upper, resolvedCarrier);
  if (!url) {
    return { error: `Could not generate tracking URL for carrier: ${resolvedCarrier}` };
  }

  const packages = loadPackages();
  packages[upper] = {
    tracking_number: upper,
    carrier: resolvedCarrier,
    url,
    label: label ?? "",
    added_at: getTimestamp(),
  };
  savePackages(packages);
  return packages[upper];
}

export function removePackage(
  trackingNumber: string,
): Record<string, unknown> {
  const upper = trackingNumber.trim().toUpperCase();
  if (!upper) return { error: "tracking_number is required" };

  const packages = loadPackages();
  if (!(upper in packages)) {
    return { error: `Package not found: ${upper}` };
  }

  delete packages[upper];
  savePackages(packages);
  return { success: true, tracking_number: upper };
}

export function listPackages(): {
  packages: TrackedPackage[];
  count: number;
} {
  const packages = loadPackages();
  const values = Object.values(packages);
  return { packages: values, count: values.length };
}

export function getPackage(
  trackingNumber: string,
): Record<string, unknown> {
  const upper = trackingNumber.trim().toUpperCase();
  if (!upper) return { error: "tracking_number is required" };

  const packages = loadPackages();
  if (!(upper in packages)) {
    return { error: `Package not found: ${upper}` };
  }

  return packages[upper];
}
