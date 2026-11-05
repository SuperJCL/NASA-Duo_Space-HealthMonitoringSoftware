import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import lefroyBayJson from "@/data/briefings/lefroy-bay.json";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { checkBriefingIntegrity } from "./integrity";
import { loadBriefings, parseBriefing } from "./repository";
import type { Briefing } from "./schema";

/** BR-1 guards on the Lefroy Bay briefing (offline; live section checks: npm run verify:briefing). */
const [briefing] = loadBriefings();
const { sources } = loadJezeroMarginScenario();
const { catalog } = loadJezeroGeo();
const clone = (): Briefing => structuredClone(lefroyBayJson) as unknown as Briefing;
const problemsOf = (b: Briefing) => checkBriefingIntegrity(b, catalog, sources).join(" | ");
const byClass = (c: string) => briefing.items.filter((i) => i.classification === c);

describe("Lefroy Bay briefing content", () => {
  it("is tied to the verified PDS sample site and its report", () => {
    expect(briefing.locationId).toBe("sample-lefroy-bay");
    expect(briefing.report).toMatchObject({ id: "M2020-949-26", sourceId: "pds-m2020-initial-reports-vol4", pagePrefix: "26", reportDate: "2023-12-18" });
  });

  it("covers every evidence classification", () => {
    expect(Object.fromEntries(["measured", "interpreted", "open-question", "proposed-by-source", "simulated-idea"].map((c) => [c, byClass(c).length]))).toEqual({
      measured: 15,
      interpreted: 2,
      "open-question": 3,
      "proposed-by-source": 2,
      "simulated-idea": 2,
    });
  });

  it("answers the first-time-user test questions from the source", () => {
    expect(briefing.items.find((i) => i.id === "lb-silica-cement")?.citations[0].quote).toBe("Silica fills the space between grains, possibly as a cement.");
    const key = briefing.items.find((i) => i.id === briefing.keyQuestionItemId)!;
    expect(key.classification).toBe("open-question");
    expect(key.citations[0].quote).toMatch(/currently uncertain setting .* Less likely, an altered igneous deposit/);
    for (const p of byClass("proposed-by-source")) expect(p.limitations.join(" ")).toMatch(/not guaranteed.*not an approved NASA mission activity/);
  });

  it("states that imaging, abrasion, drilling and sealing were already performed, with their sols", () => {
    const done = briefing.items.filter((i) => i.topic === "already-done");
    expect(done.flatMap((d) => d.sols ?? [])).toEqual([920, 935, 936, 938, 939, 942, 949]);
    expect(done.every((d) => d.classification === "measured")).toBe(true);
  });

  it("keeps shared Pelican Point wording at Margin-unit scope with an explicit limitation", () => {
    const shared = briefing.items.filter((i) => i.citations.some((c) => c.sharedWith.length));
    expect(shared.map((i) => i.id).sort()).toEqual(["lb-oq-environment", "lb-oq-stratigraphy", "lb-sim-sedimentary-structures"]);
    for (const i of shared) {
      expect(i.scope).toBe("margin-unit");
      expect(i.limitations.join(" ")).toMatch(/Identical wording appears in the M2020-923-25 Pelican Point report/);
    }
  });

  it("quarantines the copied Pelican Point sentence and documents source typos", () => {
    expect(briefing.quarantine.map((q) => q.id)).toEqual(["q-pelican-copy"]);
    expect(JSON.stringify(briefing.items)).not.toContain("make Pelican Point of great interest");
    expect(briefing.sourceNotes.map((n) => n.id)).toEqual(["note-newell-newall", "note-ls-comma", "note-sample-numbering", "note-report-date"]);
  });

  it("keeps simulated ideas pending, unlocated and not repeating operations already done here", () => {
    for (const s of byClass("simulated-idea")) {
      expect(s.provenance).toMatchObject({ kind: "mdi-simulated-idea", review: { draftedBy: "ai-agent", status: "pending" } });
      expect(s.claim).toMatch(/^Simulated idea:/);
      expect(s.limitations.join(" ")).toMatch(/not a NASA plan/);
      expect(JSON.stringify(s)).not.toMatch(/"(position|coordinates|bbox|lat|lon)"/);
    }
  });
});

describe("briefing integrity rules reject bad data", () => {
  it("accepts the committed data", () => {
    expect(problemsOf(clone())).toBe("");
    expect(() => parseBriefing(lefroyBayJson, catalog, sources)).not.toThrow();
  });

  it("rejects mixing classifications into the wrong topic", () => {
    const b = clone();
    b.items.find((i) => i.id === "lb-interp-sandstone")!.topic = "measured";
    expect(problemsOf(b)).toMatch(/classification interpreted not allowed in topic measured/);
  });

  it("rejects shared wording presented as specific to this rock", () => {
    const b = clone();
    b.items.find((i) => i.id === "lb-oq-environment")!.scope = "sample";
    expect(problemsOf(b)).toMatch(/needs at least one quote unique to this report|shared wording requires margin-unit scope/);
  });

  it("rejects a future investigation without its conditions", () => {
    const b = clone();
    b.items.find((i) => i.id === "lb-next-ages")!.limitations = [];
    expect(problemsOf(b)).toMatch(/sample return is not guaranteed/);
  });

  it("rejects a simulated idea that repeats an operation already performed, or claims approval", () => {
    const b = clone();
    b.items.find((i) => i.id === "lb-sim-sedimentary-structures")!.claim = "Simulated idea: drill another core at Lefroy Bay.";
    expect(problemsOf(b)).toMatch(/proposes an operation \(drill\) that was already performed/);
    const raw = structuredClone(lefroyBayJson) as unknown as { items: { id: string; provenance: { review?: { status: string } } }[] };
    raw.items.find((i) => i.id === "lb-sim-compare-pelican")!.provenance.review!.status = "approved";
    expect(() => parseBriefing(raw, catalog, sources)).toThrow(/Invalid briefing/);
  });

  it("rejects using a quarantined quote and a wrong source URL", () => {
    const b = clone();
    const c = b.items.find((i) => i.id === "lb-organics")!.citations[0];
    c.quote = b.quarantine[0].quote;
    c.sourceUrl = "https://example.org/";
    const p = problemsOf(b);
    expect(p).toMatch(/uses a quarantined quote/);
    expect(p).toMatch(/sourceUrl differs/);
  });

  it("requires every already-performed operation to be stated", () => {
    const b = clone();
    b.items = b.items.filter((i) => i.id !== "lb-done-sealed");
    expect(problemsOf(b)).toMatch(/must state the sealing/);
  });
});

describe("separation from the ranking engine", () => {
  it("keeps lib/decision and lib/evidence production code free of briefing imports", () => {
    const root = join(__dirname, "..");
    for (const dir of ["decision", "evidence"]) {
      for (const file of readdirSync(join(root, dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
        expect(readFileSync(join(root, dir, file), "utf8"), `${dir}/${file}`).not.toMatch(/@\/(lib\/briefing|data\/briefings)/);
      }
    }
  });
});
