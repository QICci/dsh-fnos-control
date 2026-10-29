# dsh-fnos-control

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin for **fnOS (飞牛 OS)**. It adds one sidebar entry — **Service Control** — with a single panel offering the two operations the fnOS application already ships, without the keyboard shortcut hunt:

| Action | What it really does |
|---|---|
| **Reload page** | `location.reload()` — the same thing as the app's `F5` / `Ctrl+R`. The process is untouched. |
| **Restart DSH Web** | Asks the fnOS gateway to stop and start the supervised `dsh web` child process, then waits for recovery and reloads the page. |

## Live site

The project page is published at **https://dsh.likkas.cn/**.

## Why this plugin exists

The fnOS application (`fn-deepseek-harness`) runs `dsh web` as a child of its gateway (`gateway-proxy.mjs`). The gateway already publishes a control API on its unix socket:

```
GET  /app/fn-deepseek-harness/__fnos-gateway/control/web/status
POST /app/fn-deepseek-harness/__fnos-gateway/control/web/restart
```

`restart` stops the child, starts it again with the original arguments, waits for the port to pass its health check, then refreshes `app.pid` and the launch token. That is the correct supervisor to ask — restarting "yourself" from inside a supervised process loses the supervisor's handshake. This plugin wraps that path in a UI, and keeps a standalone detached-helper fallback for hosts with no fnOS gateway (for example a plain `dsh web` started by hand).


## Direct download

A built tarball is hosted at `cloud.likkas.cn`; the project site (`site/index.html`) exposes it behind a
slide-to-download control so a stray click never starts a transfer. The published file is
`dsh-fnos-control-0.1.0.tgz` (SHA-256 `2cb26a3b0d21b5815af3bdde8d68dcf26616374b584a5c00c442e4105f175cf5`).
Verify a download with `node package/scripts/smoke.mjs` before installing.

## Requirements

- DeepSeek Harness `>= 0.2.1-rc.2` (verified on `0.2.1-rc.3`)
- Node.js `>= 20`
- fnOS application `fn-deepseek-harness` for the gateway restart path. Without it the panel still renders and the helper fallback is used.

## Install

### From this directory (development / local checkout)

```bash
dsh plugin --profile web add /path/to/dsh-fnos-control
```

Then make sure the bundle is applied — adding it through the plugin manager does this automatically:

```bash
# Or via the DSH UI: Plugins → install bundle → pick the directory
```

### From a tarball

```bash
tar -xzf dsh-fnos-control-0.1.0.tar.gz
dsh plugin --profile web add ./package
```

### Listing it in the profile

`dsh plugin add` appends the bundle name to `dsh.profile.bundles` in the profile's `package.json`. If you install by hand, add `dsh-fnos-control` there yourself:

```json
{ "dsh": { "profile": { "bundles": ["...", "dsh-fnos-control"] } } }
```

Do **not** also insert the same row into the profile's `cordis.patch.yml`: one row, one mount, otherwise boot fails with a duplicate loader entry id.

## What it adds

**Sidebar entry** — `sidebar.panellist` id `fnos-control`, order `60`, label from the plugin's locale (`服务控制` / `Service Control`).

**Main panel** — `main` slot keyed `fnos-control`, so the sidebar button opens it.

**Host routes** (both require the `x-dsh-control: 1` header and answer loopback peers only):

| Route | Method | Purpose |
|---|---|---|
| `/dsh-fnos-control/api/status` | `GET` | Serving PID, port, origin, argv, gateway socket reachability and state, PID recorded by the gateway, detected supervisor. |
| `/dsh-fnos-control/api/restart` | `POST` | Schedules the restart: gateway path when the fnOS socket exists, detached-helper path otherwise. Refuses under systemd and under a debugger. |

## Safety model

- Restart is a two-step click (confirm within 5 seconds).
- The restart route accepts `POST` only, loopback only, with the package's own header — a cross-site form or image cannot send it.
- The Host half never restarts when it detects a systemd unit (the detached helper would die with the cgroup) and reports why instead.
- The page polls for recovery: gateway mode reads `/__fnos-gateway/control/web/status` until `running`; direct mode probes the page URL. Timeout is 90 seconds, after which the panel tells you to reload manually.
- Nothing is written to disk by the plugin itself.

## Verification

```bash
node --check index.js && node --check client.js
curl -s -H 'x-dsh-control: 1' http://127.0.0.1:3080/dsh-fnos-control/api/status
```

The status route answering with your PID and the gateway state means the Host half is mounted. The sidebar entry appears after the page loads the plugin's client bundle.

## License

MIT — see [LICENSE](LICENSE).
