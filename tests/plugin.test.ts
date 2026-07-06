/**
 * Tests for the Package Tracking plugin.
 *
 * Covers: tool registration, carrier detection, text scanning,
 * URL extraction, package storage, and handler logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, existsSync, unlinkSync, rmdirSync } from "node:fs";

// ---------------------------------------------------------------------------
// Mock node:os so we can redirect homedir for storage tests
// ---------------------------------------------------------------------------

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return { ...original, homedir: vi.fn(() => original.homedir()) };
});

// ---------------------------------------------------------------------------
// Tool registration harness
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
}

function makeApi(config: Record<string, unknown> = {}) {
  const tools: Record<string, ToolDef> = {};
  return {
    pluginConfig: config,
    registerTool(tool: unknown) {
      const t = tool as ToolDef;
      tools[t.name] = t;
    },
    tools,
  };
}

async function loadPlugin() {
  const { createEntry } = await import("../src/plugin.js");
  const entry = createEntry();
  const api = makeApi({});
  entry.register(api);
  return { entry, api };
}

function parseResult(result: unknown): unknown {
  const text = (result as { content: Array<{ text: string }> }).content[0].text;
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

describe("plugin entry", () => {
  it("has correct id and name", async () => {
    const { entry } = await loadPlugin();
    expect(entry.id).toBe("package-tracking");
    expect(entry.name).toBe("Package Tracking");
  });

  it("registers all 6 tools", async () => {
    const { api } = await loadPlugin();
    const names = Object.keys(api.tools).sort();
    expect(names).toEqual([
      "get_package_status",
      "package_add",
      "package_list",
      "package_remove",
      "package_scan",
      "package_track",
    ]);
  });

  it("all tools have name, description, and parameters", async () => {
    const { api } = await loadPlugin();
    for (const tool of Object.values(api.tools)) {
      expect(typeof tool.name).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Carrier detection (unit tests)
// ---------------------------------------------------------------------------

describe("carrier detection", () => {
  let detectCarrier: typeof import("../src/carriers.js").detectCarrier;
  let getTrackingUrl: typeof import("../src/carriers.js").getTrackingUrl;

  beforeEach(async () => {
    const mod = await import("../src/lib/carriers.js");
    detectCarrier = mod.detectCarrier;
    getTrackingUrl = mod.getTrackingUrl;
  });

  it("detects UPS", () => expect(detectCarrier("1Z999AA10123456784")).toBe("UPS"));
  it("detects UPS lowercase", () => expect(detectCarrier("1z999aa10123456784")).toBe("UPS"));
  it("detects Amazon", () => expect(detectCarrier("TBA123456789012US")).toBe("Amazon"));
  it("detects FedEx 12-digit", () => expect(detectCarrier("123456789012")).toBe("FedEx"));
  it("detects FedEx 15-digit", () => expect(detectCarrier("123456789012345")).toBe("FedEx"));
  it("detects USPS 94-prefix", () => expect(detectCarrier("9400111899223100001234")).toBe("USPS"));
  it("returns null for unknown", () => expect(detectCarrier("NOTAVALIDNUMBER")).toBeNull());
  it("returns null for empty", () => expect(detectCarrier("")).toBeNull());

  it("generates UPS url", () => {
    const url = getTrackingUrl("1Z999AA10123456784");
    expect(url).toContain("ups.com");
    expect(url).toContain("1Z999AA10123456784");
  });

  it("generates FedEx url", () => {
    const url = getTrackingUrl("123456789012", "FedEx");
    expect(url).toContain("fedex.com");
  });

  it("returns null for unknown carrier", () => {
    expect(getTrackingUrl("NOTAVALIDNUMBER")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Text scanning
// ---------------------------------------------------------------------------

describe("text scanning", () => {
  let scanTextForTrackingNumbers: typeof import("../src/scanning.js").scanTextForTrackingNumbers;
  let extractTrackingFromUrls: typeof import("../src/scanning.js").extractTrackingFromUrls;

  beforeEach(async () => {
    const mod = await import("../src/lib/scanning.js");
    scanTextForTrackingNumbers = mod.scanTextForTrackingNumbers;
    extractTrackingFromUrls = mod.extractTrackingFromUrls;
  });

  it("returns empty for empty text", () => {
    expect(scanTextForTrackingNumbers("")).toEqual([]);
  });

  it("finds single UPS tracking number", () => {
    const results = scanTextForTrackingNumbers(
      "Your tracking number is 1Z999AA10123456784.",
    );
    expect(results).toHaveLength(1);
    expect(results[0].carrier).toBe("UPS");
    expect(results[0].tracking_number).toBe("1Z999AA10123456784");
  });

  it("finds multiple carriers", () => {
    const text = "UPS: 1Z999AA10123456784, Amazon: TBA123456789012US";
    const results = scanTextForTrackingNumbers(text);
    const carriers = new Set(results.map((r) => r.carrier));
    expect(carriers).toContain("UPS");
    expect(carriers).toContain("Amazon");
  });

  it("returns no duplicates", () => {
    const text = "Track 1Z999AA10123456784 and again 1Z999AA10123456784";
    const results = scanTextForTrackingNumbers(text);
    expect(results.length).toBe(1);
  });

  it("strict mode ignores generic long numbers without tracking context", () => {
    const text = "Invoice 123456789012 and order 123456789012345 are attached.";
    const results = scanTextForTrackingNumbers(text, { strict: true });
    expect(results).toEqual([]);
  });

  it("strict mode ignores Costco-style member IDs even in shipping emails", () => {
    const text = "Track your package online. Costco member id: 123456789012";
    const results = scanTextForTrackingNumbers(text, { strict: true });
    expect(results).toEqual([]);
  });

  it("strict mode keeps numeric tracking numbers with nearby context", () => {
    const text = "Your FedEx tracking number is 123456789012 and is in transit.";
    const results = scanTextForTrackingNumbers(text, { strict: true });
    expect(results).toHaveLength(1);
    expect(results[0].carrier).toBe("FedEx");
    expect(results[0].tracking_number).toBe("123456789012");
  });

  it("extracts from UPS url", () => {
    const text = "https://www.ups.com/track?tracknum=1Z999AA10123456784";
    const results = extractTrackingFromUrls(text);
    expect(results).toHaveLength(1);
    expect(results[0].carrier).toBe("UPS");
  });

  it("extracts from FedEx url", () => {
    const text = "https://www.fedex.com/fedextrack/?trknbr=123456789012";
    const results = extractTrackingFromUrls(text);
    expect(results).toHaveLength(1);
    expect(results[0].carrier).toBe("FedEx");
  });

  it("detects carrier from Narvar path", () => {
    const text =
      "https://tracking.narvar.com/tracking/ups?tracking_numbers=1Z999AA10123456784";
    const results = extractTrackingFromUrls(text);
    expect(results).toHaveLength(1);
    expect(results[0].carrier).toBe("UPS");
  });
});

// ---------------------------------------------------------------------------
// Package storage
// ---------------------------------------------------------------------------

describe("package storage", () => {
  const testDir = join(import.meta.dirname ?? __dirname, "__test_storage__");
  const openclawDir = join(testDir, ".openclaw");
  const jsonPath = join(openclawDir, "package_tracking.json");

  beforeEach(async () => {
    const os = await import("node:os");
    vi.mocked(os.homedir).mockReturnValue(testDir);
    mkdirSync(openclawDir, { recursive: true });
    if (existsSync(jsonPath)) unlinkSync(jsonPath);
  });

  afterEach(() => {
    if (existsSync(jsonPath)) unlinkSync(jsonPath);
    if (existsSync(openclawDir)) {
      try { rmdirSync(openclawDir); } catch { /* ignore */ }
    }
    if (existsSync(testDir)) {
      try { rmdirSync(testDir); } catch { /* ignore */ }
    }
  });

  it("adds and lists a package", async () => {
    const { addPackage, listPackages } = await import("../src/lib/storage.js");
    const result = addPackage("1Z999AA10123456784", undefined, "Test");
    expect(result).not.toHaveProperty("error");
    expect(result).toHaveProperty("carrier", "UPS");
    expect(result).toHaveProperty("label", "Test");
    expect(listPackages().count).toBe(1);
  });

  it("removes a package", async () => {
    const { addPackage, removePackage, listPackages } = await import("../src/lib/storage.js");
    addPackage("1Z999AA10123456784");
    const result = removePackage("1Z999AA10123456784");
    expect(result).toHaveProperty("success", true);
    expect(listPackages().count).toBe(0);
  });

  it("returns error for missing package", async () => {
    const { getPackage } = await import("../src/lib/storage.js");
    expect(getPackage("1Z999AA10123456784")).toHaveProperty("error");
  });

  it("rejects unknown carrier", async () => {
    const { addPackage } = await import("../src/lib/storage.js");
    expect(addPackage("INVALIDTRACKING")).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// package_track tool
// ---------------------------------------------------------------------------

describe("package_track", () => {
  it("returns error when tracking_number is missing", async () => {
    const { api } = await loadPlugin();
    const result = await api.tools["package_track"].execute("id", {});
    const parsed = parseResult(result);
    expect(parsed).toMatchObject({ error: expect.stringContaining("tracking_number") });
  });

  it("returns error when tracking_number is empty", async () => {
    const { api } = await loadPlugin();
    const result = await api.tools["package_track"].execute("id", { tracking_number: "  " });
    const parsed = parseResult(result);
    expect(parsed).toMatchObject({ error: expect.stringContaining("tracking_number") });
  });
});

// ---------------------------------------------------------------------------
// package_add tool
// ---------------------------------------------------------------------------

describe("package_add", () => {
  it("returns error when tracking_number is missing", async () => {
    const { api } = await loadPlugin();
    const result = await api.tools["package_add"].execute("id", {});
    const parsed = parseResult(result);
    expect(parsed).toMatchObject({ error: expect.stringContaining("tracking_number") });
  });
});

// ---------------------------------------------------------------------------
// package_scan tool
// ---------------------------------------------------------------------------

describe("package_scan", () => {
  it("returns error when text is missing", async () => {
    const { api } = await loadPlugin();
    const result = await api.tools["package_scan"].execute("id", {});
    const parsed = parseResult(result);
    expect(parsed).toMatchObject({ error: expect.stringContaining("text") });
  });
});

// ---------------------------------------------------------------------------
// get_package_status tool
// ---------------------------------------------------------------------------

describe("get_package_status", () => {
  it("returns error when tracking_number is missing", async () => {
    const { api } = await loadPlugin();
    const result = await api.tools["get_package_status"].execute("id", {});
    const parsed = parseResult(result);
    expect(parsed).toMatchObject({ error: expect.stringContaining("tracking_number") });
  });

  it("returns error when provider cannot fulfill request", async () => {
    const { api } = await loadPlugin();
    const result = await api.tools["get_package_status"].execute("id", {
      tracking_number: "1Z999AA10123456784",
    });
    const parsed = parseResult(result);
    // Built-in providers are registered via lazy init but may fail (e.g. missing python3)
    expect(parsed).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// StatusProviderRegistry
// ---------------------------------------------------------------------------

describe("StatusProviderRegistry", () => {
  it("has no providers initially", async () => {
    const { StatusProviderRegistry } = await import("../src/status.js");
    const registry = new StatusProviderRegistry();
    expect(registry.hasProviders).toBe(false);
  });

  it("registers and queries a provider", async () => {
    const { StatusProviderRegistry } = await import("../src/status.js");
    const registry = new StatusProviderRegistry();
    registry.register({
      name: "TestProvider",
      carriers: ["UPS"],
      async getStatus(tn) {
        return {
          tracking_number: tn,
          carrier: "UPS",
          status: "In Transit",
          delivered: false,
          last_update: null,
          description: "On the way",
        };
      },
    });
    expect(registry.hasProviders).toBe(true);
    const result = await registry.getStatus("1Z999AA10123456784", "UPS");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("In Transit");
    expect(result!.carrier).toBe("UPS");
  });

  it("returns null for unhandled carrier", async () => {
    const { StatusProviderRegistry } = await import("../src/status.js");
    const registry = new StatusProviderRegistry();
    registry.register({
      name: "UPSOnly",
      carriers: ["UPS"],
      async getStatus() { return null; },
    });
    const result = await registry.getStatus("123456789012", "FedEx");
    expect(result).toBeNull();
  });

  it("later registrations take priority", async () => {
    const { StatusProviderRegistry } = await import("../src/status.js");
    const registry = new StatusProviderRegistry();
    registry.register({
      name: "First",
      carriers: ["UPS"],
      async getStatus(tn) {
        return { tracking_number: tn, carrier: "UPS", status: "First", delivered: false, last_update: null, description: null };
      },
    });
    registry.register({
      name: "Second",
      carriers: ["UPS"],
      async getStatus(tn) {
        return { tracking_number: tn, carrier: "UPS", status: "Second", delivered: false, last_update: null, description: null };
      },
    });
    const result = await registry.getStatus("1Z999AA10123456784", "UPS");
    expect(result!.status).toBe("Second");
  });

  it("wildcard carrier matches all", async () => {
    const { StatusProviderRegistry } = await import("../src/status.js");
    const registry = new StatusProviderRegistry();
    registry.register({
      name: "CatchAll",
      carriers: ["*"],
      async getStatus(tn, carrier) {
        return { tracking_number: tn, carrier: carrier!, status: "Found", delivered: false, last_update: null, description: null };
      },
    });
    const result = await registry.getStatus("ANYTHING", "SomeCarrier");
    expect(result!.status).toBe("Found");
  });
});

// ---------------------------------------------------------------------------
// Mail action scanning priority
// ---------------------------------------------------------------------------

describe("mail action scanning priority", () => {
  const testDir = join(import.meta.dirname ?? __dirname, "__test_mail_action_storage__");
  const openclawDir = join(testDir, ".openclaw");
  const jsonPath = join(openclawDir, "package_tracking.json");

  beforeEach(async () => {
    const os = await import("node:os");
    vi.mocked(os.homedir).mockReturnValue(testDir);
    mkdirSync(openclawDir, { recursive: true });
    if (existsSync(jsonPath)) unlinkSync(jsonPath);
  });

  afterEach(() => {
    if (existsSync(jsonPath)) unlinkSync(jsonPath);
    if (existsSync(openclawDir)) {
      try { rmdirSync(openclawDir); } catch { /* ignore */ }
    }
    if (existsSync(testDir)) {
      try { rmdirSync(testDir); } catch { /* ignore */ }
    }
  });

  it("uses URL tracking results before free-text scanning", async () => {
    const { scanAndAddPackages } = await import("../src/plugin/mail-action.js");
    const added = await scanAndAddPackages(
      {
        sender_email: "alerts@fedex.com",
        sender_name: "FedEx",
        subject: "Your package is on the way",
        body_text:
          "FedEx tracking number 123456789012. Track here: https://www.ups.com/track?tracknum=1Z999AA10123456784",
        body_html: null,
        account_id: "acct",
      } as unknown as import("carapace-mail-runtime").MailEnvelope,
      {
        accountLabel: "test-account",
        logger: () => {},
      },
    );

    expect(added.map((a) => a.trackingNumber)).toEqual(["1Z999AA10123456784"]);
  });
});
