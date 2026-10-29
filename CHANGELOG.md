# Changelog

## 0.1.0 — 2026-10-29

First release.

- Sidebar entry (`sidebar.panellist` id `fnos-control`) and a `main` panel keyed by the same id.
- **Reload page** — reuses the page's own `location.reload()`, the same behaviour as the fnOS application's `F5` / `Ctrl+R`.
- **Restart DSH Web** — forwards to the fnOS gateway control API (`/__fnos-gateway/control/web/restart`) over its unix socket, then polls `/status` until the replacement reports `running` and reloads the page.
- Detached-helper fallback for hosts without a fnOS gateway; refuses under systemd and under a debugger.
- Host routes `/dsh-fnos-control/api/status` and `/dsh-fnos-control/api/restart`, loopback-only and gated by an `x-dsh-control` header.
- Display metadata: Chinese and English locales, original SVG icon, bundle/plugin titles and descriptions.
