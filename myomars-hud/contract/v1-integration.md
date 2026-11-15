# HUD 接入：MyoMars shared message contracts v1

HUD 按仓库 `main` 上的 **MyoMars shared message contracts v1**（`schema: "myomars/v1"`）收发消息，不再使用 SRS v0.1 草案。

- 契约源：仓库根目录 `contracts/`、`docs/myomars/CONTRACTS.md`。本文件夹 `contracts-v1/` 是它的副本（来源提交见 `contracts-v1/SOURCE_COMMIT`），供 mock 中继和测试离线校验。契约更新时整体替换这个文件夹即可。
- 所有数据均为**模拟数据**，不是测量结果、诊断或临床阈值。

## 1. 传输（契约尚未提供）

契约文档写明 relay（“HTTP publish plus Server-Sent Events”）仍是未完成工作，`feat/myomars-foundation` 分支也没有推到远程。HUD 先按这个意图对接一个本地 mock：

| 接口 | 用途 |
|---|---|
| `POST /v1/sessions/{sessionId}/events` | 发布一条 envelope。请求头 `x-myomars-role`（`trigger` / `hud` / `station`）和 `x-myomars-client` 代替认证身份。返回 `{seq, receivedAt, duplicate}` |
| `GET /v1/sessions/{sessionId}/events?after={seq}` | 历史记录（首次打开、刷新、断线重连时重建状态） |
| `GET /v1/sessions/{sessionId}/stream?after={seq}` | Server-Sent Events，`id` = `seq`，支持 `Last-Event-ID` |

mock 中继对每条发布做完整校验：`envelope.schema.json`、对应 `payload.*.schema.json`、`event-rules.json`（发布角色、是否需要 caseId / retestId）；同一 eventId 内容相同视为重发（`duplicate: true`），内容不同返回 409；已结束 run 的消息返回 409 `stale-run`。投递时附加 `seq`、`receivedAt`、`sender`，符合 `delivered.schema.json`。

**真实 relay 发布后**：只需改 `hud/base-client.js` 里 `flush()`（发布）和 `stream()` / `resync()`（订阅）三处的 URL 与认证方式，消息本身不变。

## 2. HUD 流程 ↔ 契约事件

| HUD 场景 | 发送 / 接收 | 说明 |
|---|---|---|
| 开始巡检 | 发 `scenario.start`（Trigger） | 页面里的“贴片 + 本地设备”模拟器扮演 Trigger 角色 |
| 自动巡检监测（步行片段） | 发 `observation.submitted`（Trigger） | 契约只允许 Trigger 发布 observation。时长来自本地步行识别，其余数值来自 `contract/samples/walking-segment.sample.json`。caseId = `{runId}-lq` |
| 正常巡检 · 最近同步时间 | relay 对发布返回的 `seq / receivedAt` | 契约没有 observation 的站点回执，“同步时间”= 中继持久化时间 |
| 基站发现偏离，复核后下发 | 收 `station.notice.approved` + `station.retest.requested` | 只有人工批准后才发布；HUD 不根据遥测生成结论 |
| 设备收到消息 | 自动发 `hud.received`（`messageId` = 站点消息 eventId） | 与人员确认分开 |
| 宇航员点「Acknowledge」 | 发 `hud.ack` | 不等于完成任务 |
| 暂缓（必须选原因） | 发 `hud.defer` | `messageId` = 复测请求的 eventId |
| 开始复测 | 发 `hud.ack`（针对复测请求） | 契约没有单独的“接受”事件 |
| 中止复测 | **不发送** | 契约没有中止事件；本轮采集在本地丢弃，不上传 |
| 提交模拟复测结果 | 发 `retest.result`（HUD） | 带 caseId、retestId；protocol 取自站点的复测请求，信号与特征取自 `contract/samples/retest-result.sample.json`，`context.phase = "retest"` |
| 已接收 | 收 `station.receipt`（`accepted` / `duplicate` / `rejected`） | 只有收到 `accepted` 才显示已接收 |
| 等待重评 → 最终处理 | 收 `station.reassessment`（evaluationVersion ≥ 2） | `caseStatus = closed` 才显示案例关闭 |
| 忽略 | `station.audit.*` 及未知类型 | 按契约要求 |

没有服务回执（relay 未返回 `seq`，或站点未发 `station.receipt`）时，HUD 不显示成功。去重按 eventId；任务按 retestId 合并。

## 2b. 三个演示场景

开场选择场景；本地设备按场景使用不同的模拟贴片数据，**站点只根据数据判断**，不读取场景名。切换场景会先发 `scenario.reset` 结束旧 run，再发新的 `scenario.start`（`scenarioId` = `myomars-normal` / `myomars-fatigue` / `myomars-sensor-fault`）。

| 场景 | 本地设备数据 | 站点判断（mock 规则，非临床阈值） | 站点发布 | HUD |
|---|---|---|---|---|
| 1 · Normal | `walking-normal`：信号质量合格，特征在个人基线内 | 连续 3 段可比片段在基线内 | `station.notice.approved`（noticeId `…-ok1`） | **GREEN** · Normal · continue patrol |
| 2 · Muscle fatigue | `walking-fatigue`：信号质量合格，中值频率下降、激活升高 | 连续 3 段可比片段呈疲劳模式（中值频率 < 基线 92% 且 RMS > 基线 110%） | 疲劳提示（`…-n1`）+ `station.retest.requested`（先休息再复测） | **AMBER** · Muscle fatigue suspected · rest and retest |
| 3 · Sensor malfunction | `walking-sensor-fault`：阻抗高、掉线、饱和；肌肉状态本身正常 | 连续 2 段信号质量不合格 → 这些片段**不做任何肌肉判断** | 传感器故障提示（`…-sensor1`），无复测任务；重连后 2 段合格片段 → `station.reassessment`（`signal-restored`，`close`） | **RED** · Sensor fault · reconnect the patch and verify → 验证后 GREEN |

场景 3 中，本地设备在第一段数据就能看到接触异常，HUD 立即显示 RED（技术提示，不涉及肌肉状态）；站点的故障提示随后确认。点「Reconnect patch & verify」后，本地设备发送两段 3 秒的验证采集。

## 2c. 场景 2 后续流程（恢复指导 → 症状自查 → 复测）

`AMBER 提示 → Acknowledge → Recovery Guidance → Symptom Check →（现有）复测任务 → （现有）重评`。底部左侧卡片一次只显示一个步骤；站点的复测请求在前置步骤完成前保持挂起，不显示 Start retest。

| 步骤（HUD 内部状态） | 进入条件 | 收发 |
|---|---|---|
| ACK_PENDING | 收到疲劳提示（noticeId `…-n1`） | — |
| RECOVERY_PENDING | 对提示发出 `hud.ack` | 「Defer — Unsafe to Stop」→ `hud.defer`（messageId = 疲劳提示，reason = `Unsafe to stop: …`）→ RECOVERY_DEFERRED，可恢复 |
| RECOVERY_COMPLETED | 查看指引 → Safe to Pause → 确认完成（移动中不可确认） | 无契约事件，按案例保存在本地；刷新不会自动完成 |
| SYMPTOM_CHECK_PENDING / SUBMITTED | 恢复已确认 | 发 `hud.symptoms`（**提议扩展**，见下）；只有收到 `station.receipt` accepted 才算提交成功 |
| MEDICAL_REVIEW_PENDING | 回执表明需复核：站点先发 `station.notice.approved`（noticeId `…-mr1`） | Start retest 禁用；站点也拒收此时的 `retest.result`；医疗组放行 → notice `…-mrc1` |
| RETEST | 症状回执 accepted 且无待处理的医疗复核 | 现有复测流程，不变 |

**演示规则（确定性，非临床阈值）：** 报告任一症状 → 转医疗复核；选「None of the above」→ 允许复测。不设恢复时长。

**提议扩展 `hud.symptoms`**（`contract/extensions/hud.symptoms.json`）：v1 没有症状上报事件，按 CONTRACTS.md「v1 只接受新增」新增一个类型；mock 中继对它做与核心类型相同的 schema + 规则校验；站点用现有 `station.receipt`（`receivedType: "hud.symptoms"`）确认。需团队 PR 评审后才算正式契约。

## 3. 仍需团队确认的缺口

| 编号 | 缺口 | HUD 当前做法 |
|---|---|---|
| V1-01 | relay 未发布（地址、认证、SSE 细节） | 本地 mock，接口见 §1 |
| V1-02 | 没有中止复测事件，也没有「无法执行」「主动报告不适」 | 中止只在本地；后两者未实现，不自建事件类型 |
| V1-03 | observation 的 protocol / features 按握力设计（`targetPctMvc`、`gripForceN`），没有步行或部位字段 | 步行片段用 `protocol.id = "walk-auto-v1"`、`targetPctMvc: 0`、`gripForceN: null`；部位写在 `protocol.label` 前缀（如 `Left quadriceps · …`），HUD 从这里取部位名 |
| V1-04 | observation 没有步数、步频、地形等步行描述 | 不发送；任务条件只用 `context.taskId = "eva-patrol"` |
| V1-05 | 复测请求没有「回舱」字段 | HUD 从 `instructions` 文本判断（含 habitat 即显示 in-habitat） |
| V1-06 | 没有复测轮次字段 | 以 retestId 区分（`…-rt1`、`…-rt2`） |
| V1-07 | observation 没有站点回执，HUD 无法知道片段质量 | 只显示中继同步时间；质量仅在站点侧使用 |
| V1-08 | 契约开放问题：谁创建 caseId；`retest.result` 由谁发 | 本 demo：本地设备（Trigger）创建 caseId；HUD 发 `retest.result` |
| V1-09 | 样例数据：底座只提供握力场景的 fixtures | 步行片段和膝屈复测样例为占位文件，形状符合契约 |
| V1-10 | 提议扩展 `retest.completed` | 未发送（契约说明不发送也完全兼容） |
| V1-11 | `station.notice.approved` 没有类别 / 等级字段（正常、疲劳、传感器故障无法区分） | 用 noticeId 后缀约定：`-ok`、`-n`、`-sensor`；HUD 据此显示 GREEN / AMBER / RED |
| V1-12 | 没有「传感器已验证」专用事件 | 用 `station.reassessment`（`outcome: signal-restored`，`reviewDecision: close`） |
| V1-13 | 没有症状上报事件 | 提议扩展 `hud.symptoms`（见 §2c） |
| V1-14 | 没有医疗复核 / 放行事件，也没有恢复完成事件 | 复核与放行用 notice 后缀 `-mr` / `-mrc`；恢复完成只在本地记录 |
