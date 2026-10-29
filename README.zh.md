# dsh-fnos-control

[English](README.md) | 中文

一个给 **飞牛 OS（fnOS）** 用的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件。它在左侧栏加一个入口——**服务控制**——面板里就两个按钮，专治「快捷键记不住」：

| 操作 | 实际做的事 |
|---|---|
| **刷新页面** | `location.reload()`，和飞牛 App 自带的 `F5` / `Ctrl+R` 完全一样，不碰进程。 |
| **重启 DSH Web** | 请求飞牛网关停掉再拉起被托管的 `dsh web` 子进程，等恢复后自动刷新页面。 |

## 在线页面

官网发布在 **https://dsh.likkas.cn/**。

## 为什么需要它

飞牛应用（`fn-deepseek-harness`）把 `dsh web` 当子进程托管在网关（`gateway-proxy.mjs`）下面。网关本身已经发布了控制接口：

```
GET  /app/fn-deepseek-harness/__fnos-gateway/control/web/status
POST /app/fn-deepseek-harness/__fnos-gateway/control/web/restart
```

`restart` 会停子进程 → 用原参数重新拉起 → 等端口健康检查通过 → 更新 `app.pid` 与启动令牌。**这才是正确的重启姿势**：在被托管的进程里「自己重启自己」会丢掉网关的握手。本插件把这条路径包成了界面，同时保留一个独立的 detached helper 兜底，供没有飞牛网关的环境（比如手动跑起来的 `dsh web`）使用。


## 直接下载

构建好的压缩包附在 [v0.1.0 Release](https://github.com/QICci/dsh-fnos-control/releases/tag/v0.1.0) 里；
官网（`site/index.html`）用「滑动解锁」的控件放出下载，手滑点一下不会真的开始传输。
发布文件为 `dsh-fnos-control-0.1.0.tgz`
（SHA-256 `ebd31664752bba3139e12c02e5d31283ac7ce3d31cae87b71912958f20d7fb2a`）。
装之前可以先跑 `node package/scripts/smoke.mjs` 验证下载是否完整。

## 环境要求

- DeepSeek Harness `>= 0.2.1-rc.2`（已在 `0.2.1-rc.3` 验证）
- Node.js `>= 20`
- 走网关重启需要飞牛应用 `fn-deepseek-harness`；没有它面板照常显示，只是走 helper 兜底。

## 安装

### 从本地目录（开发 / 本地副本）

```bash
dsh plugin --profile web add /path/to/dsh-fnos-control
```

### 从压缩包

```bash
tar -xzf dsh-fnos-control-0.1.0.tar.gz
dsh plugin --profile web add ./package
```

### 登记进 profile

`dsh plugin add` 会自动把包名追加到 profile `package.json` 的 `dsh.profile.bundles`。手工安装的话自己加一行：

```json
{ "dsh": { "profile": { "bundles": ["...", "dsh-fnos-control"] } } }
```

**不要**再往 profile 的 `cordis.patch.yml` 里插同名行：一行一挂载，重复会直接启动失败。

## 它加了什么

**左侧栏入口** —— `sidebar.panellist`，id `fnos-control`，order `60`，文字来自插件自己的语言包（`服务控制` / `Service Control`）。

**主面板** —— `main` 槽位，key 也是 `fnos-control`，点侧栏图标就打开。

**Host 路由**（都要带 `x-dsh-control: 1` 头，且只答回环地址）：

| 路由 | 方法 | 用途 |
|---|---|---|
| `/dsh-fnos-control/api/status` | `GET` | 当前 PID、端口、origin、启动参数、网关 socket 可达性与状态、网关记录的 PID、检测到的 supervisor。 |
| `/dsh-fnos-control/api/restart` | `POST` | 安排重启：有飞牛 socket 走网关，没有则走 detached helper；systemd 下和调试器下会拒绝。 |

## 安全模型

- 重启是两步点击（5 秒内确认）。
- 重启路由只收 `POST`、只收回环、必须带插件自己的头——跨站表单或图片发不出来。
- Host 侧检测到 systemd 单元时会拒绝重启（detached helper 会被 cgroup 一起带走），并如实报告原因。
- 页面会轮询恢复：网关模式读 `/__fnos-gateway/control/web/status` 直到 `running`；直连模式探测本页 URL。超时 90 秒，之后提示手动刷新。
- 插件自己不往磁盘写任何东西。

## 自检

```bash
node --check index.js && node --check client.js
curl -s -H 'x-dsh-control: 1' http://127.0.0.1:3080/dsh-fnos-control/api/status
```

状态路由能返回你的 PID 和网关状态，说明 Host 半已经挂上；左侧栏图标要等页面加载了插件的 client bundle 才会出现。

## 许可

MIT —— 见 [LICENSE](LICENSE)。
