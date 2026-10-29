/**
 * dsh-fnos-control — Host half.
 *
 * Exposes the two operations behind the sidebar "fnOS service control" panel:
 *
 *  - a read-only status route that reports the serving DSH process and whether
 *    the fnOS gateway (the app's supervisor) is reachable over its unix socket;
 *  - a restart route. Under the fnOS application the gateway owns the DSH Web
 *    child process and publishes `/__fnos-gateway/control/web/{status,start,restart}`
 *    on `app.sock`; asking the gateway to restart keeps its PID file, launch
 *    token and health-check handshake intact, so that is the preferred path.
 *    A detached helper (the shape dsh-simple-restart uses) covers a host that
 *    has neither a gateway socket nor a systemd supervisor.
 *
 * Both routes require the package's own `x-dsh-control: 1` header, which a
 * cross-site form or image cannot send, and they only answer loopback peers.
 * The Client half calls them from the same origin; a browser reaching the
 * `fnOS` gateway instead calls the gateway route directly, because the gateway
 * outlives the process it restarts and can answer after the handshake.
 *
 * @module dsh-fnos-control
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { resolve } from 'node:path'

/** The web carrier is the only hard dependency: without it there is no route. */
export const inject = ['webServer']

/** Routes this plugin owns on the DSH Web server. */
const STATUS_ROUTE = '/dsh-fnos-control/api/status'
const RESTART_ROUTE = '/dsh-fnos-control/api/restart'

/** fnOS gateway: socket candidates and the prefix its control API lives under. */
const GATEWAY_SOCKETS = [
  '/var/apps/fn-deepseek-harness/target/app.sock',
  '/vol1/@appcenter/fn-deepseek-harness/app.sock',
]
const GATEWAY_PREFIX = '/app/fn-deepseek-harness'
const GATEWAY_CONTROL = '/__fnos-gateway/control/web'

/** The fnOS app's PID file for the Web process the gateway supervises. */
const GATEWAY_PID_FILE = '/var/apps/fn-deepseek-harness/var/app.pid'

/** How long the two routes wait on the gateway socket before reporting it. */
const STATUS_TIMEOUT_MS = 4000
const RESTART_TIMEOUT_MS = 60000

/** One restart request at a time; the process is about to be replaced. */
let restartScheduled = false

/**
 * Whether the gateway socket exists and is reachable.
 * @returns {string | undefined} the first existing socket path.
 */
function gatewaySocket() {
  for (const candidate of GATEWAY_SOCKETS) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // Permission or transient filesystem error: try the next candidate.
    }
  }
  return undefined
}

/**
 * POST/GET one gateway control endpoint over its unix socket.
 * @param {string} socket - socket path.
 * @param {string} path - path after the gateway prefix, such as `/status`.
 * @param {'GET' | 'POST'} method - HTTP method.
 * @param {number} timeoutMs - deadline for the whole exchange.
 * @returns {Promise<{ reachable: boolean, status?: number, json?: unknown, error?: string }>} the reply.
 */
function callGateway(socket, path, method, timeoutMs) {
  return new Promise((finish) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      finish(value)
    }
    let req
    try {
      req = httpRequest({
        socketPath: socket,
        path: `${GATEWAY_PREFIX}${GATEWAY_CONTROL}${path}`,
        method,
        timeout: timeoutMs,
        headers: {
          accept: 'application/json',
          'x-requested-with': 'fetch',
          // The gateway's web-control middleware requires the fnOS administrator
          // marker. The browser reaching the gateway through fnOS would have it
          // injected; calling from the supervisor's own socket, this package sets
          // it explicitly and still answers only its own loopback callers.
          'x-trim-isadmin': 'true',
          ...(method === 'POST' ? { 'content-length': 0 } : {}),
        },
      }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          if (body.length < 4096) body += chunk
        })
        res.on('end', () => {
          let json
          try {
            json = JSON.parse(body)
          } catch {
            json = undefined
          }
          done({ reachable: true, status: res.statusCode, json })
        })
        res.on('error', (error) => done({ reachable: false, error: String((error && error.message) || error) }))
      })
      req.on('error', (error) => done({ reachable: false, error: String((error && error.code) || error) }))
      req.on('timeout', () => {
        req.destroy()
        done({ reachable: false, error: 'timeout' })
      })
      req.end()
    } catch (error) {
      done({ reachable: false, error: String((error && error.message) || error) })
    }
  })
}

/**
 * Read one PID file.
 * @param {string} file - absolute path.
 * @returns {number | undefined} the recorded process id.
 */
function readPid(file) {
  try {
    const pid = Number.parseInt(readFileSync(file, 'utf8').trim(), 10)
    return Number.isInteger(pid) && pid > 1 ? pid : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether this host looks supervised by systemd, where a detached helper dies
 * with the unit's control group. The fnOS gateway is not systemd, so the
 * primary path is unaffected.
 * @returns {'systemd' | null} the detected supervisor.
 */
function detectedSupervisor() {
  const marked = (process.env.INVOCATION_ID ?? '') !== '' || (process.env.JOURNAL_STREAM ?? '') !== ''
  if (!marked) return null
  if (process.ppid === 1) return 'systemd'
  try {
    return readFileSync(`/proc/${String(process.ppid)}/comm`, 'utf8').trim() === 'systemd' ? 'systemd' : null
  } catch {
    return null
  }
}

/**
 * Only loopback callers that carry this package's header may use the routes.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {boolean} true when the request may control this process.
 */
function trusted(req) {
  if (req.headers['x-dsh-control'] !== '1') return false
  const address = req.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Resolve the serving origin and port without throwing when the carrier has
 * not bound yet.
 * @param {object} ctx - the host context.
 * @returns {{ origin?: string, port?: number }} the serving endpoint facts.
 */
function servingOrigin(ctx) {
  try {
    const origin = ctx.webServer.getOrigin()
    const port = Number.parseInt(new URL(origin).port, 10)
    return { origin, port: Number.isInteger(port) && port > 0 ? port : undefined }
  } catch {
    return {}
  }
}

/**
 * The boot invocation the standalone helper replays.
 * @returns {{ file: string, args: string[], cwd: string }} the launch.
 */
function restartLaunch() {
  const entry = process.argv[1]
  const absolute = entry === undefined ? undefined : resolve(entry)
  const args = absolute !== undefined && /[\\/](?:bin\.js|dsh)$/u.test(absolute)
    ? [absolute, ...process.argv.slice(2)]
    : process.argv.slice(1)
  return { file: process.execPath, args, cwd: process.cwd() }
}

/**
 * A detached helper that waits for the port to go quiet, then starts the
 * replacement. Written as a string so it can outlive this process.
 * @param {{ file: string, args: string[], cwd: string }} launch - the invocation.
 * @param {string} logFile - where the replacement's output goes.
 * @param {number | undefined} port - the port the replacement must take over.
 * @returns {string} the helper program.
 */
function helperSource(launch, logFile, port) {
  return [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    "const net = require('node:net')",
    `const file = ${JSON.stringify(launch.file)}`,
    `const args = ${JSON.stringify(launch.args)}`,
    `const cwd = ${JSON.stringify(launch.cwd)}`,
    `const logFile = ${JSON.stringify(logFile)}`,
    `const port = ${JSON.stringify(port ?? null)}`,
    'const sleep = (ms) => new Promise((r) => setTimeout(r, ms))',
    'const note = (line) => { try { fs.appendFileSync(logFile, "[dsh-fnos-control] " + line + "\\n") } catch {} }',
    'const listening = () => new Promise((done) => {',
    '  if (port === null) return done(false)',
    '  const probe = net.connect({ host: "127.0.0.1", port })',
    '  const settle = (value) => { probe.destroy(); done(value) }',
    '  probe.on("connect", () => settle(true))',
    '  probe.on("error", () => settle(false))',
    '  setTimeout(() => settle(false), 500)',
    '})',
    'const main = async () => {',
    '  if (port !== null) {',
    '    const until = Date.now() + 30000',
    '    while (Date.now() < until && await listening()) await sleep(250)',
    '    await sleep(300)',
    '  } else {',
    '    await sleep(1500)',
    '  }',
    '  const out = fs.openSync(logFile, "a")',
    '  let child',
    '  try {',
    '    child = spawn(file, args, { cwd, detached: true, stdio: ["ignore", out, out], env: process.env })',
    '    child.on("error", (error) => note("could not start the replacement: " + String((error && error.message) || error)))',
    '    child.unref()',
    '    note("replacement started with pid " + String(child.pid))',
    '  } catch (error) {',
    '    note("could not start the replacement: " + String((error && error.message) || error))',
    '  }',
    '}',
    'main()',
  ].join('\n')
}

/**
 * Hand the restart to a detached helper, then terminate this process.
 * @param {number | undefined} port - the port the replacement must take over.
 * @returns {{ pid: number, helperPid: number | undefined, logFile: string }} the handoff.
 */
function scheduleStandaloneRestart(port) {
  const launch = restartLaunch()
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19)
  const logFile = `/tmp/dsh-fnos-control-${stamp}.log`
  const helper = spawn(process.execPath, ['-e', helperSource(launch, logFile, port)], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  helper.unref()
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), 800)
  return { pid: process.pid, helperPid: helper.pid, logFile }
}

/**
 * Write one JSON reply.
 * @param {import('node:http').ServerResponse} res - the reply.
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON-serializable body.
 */
function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/**
 * Mount the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the host context.
 */
export function apply(ctx) {
  const serving = servingOrigin(ctx)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATUS_ROUTE,
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      if (!trusted(req)) {
        sendJson(res, 403, { ok: false, error: 'control header required' })
        return
      }
      const socket = gatewaySocket()
      let gateway
      if (socket === undefined) {
        gateway = { socket: null, reachable: false, state: 'not-found' }
      } else {
        const reply = await callGateway(socket, '/status', 'GET', STATUS_TIMEOUT_MS)
        gateway = {
          socket,
          reachable: reply.reachable,
          state: reply.reachable
            ? (typeof reply.json === 'object' && reply.json !== null && typeof /** @type {any} */(reply.json).state === 'string'
              ? /** @type {any} */(reply.json).state
              : 'unknown')
            : 'unreachable',
          pid: reply.reachable && typeof reply.json === 'object' && reply.json !== null && Number.isInteger(/** @type {any} */(reply.json).pid)
            ? /** @type {any} */(reply.json).pid
            : undefined,
          error: reply.error,
        }
      }
      sendJson(res, 200, {
        ok: true,
        host: {
          pid: process.pid,
          parentPid: process.ppid,
          origin: serving.origin,
          port: serving.port,
          argv: process.argv.slice(2),
        },
        gateway,
        supervisedWebPid: readPid(GATEWAY_PID_FILE),
        supervisor: detectedSupervisor(),
        appDirPresent: existsSync('/var/apps/fn-deepseek-harness'),
      })
    },
  }), 'dsh-fnos-control: status route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RESTART_ROUTE,
    handler: (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed', allow: 'POST' })
        return
      }
      if (!trusted(req)) {
        sendJson(res, 403, { ok: false, error: 'control header required' })
        return
      }
      if (restartScheduled) {
        sendJson(res, 409, { ok: false, error: 'restart already scheduled' })
        return
      }

      const socket = gatewaySocket()
      if (socket !== undefined) {
        restartScheduled = true
        // Answer before the supervisor replaces this process: the gateway stops
        // this host first, so an awaited request would never be delivered.
        sendJson(res, 202, {
          ok: true,
          via: 'gateway',
          socket,
          pid: process.pid,
          detail: 'the fnOS gateway will stop and start the supervised DSH Web process',
        })
        setTimeout(() => {
          callGateway(socket, '/restart', 'POST', RESTART_TIMEOUT_MS).catch(() => undefined)
        }, 1000)
        return
      }

      if (detectedSupervisor() !== null) {
        restartScheduled = false
        sendJson(res, 403, { ok: false, error: 'standalone self-restart is disabled under systemd' })
        return
      }

      try {
        const handoff = scheduleStandaloneRestart(serving.port)
        restartScheduled = true
        sendJson(res, 202, { ok: true, via: 'helper', ...handoff })
      } catch (error) {
        restartScheduled = false
        sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  }), 'dsh-fnos-control: restart route')
}
