# MyoMars 宇航员 HUD · 基站接入版

> ⚠ 临时契约：公共底座的最终契约与示例尚未交付，本版按 **SRS v0.1 草案** 接入，并附一个本地 **mock 基站** 用于联调。假设与接口缺口见 [contract/draft-v0.1.md](contract/draft-v0.1.md)。底座到位后只需替换 `hud/base-client.js` 中的映射和 `contract/samples/` 下的样例。

## 启动

需要 Node.js ≥ 22，无第三方依赖。

```bash
npm start            # = node server/mock-base.mjs，默认端口 8787（PORT=xxxx 可改）
```

- 宇航员 HUD：http://127.0.0.1:8787/hud.html
- Mock 基站控制台：http://127.0.0.1:8787/mock

演示顺序：HUD 点「Start patrol」→ 按住 W 照常行走（本地设备自动分段上传步行片段，状态行显示 Auto-monitoring · last sync）→ 约 3 段可比片段后基站判定偏离、复核批准（mock 自动，也可在控制台手动批准）→ HUD 收到告警与复测任务（自动回传接收回执）→ HUD 点「确认收到」（人员确认）→ 查看复测 → 暂缓（选原因）或开始复测 → 采集完成后「提交模拟复测结果」→ 已接收 → 等待重评 → 原告警更新为 v2 → 控制台「复核关闭案例」。

> 也可以双击打开：先双击 `start-base.command` 启动基站（会打开一个终端窗口，关掉即停止），再双击 `hud.html`。双击打开的 HUD 会自动连接 `127.0.0.1:8787`；基站没启动时，右上角会提示 `Start the base: npm start`。
> `mars-hud-scene.html` 是不接基站的离线演示版，保留不变。

## 构建

```bash
npm run build        # 生成 dist/（静态 HUD + 契约 + mock 基站），cd dist && node server/mock-base.mjs 即可运行
```

## 联调测试

```bash
npm test                        # 客户端 ↔ mock 基站：35 项
node test/hud-page-test.mjs     # 运行真实 hud.html 脚本、点击按钮：22 项
```

结果写入 `test/joint-test-result.json`、`test/hud-page-test-result.json`。

## 目录

| 路径 | 说明 |
|---|---|
| `hud.html` | 接入版 HUD（全景场景 + 基站驱动的告警 / 复测） |
| `hud/base-client.js` | 订阅、回执、人员确认、暂缓、提交结果、去重、断线恢复（无 DOM，可在 Node 测试） |
| `server/mock-base.mjs` | mock 基站：REST + WebSocket（零依赖） |
| `server/console.html` | mock 基站控制台 |
| `contract/draft-v0.1.md` | 采用的草案接口、消息信封、接口缺口 GAP-01…07 |
| `contract/samples/retest-result.sample.json` | 占位模拟复测样例（待底座替换） |
| `test/` | 联调测试脚本与结果 |
