# HUD 接入契约（临时 · 依据 SRS v0.1 草案）

> 公共底座尚未交付最终契约与示例。本文件只记录 HUD 当前按 SRS v0.1 草案做的**假设**，以及需要底座补齐的**接口缺口**。底座契约到位后，以底座为准替换本文件和 `hud/base-client.js` 中的映射，HUD 页面不需要改。

## 1. 采用的草案接口（来自 SRS v0.1 §API）

| 草案接口 | HUD 用途 |
|---|---|
| `WSS /v1/stream` | 下行 `alert.updated`、`retest.requested`；上行 `telemetry.window`（复测结果复用采集接口并带 `retestId`），基站回 `telemetry.ack` |
| `GET /v1/events?after=<cursor>` | 首次打开、刷新、断线重连时补取事件、恢复状态 |
| `POST /v1/alerts/{id}/ack` | 宇航员点击「确认收到」后的**人员确认**（按告警版本，可重试，重复返回原结果） |
| `POST /v1/retests/{id}/responses` | 接受 / 暂缓（附原因）/ 中止；状态冲突返回当前版本（409） |

### 消息信封（草案要求：schemaVersion、messageId、simulated、UTC 时间、游标）

```json
{
  "schemaVersion": "0.1-draft",
  "messageId": "evt-…",
  "type": "alert.updated | retest.requested",
  "cursor": 12,
  "crewId": "A-02",
  "issuedAt": "2026-11-14T06:02:11.000Z",
  "simulated": true,
  "payload": { }
}
```

- `alert.updated.payload`：`alertId, version, status(published|reassessed|closed), levelLabel, title, reason, nextAction, finding, dataTime, reviewedAt, basedOn?{retestId, round, resultSessionId}, disposition?`
- `retest.requested.payload`：`retestId, alertId, round, version, status, protocol{id,version}, bodySite, action, durationSec, validUntil, deferReason?, abortReason?, resultSessionId?`
- 上行 `telemetry.window.payload`（复测结果）：`retestId, alertId, round, sessionId, simulated:true, sampleId, protocol, metrics[{name,value,unit}]`

HUD 只渲染基站已发布（审核后）的 `alert.updated` / `retest.requested`，不根据遥测生成任何健康结论。

## 1b. 自动巡检监测（步行片段）

- 本地设备从持续采集中自动识别步行片段（≥2 s 才上传，最长 6 s 一段），经 `WSS /v1/stream` 上行 `telemetry.window`：
  `payload = { kind: "walking-segment", segmentId, startedAt, endedAt, durationSec, steps, cadenceSpm, condition{task,load,terrain}, simulated:true, sampleId, protocol, metrics[{name,value,unit}] }`
- 基站回 `telemetry.ack`（`kind, segmentId, status, quality, comparable`）；HUD 只用它更新「最近同步时间」和上传计数，不据此显示任何健康结论。
- 基站只用质量合格（mock：≥4 s）且任务条件与个人步行基线一致的片段做趋势判断；达到阈值（mock：3 段）后进入医疗复核，批准后才发布 `alert.updated` + `retest.requested`（`setting: "in-habitat"`）。
- 断链时片段进入本地队列（上限 200 段，满了丢最旧片段，不丢复测结果），恢复后按原 `messageId` 补传，基站幂等。

## 2. 接口缺口（需底座确认，HUD 中均已隔离标注）

| 编号 | 缺口 | HUD 临时做法 |
|---|---|---|
| GAP-01 | 草案没有**端侧接收回执**，只有人员确认 `alerts/{id}/ack` | `POST /v1/deliveries/{messageId}/receipt`（仅在 `base-client.js` 的 `sendReceipt` 一处使用） |
| GAP-02 | 草案没有**复测任务状态更新**事件（已接收 / 重评中 / 完成） | 复用 `retest.requested`，以 `version` 递增携带最新 `status` |
| GAP-03 | 草案没有**复测状态枚举** | 暂用 `requested, accepted, deferred, aborted, received, reassessing, completed` |
| GAP-04 | 草案没有**采集质量提示**下发（贴片接触不良 → 重新采集） | 接入版暂不提供该流程；离线演示页 `mars-hud-scene.html` 保留 |
| GAP-05 | 同一 retestId 重新采集是否开新**轮次（round）**未定义 | 接入版：中止后重新开始沿用当前 round，由基站决定是否开新轮 |
| GAP-06 | **模拟复测样例**尚未由底座提供 | `contract/samples/retest-result.sample.json` 为占位文件，HUD 只读该文件 |
| GAP-07 | 「无法执行」「主动报告不适」等操作 | 协议不支持，HUD **未实现**，等待底座定义 |
| GAP-08 | 草案未定义**步行片段**上行格式（`telemetry.window` 只有名称） | 用 `payload.kind = "walking-segment"` 区分，字段见 §1b |
| GAP-09 | 草案没有**监测状态 / 片段质量反馈**下行事件 | HUD 只依据 `telemetry.ack` 显示同步时间；质量结果仅在基站侧使用 |
| GAP-10 | **步行片段样例**与个人步行基线、任务条件枚举未由底座提供 | `contract/samples/walking-segment.sample.json` 占位；条件暂用 `EVA patrol / standard suit / flat regolith` |

## 3. 状态与边界

- 接收回执 ≠ 人员确认 ≠ 完成任务；提交结果 ≠ 案例关闭（关闭只能由基站 `alert.updated status=closed` 表达）。
- 没有收到服务回执（HTTP 200 或 `telemetry.ack status=persisted`）时，HUD 不显示成功。
- 去重：按 `messageId` 去重；任务按 `retestId` 合并，只接受更高 `version`。
