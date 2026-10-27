/**
 * Package storage — persists tracked packages to ~/.openclaw/package_tracking.json.
 *
 * Wire-compatible with the Python version.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { getTrackingUrl, normalizeCarrier } from "./carriers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrackedPackage {
  tracking_number: string;
  carrier: string;
  /** Carrier tracking page, or "" when no URL is known for the carrier. */
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

/**
 * Load the package map. A missing file is an empty list; an unreadable or
 * unparseable file throws, so callers never save an empty map over real data.
 */
function loadPackages(): Record<string, TrackedPackage> {
  const path = getStoragePath();
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    throw new Error(`Package storage at ${path} is unreadable or corrupt; refusing to continue: ${e}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Package storage at ${path} is not a JSON object; refusing to continue`);
  }
  return parsed as Record<string, TrackedPackage>;
}

/**
 * Write atomically: write a sibling temp file, then rename over the target, so
 * a concurrent reader (another process) sees either the old or the new file,
 * never a partial one.
 */
function savePackages(packages: Record<string, TrackedPackage>): void {
  const path = getStoragePath();
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(packages, null, 2));
    renameSync(tmp, path);
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* ignore */ }
    throw new Error(`Failed to save packages: ${e}`);
  }
}

function getTimestamp(): string {
  return new Date().toISOString().replace("+00:00", "Z");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a package, or update one that is already tracked.
 *
 * Carrier names are normalised (e.g. "Shipped with Amazon" -> "Amazon"). A
 * named carrier without a known tracking URL is stored with `url: ""` rather
 * than rejected. Re-adding an existing number keeps its `added_at` and
 * (non-empty) `label`, merges `extra`, and returns the record with
 * `already_tracked: true` (not persisted) so callers can skip "new package"
 * notifications.
 */
export function addPackage(
  trackingNumber: string,
  carrier?: string | null,
  label?: string | null,
  extra?: Record<string, unknown> | null,
): Record<string, unknown> {
  const upper = trackingNumber.trim().toUpperCase();
  if (!upper) return { error: "tracking_number is required" };

  const resolvedCarrier = normalizeCarrier(carrier, upper);
  if (!resolvedCarrier) {
    return { error: `Could not detect carrier for tracking number: ${upper}` };
  }

  const url = getTrackingUrl(upper, resolvedCarrier) ?? "";

  const packages = loadPackages();
  const existing = packages[upper];
  if (existing) {
    packages[upper] = {
      ...existing,
      ...(extra ?? {}),
      tracking_number: upper,
      carrier: resolvedCarrier,
      url: url || existing.url || "",
      label: existing.label || (label ?? ""),
      added_at: existing.added_at || getTimestamp(),
    };
    savePackages(packages);
    return { ...packages[upper], already_tracked: true };
  }

  packages[upper] = {
    tracking_number: upper,
    carrier: resolvedCarrier,
    url,
    label: label ?? "",
    added_at: getTimestamp(),
    ...(extra ?? {}),
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
