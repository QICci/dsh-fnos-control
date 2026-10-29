/**
 * dsh-fnos-control — Client half.
 *
 * One sidebar entry (id `fnos-control`) and one main panel keyed by the same
 * id, so the sidebar's own button opens the panel. The panel exposes the two
 * things the fnOS application already offers: reloading the page (its F5
 * shortcut) and restarting the supervised DSH Web process.
 *
 * The restart path differs by how the page was reached. Through the fnOS
 * gateway the browser calls the gateway control API directly (the gateway is
 * the supervisor, so it outlives the process it replaces and answers after the
 * handshake). Reaching DSH Web directly calls this package's Host route, which
 * forwards the request over the gateway socket and then waits for recovery.
 *
 * @module dsh-fnos-control/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-fnos-control',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-fnos-control';
    const ID = 'fnos-control';
    const STATUS_ROUTE = '/dsh-fnos-control/api/status';
    const RESTART_ROUTE = '/dsh-fnos-control/api/restart';
    const GATEWAY_STATUS = '/__fnos-gateway/control/web/status';
    const GATEWAY_RESTART = '/__fnos-gateway/control/web/restart';
    const CONFIRM_MS = 5000;
    const RECOVERY_TIMEOUT_MS = 90000;

    /** The page prefix the fnOS gateway serves this application under. */
    const BASE = (() => {
      const match = /^\/app\/[^/]+/u.exec(window.location.pathname);
      return match === null ? '' : match[0];
    })();
    const GATEWAY_MODE = BASE !== '';

    const zh = {
      'nav.label': '服务控制',
      'page.title': '飞牛服务控制',
      'page.lede': '刷新当前页面，或让飞牛网关重启被托管的 DSH Web 进程。',
      'badge': 'fnOS',
      'row.mode': '运行模式',
      'mode.gateway': '飞牛应用网关',
      'mode.direct': '直连 DSH Web',
      'row.pid': 'DSH Web 进程 PID',
      'row.port': '监听端口',
      'row.gateway': '网关接口',
      'row.gatewayValue': '可达 · ',
      'row.gatewayDown': '不可达',
      'row.supervised': '网关记录的 PID',
      'row.unknown': '未知',
      'row.argv': '启动参数',
      'status.loading': '正在读取状态…',
      'status.failed': '读取状态失败：',
      'action.refresh': '刷新页面',
      'action.refreshHint': '等同于 F5 / Ctrl+R，仅重新加载当前页面，不重启进程。',
      'action.refreshStatus': '刷新状态',
      'action.restart': '重启 DSH Web',
      'action.confirm': '确认重启？',
      'action.restartHint': '网关会停止并重新拉起 DSH Web；本页会短暂断开，恢复后自动刷新。',
      'action.busy': '重启中…',
      'phase.restarting': '正在请求网关重启…',
      'phase.waiting': '等待服务恢复…（{s} 秒）',
      'phase.done': '服务已恢复，正在刷新页面…',
      'phase.failed': '等待超时，请手动刷新页面重试。',
      'error.restart': '重启请求失败：',
      'error.forbidden': '网关拒绝了重启请求，请确认当前是飞牛管理员会话。',
      'note.title': '原理',
      'note.body': '飞牛应用自带的重启走网关控制接口 /__fnos-gateway/control/web/restart：网关先停止 dsh web 子进程，再按原启动参数重新拉起并更新 PID 与启动令牌。刷新只是重新加载页面。',
      'note.stale': '注意：网关的 PID 文件与当前进程不一致，网关未跟踪此 DSH Web；重启时它会先接管再重启。',
    };
    const en = {
      'nav.label': 'Service Control',
      'page.title': 'fnOS Service Control',
      'page.lede': 'Reload this page, or let the fnOS gateway restart the supervised DSH Web process.',
      'badge': 'fnOS',
      'row.mode': 'Runtime mode',
      'mode.gateway': 'fnOS application gateway',
      'mode.direct': 'Direct DSH Web',
      'row.pid': 'DSH Web PID',
      'row.port': 'Listening port',
      'row.gateway': 'Gateway API',
      'row.gatewayValue': 'reachable · ',
      'row.gatewayDown': 'unreachable',
      'row.supervised': 'PID recorded by the gateway',
      'row.unknown': 'unknown',
      'row.argv': 'Launch arguments',
      'status.loading': 'Reading status…',
      'status.failed': 'Could not read status: ',
      'action.refresh': 'Reload page',
      'action.refreshHint': 'Same as F5 / Ctrl+R: reloads this page only.',
      'action.refreshStatus': 'Refresh status',
      'action.restart': 'Restart DSH Web',
      'action.confirm': 'Confirm restart?',
      'action.restartHint': 'The gateway stops and starts DSH Web; this page disconnects briefly and reloads when the service is back.',
      'action.busy': 'Restarting…',
      'phase.restarting': 'Asking the gateway to restart…',
      'phase.waiting': 'Waiting for recovery… ({s}s)',
      'phase.done': 'Service is back; reloading the page…',
      'phase.failed': 'Timed out; reload the page manually and retry.',
      'error.restart': 'Restart request failed: ',
      'error.forbidden': 'The gateway refused the restart; sign in as the fnOS administrator.',
      'note.title': 'How it works',
      'note.body': 'The built-in fnOS restart uses /__fnos-gateway/control/web/restart: the gateway stops the dsh web child process, then starts it again with the same arguments and refreshes the PID and launch token. Refresh only reloads the page.',
      'note.stale': 'Note: the gateway PID file does not match the running process, so it is not tracking this DSH Web yet; a restart first takes ownership, then restarts it.',
    };

    /** Fallback dictionary when the Client locale service is unavailable. */
    function fallbackTranslate(key) {
      return zh[key] === undefined ? key : zh[key];
    }

    /** Sidebar icon: a refresh ring beside a power mark. */
    function PanelIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 20;
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
        h('path', { d: 'M20.5 12a8.5 8.5 0 1 1-2.56-6.08' }),
        h('path', { d: 'M20.5 4.5v6h-6' }),
        h('path', { d: 'M12 7.5v4.5' }),
        h('path', { d: 'M10 9h4' }),
      );
    }

    const CSS = `
.fnosctl-page{box-sizing:border-box;width:100%;height:100%;overflow-y:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6;scrollbar-gutter:stable}
.fnosctl-inner{box-sizing:border-box;max-width:960px;margin:0 auto;padding:28px clamp(16px,3%,40px) 48px}
.fnosctl-head{display:flex;align-items:center;gap:10px;margin:0 0 6px}
.fnosctl-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.fnosctl-badge{flex:none;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,transparent);border-radius:999px;color:var(--dsw-alias-brand-primary);font-size:11px;line-height:20px;padding:0 8px}
.fnosctl-lede{margin:0 0 22px;color:var(--dsw-alias-label-secondary);font-size:12px}
.fnosctl-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:2px 16px}
.fnosctl-row{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:13px}
.fnosctl-row:last-child{border-bottom:0}
.fnosctl-key{flex:none;color:var(--dsw-alias-label-secondary)}
.fnosctl-val{min-width:0;text-align:right;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.fnosctl-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:1px}
.fnosctl-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.fnosctl-btn{box-sizing:border-box;height:36px;padding:0 16px;border:1px solid transparent;border-radius:18px;font:inherit;font-size:13.5px;line-height:22px;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}
.fnosctl-btn:disabled{opacity:.55;cursor:default}
.fnosctl-btn:focus-visible{outline:2px solid var(--dsw-alias-interactive-bg-hover-accent,rgba(77,107,254,.75));outline-offset:2px}
.fnosctl-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.fnosctl-primary:hover:enabled{background:var(--dsw-alias-button-primary-hover)}
.fnosctl-danger{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-state-error-primary)}
.fnosctl-danger:hover:enabled{background:var(--dsw-alias-interactive-bg-hover-danger)}
.fnosctl-ghost{background:transparent;border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.fnosctl-ghost:hover:enabled{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.fnosctl-hints{margin:12px 0 0;display:grid;gap:4px;color:var(--dsw-alias-label-tertiary);font-size:11.5px}
.fnosctl-msg{min-height:18px;margin-top:12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.fnosctl-msg-ok{color:var(--dsw-alias-state-success-primary)}
.fnosctl-msg-err{color:var(--dsw-alias-state-error-primary)}
.fnosctl-note{margin-top:18px;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px}
.fnosctl-note b{color:var(--dsw-alias-label-primary);font-weight:500}
.fnosctl-warn{color:var(--dsw-alias-state-warn-primary)}
.fnosctl-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:16px;color:var(--dsw-alias-label-tertiary);font-size:11px}
`;

    /** Read the package's own Host status route. */
    async function readStatus() {
      const response = await fetch(BASE + STATUS_ROUTE, {
        headers: { 'x-dsh-control': '1' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('HTTP ' + String(response.status));
      return await response.json();
    }

    /** Ask the active supervisor to restart DSH Web. */
    async function requestRestart() {
      const options = GATEWAY_MODE
        ? {
          method: 'POST',
          headers: { 'x-requested-with': 'fetch', 'x-trim-isadmin': 'true' },
          cache: 'no-store',
        }
        : {
          method: 'POST',
          headers: { 'x-dsh-control': '1' },
          cache: 'no-store',
        };
      let response;
      try {
        response = await fetch(BASE + (GATEWAY_MODE ? GATEWAY_RESTART : RESTART_ROUTE), options);
      } catch (error) {
        // The connection dropping is the expected shape of a restart: the
        // supervisor has already begun replacing the process.
        return undefined;
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body && typeof body.error === 'string' ? body.error : 'HTTP ' + String(response.status);
        const failure = new Error(message);
        failure.status = response.status;
        throw failure;
      }
      return body;
    }

    /** Whether the service answers again after a restart. */
    async function probeRecovered() {
      if (GATEWAY_MODE) {
        const response = await fetch(BASE + GATEWAY_STATUS, { cache: 'no-store' });
        const body = await response.json().catch(() => null);
        return Boolean(response.ok && body && body.state === 'running');
      }
      await fetch(window.location.href, { cache: 'no-store' });
      return true;
    }

    /** The main panel. */
    function ServiceControlPage(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackTranslate;
      const [status, setStatus] = React.useState({ phase: 'loading', data: undefined, error: '' });
      const [phase, setPhase] = React.useState('idle');
      const [message, setMessage] = React.useState('');
      const [seconds, setSeconds] = React.useState(0);
      const confirmTimer = React.useRef(0);
      const pollTimer = React.useRef(0);
      const startedAt = React.useRef(0);
      const alive = React.useRef(true);

      const refreshStatus = React.useCallback(() => {
        readStatus().then((data) => {
          if (!alive.current) return;
          setStatus({ phase: 'ready', data, error: '' });
        }, (error) => {
          if (!alive.current) return;
          setStatus({ phase: 'error', data: undefined, error: String((error && error.message) || error) });
        });
      }, []);

      React.useEffect(() => {
        alive.current = true;
        refreshStatus();
        const interval = window.setInterval(refreshStatus, 15000);
        return () => {
          alive.current = false;
          window.clearInterval(interval);
          window.clearTimeout(confirmTimer.current);
          window.clearTimeout(pollTimer.current);
        };
      }, [refreshStatus]);

      const poll = () => {
        if (!alive.current) return;
        const elapsed = Date.now() - startedAt.current;
        setSeconds(Math.floor(elapsed / 1000));
        if (elapsed > RECOVERY_TIMEOUT_MS) {
          setPhase('failed');
          setMessage(t('phase.failed'));
          return;
        }
        probeRecovered().then((ok) => {
          if (!alive.current) return;
          if (ok) {
            setPhase('done');
            setMessage(t('phase.done'));
            pollTimer.current = window.setTimeout(() => window.location.reload(), 700);
            return;
          }
          pollTimer.current = window.setTimeout(poll, 1800);
        }, () => {
          if (!alive.current) return;
          pollTimer.current = window.setTimeout(poll, 1800);
        });
      };

      const runRestart = () => {
        setPhase('restarting');
        setMessage(t('phase.restarting'));
        startedAt.current = Date.now();
        setSeconds(0);
        requestRestart().then((reply) => {
          if (!alive.current) return;
          if (GATEWAY_MODE && reply && reply.state === 'running') {
            // The gateway answered after its health check, so the replacement is
            // already serving; no polling round trip is needed.
            setPhase('done');
            setMessage(t('phase.done'));
            pollTimer.current = window.setTimeout(() => window.location.reload(), 700);
            return;
          }
          if (GATEWAY_MODE && reply && reply.state === 'error') {
            setPhase('failed');
            setMessage(t('error.restart') + String(reply.error === undefined ? 'unknown' : reply.error));
            return;
          }
          setPhase('waiting');
          setMessage('');
          // Direct mode: the Host route asks the gateway on a short delay and then
          // this process is replaced, so give the handoff room before probing.
          pollTimer.current = window.setTimeout(poll, GATEWAY_MODE ? 0 : 5500);
        }, (error) => {
          if (!alive.current) return;
          if (GATEWAY_MODE && error && error.status === 403) {
            setPhase('failed');
            setMessage(t('error.forbidden'));
            return;
          }
          setPhase('failed');
          setMessage(t('error.restart') + String((error && error.message) || error));
        });
      };

      const onRestart = () => {
        if (phase === 'restarting' || phase === 'waiting') return;
        if (phase !== 'confirm') {
          setPhase('confirm');
          confirmTimer.current = window.setTimeout(() => {
            if (alive.current) setPhase((current) => (current === 'confirm' ? 'idle' : current));
          }, CONFIRM_MS);
          return;
        }
        window.clearTimeout(confirmTimer.current);
        runRestart();
      };

      const busy = phase === 'restarting' || phase === 'waiting' || phase === 'done';
      const data = status.phase === 'ready' ? status.data : undefined;
      const gateway = data && data.gateway ? data.gateway : undefined;
      const gatewayText = gateway === undefined
        ? (status.phase === 'loading' ? t('status.loading') : (status.phase === 'error' ? t('status.failed') + status.error : t('row.unknown')))
        : gateway.reachable === true
          ? h(React.Fragment, null,
            h('span', { className: 'fnosctl-dot', style: { background: 'var(--dsw-alias-state-success-primary)' } }),
            t('row.gatewayValue') + String(gateway.state))
          : h(React.Fragment, null,
            h('span', { className: 'fnosctl-dot', style: { background: 'var(--dsw-alias-state-error-primary)' } }),
            t('row.gatewayDown') + (gateway.state === 'not-found' ? '' : ' · ' + String(gateway.state)));

      const stale = data !== undefined
        && gateway !== undefined && gateway.reachable === true
        && gateway.state === 'stopped'
        && data.supervisedWebPid === undefined;

      const msgClass = phase === 'failed'
        ? 'fnosctl-msg fnosctl-msg-err'
        : (phase === 'done' ? 'fnosctl-msg fnosctl-msg-ok' : 'fnosctl-msg');

      return h(React.Fragment, null,
        h('style', null, CSS),
        h('div', { className: 'fnosctl-page' },
          h('div', { className: 'fnosctl-inner' },
            h('div', { className: 'fnosctl-head' },
              h('h1', { className: 'fnosctl-title' }, t('page.title')),
              h('span', { className: 'fnosctl-badge' }, t('badge')),
            ),
            h('p', { className: 'fnosctl-lede' }, t('page.lede')),

            h('div', { className: 'fnosctl-card' },
              h('div', { className: 'fnosctl-row' },
                h('span', { className: 'fnosctl-key' }, t('row.mode')),
                h('span', { className: 'fnosctl-val' }, GATEWAY_MODE ? t('mode.gateway') : t('mode.direct')),
              ),
              h('div', { className: 'fnosctl-row' },
                h('span', { className: 'fnosctl-key' }, t('row.pid')),
                h('span', { className: 'fnosctl-val' }, data && Number.isInteger(data.host.pid) ? String(data.host.pid) : t('row.unknown')),
              ),
              h('div', { className: 'fnosctl-row' },
                h('span', { className: 'fnosctl-key' }, t('row.port')),
                h('span', { className: 'fnosctl-val' }, data && Number.isInteger(data.host.port) ? String(data.host.port) : t('row.unknown')),
              ),
              h('div', { className: 'fnosctl-row' },
                h('span', { className: 'fnosctl-key' }, t('row.gateway')),
                h('span', { className: 'fnosctl-val' }, gatewayText),
              ),
              h('div', { className: 'fnosctl-row' },
                h('span', { className: 'fnosctl-key' }, t('row.supervised')),
                h('span', { className: 'fnosctl-val' }, data && Number.isInteger(data.supervisedWebPid) ? String(data.supervisedWebPid) : t('row.unknown')),
              ),
            ),

            h('div', { className: 'fnosctl-actions' },
              h('button', {
                type: 'button',
                className: 'fnosctl-btn fnosctl-primary',
                onClick: () => window.location.reload(),
              }, t('action.refresh')),
              h('button', {
                type: 'button',
                className: 'fnosctl-btn fnosctl-danger',
                disabled: busy,
                onClick: onRestart,
              }, phase === 'confirm' ? t('action.confirm') : (busy ? t('action.busy') : t('action.restart'))),
              h('button', {
                type: 'button',
                className: 'fnosctl-btn fnosctl-ghost',
                onClick: refreshStatus,
                disabled: busy,
              }, t('action.refreshStatus')),
            ),

            h('div', { className: 'fnosctl-hints' },
              h('span', null, t('action.refreshHint')),
              h('span', null, t('action.restartHint')),
            ),
            h('div', { className: msgClass }, message !== '' ? message : null),
            h('div', { className: 'fnosctl-note' },
              h('b', null, t('note.title') + '：'),
              h('span', null, t('note.body')),
              stale ? h('div', { className: 'fnosctl-warn' }, t('note.stale')) : null,
            ),
            h('div', { className: 'fnosctl-meta' },
              h('span', null, 'dsh-fnos-control 0.1.0'),
              h('span', null, BASE === '' ? 'direct' : BASE),
            ),
          ),
        ),
      );
    }

    return {
      name: 'dsh-fnos-control',
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots');
        if (slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return;
        const locale = ctx.get('locale');
        let t = fallbackTranslate;
        if (locale !== undefined && typeof locale.register === 'function' && typeof locale.bind === 'function') {
          ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-fnos-control: dictionaries');
          t = locale.bind(NS);
        }

        ctx.effect(() => slots.inject('sidebar.panellist', () => slots.register({
          name: 'sidebar.panellist',
          id: ID,
          order: 60,
          locale: NS,
          label: () => t('nav.label'),
        }, PanelIcon)), 'dsh-fnos-control: sidebar entry');

        ctx.effect(() => slots.inject('main', () => slots.register({
          name: 'main',
          key: ID,
          locale: NS,
        }, (props) => h(ServiceControlPage, Object.assign({}, props, { t })))), 'dsh-fnos-control: main panel');
      },
    };
  },
});
