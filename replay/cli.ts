// MyoMars data replay — command line (no UI). Publishes stored SIMULATED samples to the local relay
// as the data producer (contract role "trigger"). Never analyses, approves or answers for the HUD.
//
//   npm run replay -- list                       samples and their intake checklist
//   npm run replay -- start --dev-run            DEVELOPMENT ONLY: a run without a mission (EVAs are
//                                                started by base staff on the station: 任务地图 → 开始EVA)
//   npm run replay -- send <sampleId>            publish one sample into the current run
//   npm run replay -- check <file.json>          intake check of an external observation file (no publishing)
// Options: --relay http://localhost:8787  --session demo   (a sample with a "blocked" item is never published)

import { readFileSync } from "node:fs";
import { parseEnvelope } from "../src/contracts/envelope.ts";
import { intakeCheck, observationEnvelope, REPLAY_SAMPLES, sampleById, startEnvelope, type ReplaySample, type RunInfo } from "../src/lib/replay/replay.ts";

const args = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const relay = flag("relay", process.env.MYOMARS_RELAY ?? "http://localhost:8787").replace(/\/$/, "");
const session = flag("session", "demo");
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--relay", "--session"].includes(args[i - 1])));
const [cmd, arg] = positional;
const ICON = { ok: "✓", assumed: "△ 假设", missing: "○ 缺失", blocked: "✕ 阻止" } as const;

function printCheck(s: ReplaySample, run: RunInfo | null) {
  const { items, publishable } = intakeCheck(s, run, new Date().toISOString());
  console.log(`\n${s.id} · ${s.label}\n  来源：${s.source.label}`);
  for (const i of items) console.log(`  ${ICON[i.status].padEnd(6)} ${i.item}：${i.detail}`);
  console.log(`  ${publishable ? "可以回放（模拟数据）" : "不能回放"}`);
  return publishable;
}

async function currentRun(): Promise<RunInfo | null> {
  const r = await fetch(`${relay}/v1/sessions/${session}/events?after=0`);
  if (!r.ok) throw new Error(`relay ${r.status}`);
  const h = (await r.json()) as { activeRun: string | null; events: { type: string; runId: string; payload: { astronaut: RunInfo["astronaut"]; task: RunInfo["task"] } }[] };
  const start = h.events.filter((e) => e.type === "scenario.start" && e.runId === h.activeRun).at(-1);
  return start ? { runId: start.runId, astronaut: start.payload.astronaut, task: start.payload.task } : null;
}

async function publish(env: unknown) {
  const ok = parseEnvelope(env);
  if (!ok.ok) throw new Error(`not a valid envelope: ${ok.message}`);
  const r = await fetch(`${relay}/v1/sessions/${session}/events`, { method: "POST", headers: { "content-type": "application/json", "x-myomars-role": "trigger", "x-myomars-client": "replay-cli" }, body: JSON.stringify(env) });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`relay refused (${r.status}): ${JSON.stringify(body)}`);
  return body as { seq: number; duplicate: boolean };
}

async function main() {
  if (cmd === "list" || !cmd) {
    const run = await currentRun().catch(() => null);
    console.log(`MyoMars data replay · relay ${relay} · session ${session} · current run ${run?.runId ?? "none"}`);
    console.log("所有样例都是模拟数据，不是队友的健康数据。");
    for (const s of REPLAY_SAMPLES) printCheck(s, run);
    return;
  }
  if (cmd === "start") {
    if (!args.includes("--dev-run")) throw new Error("EVA runs are started by base staff on the station (任务地图 → 开始EVA). For a development run without a mission, add --dev-run.");
    const env = startEnvelope(session, Date.now());
    const r = await publish(env);
    console.log(`started ${env.runId} (seq ${r.seq}) · astronaut A-02 · the HUD (?mode=integration) and the station join it`);
    return;
  }
  if (cmd === "send") {
    const s = arg ? sampleById(arg) : null;
    if (!s) throw new Error(`unknown sample "${arg ?? ""}"; try: ${REPLAY_SAMPLES.map((x) => x.id).join(", ")}`);
    const run = await currentRun();
    if (!printCheck(s, run) || !run) throw new Error("not published");
    const env = observationEnvelope(session, run, s, Date.now());
    const r = await publish(env);
    console.log(`published ${env.caseId} (seq ${r.seq}${r.duplicate ? ", duplicate" : ""}) · SIMULATED sample "${s.id}"`);
    return;
  }
  if (cmd === "check") {
    if (!arg) throw new Error("usage: check <file.json>");
    const raw = JSON.parse(readFileSync(arg, "utf8")) as unknown;
    // External data is checked as the health-data teammate's data: no person reassignment, raw signals blocked.
    const obs = (raw as { observation?: unknown }).observation ?? raw;
    const s: ReplaySample = {
      id: arg,
      label: "外部文件（只检查，不回放）",
      source: { label: `文件 ${arg}`, teammateData: true, kind: (obs as { features?: unknown }).features === undefined ? "raw" : "features" },
      observation: obs as ReplaySample["observation"],
      meta: { bodySite: { value: "未提供", assumed: false, note: "需由数据提供方说明" }, device: { value: "未注明", assumed: false, note: "需由数据提供方说明" } },
    };
    const run = await currentRun().catch(() => null);
    printCheck(s, run);
    return;
  }
  throw new Error(`unknown command "${cmd}"`);
}

main().catch((e: Error) => {
  console.error(`replay: ${e.message}`);
  process.exit(1);
});
