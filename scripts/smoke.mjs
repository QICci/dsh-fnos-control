#!/usr/bin/env node
/**
 * Smoke test for dsh-fnos-control.
 *
 * Verifies everything that can be checked without a live Harness: the bundle
 * manifest, the patch, the locale resources, the icon, the Host export shape and
 * the Client factory (registering the sidebar entry and the main panel, then
 * rendering both components to static markup).
 *
 * The Client module is loaded the way the browser loads it: a fake
 * `window.__ModuleLoader__.load` captures the definition, and the factory is
 * called with the real React from the Harness profile when one is available.
 *
 * Usage: node scripts/smoke.mjs
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const failures = []
const checks = []

/**
 * Record one check.
 * @param {string} label - what is being verified.
 * @param {(result: unknown) => boolean} [assert] - optional predicate over the produced value.
 * @param {() => unknown} run - the check body, returning the comparable value.
 */
function check(label, run, assert = (value) => value !== false) {
  try {
    const value = run()
    if (!assert(value)) throw new Error(`unexpected value: ${JSON.stringify(value)}`)
    checks.push({ label, ok: true })
  } catch (error) {
    failures.push(`${label}: ${String((error && error.message) || error)}`)
  }
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const localeDir = join(root, 'locale')

check('manifest declares the bundle patch', () => manifest.dsh?.bundle?.patch, (v) => v === './cordis.patch.yml')
check('manifest declares the web client half', () => manifest.dsh?.client?.platform, (v) => v === 'web')
check('manifest exports the client subpath', () => manifest.exports?.['./client'], (v) => v === './client.js')
check('manifest exports locale resources', () => manifest.exports?.['./locale/*.json'], (v) => typeof v === 'string')
check('manifest declares an icon', () => manifest.icon, (v) => typeof v === 'string')
check('manifest declares a dsh engine range', () => manifest.engines?.dsh, (v) => typeof v === 'string' && v.length > 0)
check('manifest names every shipped file', () => (manifest.files ?? []).join(','), (v) => String(v).includes('client.js'))
check('manifest is publishable (private is not true)', () => manifest.private !== true)

check('patch inserts exactly one row', () => readFileSync(join(root, 'cordis.patch.yml'), 'utf8'), (source) =>
  (source.match(/^\s*-\s*id:/gmu) ?? []).length === 1 && String(source).includes(manifest.name))

for (const locale of ['zh', 'en']) {
  check(`locale/${locale}.json carries meta title and description`, () => {
    const dict = JSON.parse(readFileSync(join(localeDir, `${locale}.json`), 'utf8'))
    return [dict.meta?.title, dict.meta?.description].every((value) => typeof value === 'string' && value.length > 0)
  })
  check(`locale/${locale}.json parses`, () => JSON.parse(readFileSync(join(localeDir, `${locale}.json`), 'utf8')), (v) => typeof v === 'object')
}

check('icon exists inside the package and is a plausible size', () => {
  const file = join(root, manifest.icon)
  if (!existsSync(file)) return false
  const size = statSync(file).size
  return size > 0 && size <= 256 * 1024
}, (ok) => ok === true)

check('icon is well-formed svg', () => readFileSync(join(root, manifest.icon), 'utf8'), (source) =>
  String(source).trimStart().startsWith('<svg') && String(source).includes('</svg>'))

const indexModule = await import(pathToFileURL(join(root, 'index.js')).href).catch((error) => ({ error }))
check('host half exports apply(ctx)', () => typeof indexModule.apply, (v) => v === 'function')
check('host half injects the web carrier', () => (indexModule.inject ?? []).join(','), (v) => String(v).split(',').includes('webServer'))

/**
 * Resolve React from the Harness profile, when this checkout sits beside one.
 * @returns {Promise<{ React: any, renderToStaticMarkup: (node: unknown) => string } | undefined>} the renderer.
 */
async function loadReact() {
  const candidates = [
    // The profile this package is installed into, when the caller exports it.
    ...(process.env.DSH_PROFILE_DIR ? [join(process.env.DSH_PROFILE_DIR, 'node_modules')] : []),
    // This checkout's neighbours: scripts/ -> package/ -> workspace/ -> @appshare/ -> vol1/.
    resolve(here, '../../../../../@apphome/fn-deepseek-harness/profiles/web/node_modules'),
    resolve(here, '../../../profiles/web/node_modules'),
  ]
  for (const relative of candidates) {
    const dir = resolve(here, relative)
    if (!existsSync(join(dir, 'react'))) continue
    const React = (await import(pathToFileURL(join(dir, 'react/index.js')).href)).default
    const server = await import(pathToFileURL(join(dir, 'react-dom/server.js')).href)
    return { React, renderToStaticMarkup: server.renderToStaticMarkup }
  }
  return undefined
}

const renderer = await loadReact()
if (renderer === undefined) {
  console.log('· react not found next to this checkout; skipping the Client render checks (they need the Harness profile)')
} else {
  let captured
  globalThis.window = {
    location: { pathname: '/app/fn-deepseek-harness/', href: 'http://127.0.0.1:3080/app/fn-deepseek-harness/' },
    __ModuleLoader__: { load(definition) { captured = definition } },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  }
  await import(pathToFileURL(join(root, 'client.js')).href)

  check('client half registers a factory named after the package', () => captured?.id, (v) => v === manifest.name)

  const plugin = captured.factory((name) => {
    if (name === 'react') return renderer.React
    throw new Error(`unexpected require: ${name}`)
  })
  check('client plugin declares its name', () => plugin.name, (v) => typeof v === 'string' && v === plugin.name)

  const registrations = []
  const dicts = {}
  const slots = {
    inject(key, callback) {
      const result = callback()
      return result
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  }
  const locale = {
    register(namespace, entries) {
      dicts[namespace] = entries
      return () => {}
    },
    bind(namespace) {
      return (key) => dicts[namespace]?.zh?.[key] ?? key
    },
  }
  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      if (name === 'locale') return locale
      return undefined
    },
    effect(callback) {
      const result = callback()
      return () => {
        if (typeof result === 'function') result()
      }
    },
  }
  check('client plugin applies without throwing', () => {
    plugin.apply(ctx)
    return true
  })

  check('registers a sidebar entry and a main panel', () => registrations.length, (v) => v === 2)

  const sidebar = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
  const main = registrations.find((entry) => entry.options.name === 'main')
  check('sidebar entry uses the fnos-control id', () => sidebar?.options.id, (v) => v === 'fnos-control')
  check('main panel uses the matching key', () => main?.options.key, (v) => v === 'fnos-control')
  check('sidebar label resolves through the locale', () => sidebar.options.label(), (v) => v === '服务控制')
  check('both locale dictionaries cover the same keys', () => {
    const zhKeys = Object.keys(dicts[manifest.name]?.zh ?? {})
    const enKeys = Object.keys(dicts[manifest.name]?.en ?? {})
    return zhKeys.length > 0 && zhKeys.length === enKeys.length
  })
  check('sidebar icon renders an svg', () =>
    renderer.renderToStaticMarkup(renderer.React.createElement(sidebar.component, { size: 20, active: false })), (html) =>
    String(html).startsWith('<svg'))
  check('main panel renders its controls', () =>
    renderer.renderToStaticMarkup(renderer.React.createElement(main.component, {})), (html) =>
    ['fnosctl-page', '刷新页面', '重启 DSH Web', '运行模式'].every((needle) => String(html).includes(needle)))
}

for (const entry of checks) console.log(`✓ ${entry.label}`)
if (failures.length > 0) {
  console.error('')
  for (const failure of failures) console.error(`✗ ${failure}`)
  console.error(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
console.log(`\nAll ${checks.length} checks passed.`)
