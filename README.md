# 📦 carapace-package-tracking

[![CI](https://github.com/JeffSteinbok/carapace-package-tracking/actions/workflows/ci.yml/badge.svg)](https://github.com/JeffSteinbok/carapace-package-tracking/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/carapace-package-tracking?logo=npm)](https://www.npmjs.com/package/carapace-package-tracking)

Package tracking plugin for [OpenClaw](https://github.com/JeffSteinbok/openclaw) — track packages across UPS, FedEx, and USPS with live carrier status.

Built with [carapace-plugin-sdk](https://github.com/JeffSteinbok/carapace-plugin-sdk).

## Install

```bash
npm install carapace-package-tracking
```

## Features

| Feature | Description |
|---------|-------------|
| 📦 **Auto-detect** | Automatically identifies carrier from tracking number format |
| 🔍 **Email scanning** | Scans incoming emails for tracking numbers via mail action plugin |
| 📡 **Live status** | Real-time carrier status via API and Camoufox scraper providers |
| 🔌 **Pluggable providers** | Register custom status providers for additional carriers |
| 🖥️ **CLI** | Every tool available as a standalone command-line interface |
| 🧩 **Extensible** | External provider plugins loaded via config |

> **Note:** USPS and UPS status tracking relies on browser scraping via [Camoufox](https://camoufox.com/) and may be fragile if carrier websites change their markup.

### Optional: Mail action integration

If you also use [carapace-mail-runtime](https://github.com/JeffSteinbok/carapace-mail-runtime), this package provides a `detect_tracking` action that scans incoming emails for tracking numbers:

```typescript
import { registerDetectTracking } from 'carapace-package-tracking/mail-action';

registerDetectTracking(registry, {
  accountLabelResolver: (env) => env.mailbox_id,
});
```

## Tools

| Tool | Description |
|------|-------------|
| `package_track` | Look up a package by tracking number (detects carrier automatically or accepts override) |
| `get_package_status` | Get live carrier status for a tracking number (requires status providers — see below) |
| `package_add` | Save a tracking number for ongoing monitoring |
| `package_remove` | Remove a saved package |
| `package_list` | List all saved packages |
| `package_scan` | Scan free-form text for tracking numbers |

## Supported Carriers

- **UPS** — `1Z` prefix tracking numbers
- **FedEx** — 12, 15, or 20-digit tracking numbers
- **USPS** — 20-22 digit tracking numbers (94-prefix, 92-95 prefix)

## Status Providers

The `get_package_status` tool returns live tracking status by querying carrier status providers. The plugin ships with built-in providers and supports external ones.

### Built-in Providers

**Camoufox scrapers** (USPS, UPS, FedEx fallback) — headless browser scraping via [Camoufox](https://camoufox.com/). These work for USPS and UPS out of the box. FedEx blocks headless browsers from this approach, so the API provider below is preferred.

**FedEx Track API** — uses the official [FedEx Track API v1](https://developer.fedex.com/api/en-us/catalog/track/v1/docs.html) with OAuth2 client credentials. Registered at higher priority than the Camoufox scraper; falls through gracefully if API keys are not configured.

### Provider Priority

Providers are checked in this order (first non-null result wins):

1. External providers (from `status_providers` config — highest priority)
2. **FedEx Track API** (built-in, requires API keys)
3. **Camoufox scrapers** (built-in — USPS, UPS, FedEx)

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FEDEX_API_KEY` | For FedEx | FedEx API key (client ID) from the [FedEx Developer Portal](https://developer.fedex.com/) |
| `FEDEX_API_SECRET` | For FedEx | FedEx API secret (client secret) |
| `FEDEX_API_URL` | No | FedEx API base URL (default: `https://apis.fedex.com`). Use `https://apis-sandbox.fedex.com` for testing. |
| `CAMOUFOX_STATUS_PYTHON` | No | Path to the Python 3 binary with `camoufox` installed (default: `python3`). Useful when the system Python lacks Camoufox dependencies. |

### Camoufox Python Requirements

The USPS and UPS scrapers (and FedEx fallback) use [Camoufox](https://camoufox.com/), an anti-detect Firefox fork, via a Python subprocess. Setup:

1. **Python 3.11+** is required.

2. **Install the Python package** (with GeoIP data for realistic geolocation):

   ```bash
   pip install camoufox[geoip]
   ```

3. **Install the Camoufox browser binary:**

   ```bash
   python -m camoufox fetch
   ```

4. **Virtual display (headless servers only)** — if running on a server without a display, install Xvfb:

   ```bash
   # Debian/Ubuntu
   sudo apt install xvfb
   ```

   Camoufox will automatically use Xvfb when no display is available.

5. **Verify the install:**

   ```bash
   python -c "from camoufox.async_api import AsyncCamoufox; print('OK')"
   ```

If your gateway runs under a service manager (e.g., systemd) whose `PATH` resolves to a different Python than your dev shell, set `CAMOUFOX_STATUS_PYTHON` to the full path of the correct Python binary.

### External Provider Plugins

You can register additional carrier providers via the `status_providers` config key in your `openclaw.json`:

```json
{
  "plugins": {
    "package-tracking": {
      "config": {
        "status_providers": [
          "/path/to/my-carrier-provider.js"
        ]
      }
    }
  }
}
```

Each external provider module must export a `register(registry)` function:

```typescript
import type { StatusProviderRegistry } from "carapace-package-tracking";

export function register(registry: StatusProviderRegistry): void {
  registry.register({
    name: "My Carrier",
    carriers: ["MYCARRIER"],
    async getStatus(trackingNumber, carrier) {
      // Return CarrierStatusResult or null to pass through
    },
  });
}
```

External providers are loaded last, giving them the highest priority.

## CLI Usage

Every tool is also available as a standalone CLI after building:

```bash
npm run build
package-tracking --help
package-tracking package-track --tracking-number 1Z999AA10123456784
package-tracking package-add --tracking-number 1Z999AA10123456784 --label "Birthday gift"
package-tracking package-list
package-tracking package-scan --text "Your package 1Z999AA10123456784 has shipped!"
```

## Storage

Tracked packages are persisted to `~/.openclaw/package_tracking.json`, compatible with other OpenClaw tools.

## License

MIT
