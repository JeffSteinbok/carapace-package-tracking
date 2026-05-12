# 📦 carapace-package-tracking

[![CI](https://github.com/JeffSteinbok/carapace-package-tracking/actions/workflows/ci.yml/badge.svg)](https://github.com/JeffSteinbok/carapace-package-tracking/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/carapace-package-tracking)](https://www.npmjs.com/package/carapace-package-tracking)

Package tracking plugin for [OpenClaw](https://github.com/JeffSteinbok/openclaw) — track packages across UPS, FedEx, and USPS.

Built with [carapace-plugin-sdk](https://github.com/JeffSteinbok/carapace-plugin-sdk).

## Install

```bash
npm install carapace-package-tracking
```

## Tools

| Tool | Description |
|------|-------------|
| `package_track` | Look up a package by tracking number (detects carrier automatically or accepts override) |
| `package_add` | Save a tracking number for ongoing monitoring |
| `package_remove` | Remove a saved package |
| `package_list` | List all saved packages |
| `package_scan` | Scan free-form text for tracking numbers |

## Supported Carriers

- **UPS** — `1Z` prefix tracking numbers
- **FedEx** — 12, 15, or 20-digit tracking numbers
- **USPS** — 20-22 digit tracking numbers (94-prefix, 92-95 prefix)

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
