# MyoMars 宇航员 HUD · 基站接入版

> 消息格式：仓库 `main` 上的 **MyoMars shared message contracts v1**（`myomars/v1`），副本在 `contracts-v1/`。契约尚未提供 relay，本版附一个按其意图（HTTP publish + SSE）实现的本地 **mock relay + mock Mars Station**。映射与剩余缺口见 [contract/v1-integration.md](contract/v1-integration.md)。

## 启动

需要 Node.js ≥ 22，无第三方依赖。

```bash
npm start            # = node server/mock-base.mjs，默认端口 8787（PORT=xxxx 可改）
```

- 宇航员 HUD：http://127.0.0.1:8787/hud.html
- Mock 基站控制台：http://127.0.0.1:8787/mock

三个场景（开场选择，也可在左下「Link test tools」切换）：**1 · Normal → GREEN**、**2 · Muscle fatigue → AMBER（休息并复测）**、**3 · Sensor malfunction → RED（重连并验证，不做肌肉判断）**，详见 [contract/v1-integration.md](contract/v1-integration.md) §2b。

场景 2 演示顺序：HUD 选「Scenario 2 · Muscle fatigue」→ 按住 W 照常行走（本地设备自动分段上传步行片段，状态行显示 Auto-monitoring · last sync）→ 约 3 段可比片段后站点判定偏离、人工复核批准（mock 自动，也可在控制台手动批准）→ HUD 收到 `station.notice.approved` + `station.retest.requested`（自动回传 `hud.received`）→ 点「Acknowledge」（`hud.ack`）→ View task → Defer（选原因，`hud.defer`）或 Start retest → 采集完成后「Submit simulated retest result」（`retest.result`）→ `station.receipt` → 等待重评 → `station.reassessment` v2 → 控制台「Station: close case」。

> 也可以双击打开：先双击 `start-base.command` 启动基站（会打开一个终端窗口，关掉即停止），再双击 `hud.html`。双击打开的 HUD 会自动连接 `127.0.0.1:8787`；基站没启动时，右上角会提示 `Start the base: npm start`。
> `mars-hud-scene.html` 是不接基站的离线演示版，保留不变。

## 构建

```bash
npm run build        # 生成 dist/（静态 HUD + 契约 + mock 基站），cd dist && node server/mock-base.mjs 即可运行
```

## 联调测试

```bash
npm test                        # 客户端 ↔ mock relay/station：49 项（含三个场景、症状扩展与逐条契约校验）
node test/hud-page-test.mjs     # 运行真实 hud.html 脚本、点击按钮：46 项
```

结果写入 `test/joint-test-result.json`、`test/hud-page-test-result.json`。

## 目录

| 路径 | 说明 |
|---|---|
| `hud.html` | 接入版 HUD（全景场景 + 基站驱动的告警 / 复测） |
| `hud/base-client.js` | contracts v1 客户端：SSE 订阅、hud.received / hud.ack / hud.defer / retest.result、observation 上报、发件箱补传、去重、断线恢复 |
| `hud/contract-v1.js` | 契约校验（JSON Schema 子集 + event-rules），mock 和测试共用 |
| `contracts-v1/` | 共享契约副本（schema、examples、scenarios） |
| `server/mock-base.mjs` | mock relay（HTTP publish + SSE，逐条契约校验）+ mock Mars Station（零依赖） |
| `server/console.html` | mock 基站控制台 |
| `contract/v1-integration.md` | HUD 流程与契约事件的映射、剩余缺口 V1-01…10 |
| `contract/samples/retest-result.sample.json` | 占位模拟复测样例（待底座替换） |
| `test/` | 联调测试脚本与结果 |
