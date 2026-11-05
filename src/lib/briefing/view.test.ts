import { describe, expect, it } from "vitest";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { loadBriefings } from "./repository";
import { briefingView, CLASSIFICATION_LABEL } from "./view";

/** BR-2 view model: what the briefing panel shows, in order, with sources one click away. */
const view = briefingView(loadBriefings()[0], loadJezeroGeo(), loadJezeroMarginScenario().sources);

describe("Lefroy Bay briefing view", () => {
  it("leads with why the site matters and the source-stated open question", () => {
    expect(view.whyItMatters[0].claim).toMatch(/particularly strong carbonate signature/);
    expect(view.keyQuestion.classification).toBe("open-question");
    expect(view.keyQuestion.claim).toMatch(/^How did this rock form\?/);
    expect(view.otherQuestions.every((q) => q.scope === "margin-unit")).toBe(true);
  });

  it("keeps measured, interpreted, already-done and next items in separate groups", () => {
    expect(view.measured.every((l) => l.classification === "measured")).toBe(true);
    expect(view.interpreted.every((l) => l.classification === "interpreted")).toBe(true);
    expect(view.alreadyDone.map((d) => d.sols)).toEqual([[920], [935], [936, 938, 939], [942], [949]]);
    expect(view.proposed.every((l) => l.classification === "proposed-by-source")).toBe(true);
    expect(view.simulated.every((l) => l.classification === "simulated-idea")).toBe(true);
    expect(view.measured[0].claim).toBe("Silica fills the spaces between the grains, possibly as a cement.");
  });

  it("gives each line its exact quote with report section and page", () => {
    expect(view.measured[0].sources[0]).toMatchObject({
      quote: "Silica fills the space between grains, possibly as a cement.",
      where: "M2020-949-26 Lefroy Bay initial report · report header · p. 26-1",
    });
    expect(view.keyQuestion.sources[0].url).toBe(view.report.url);
    expect(view.status[0].sources[0].where).toMatch(/Meet the Mars Samples: Lefroy Bay/);
  });

  it("states the conditions of future investigations", () => {
    for (const p of view.proposed) {
      expect(p.claim).toMatch(/^If the sample reaches Earth/);
      expect(p.limitations).toContain("Requires the sample to be returned to Earth, which is not guaranteed.");
      expect(p.limitations).toContain("Discussed in the report; not an approved NASA mission activity.");
    }
  });

  it("answers 'is the rover here now?' from historical data only", () => {
    expect(view.roverNote).toBe(
      "No. After sampling here the rover drove on: this app’s historical traverse ends at sol 1176, about 2.5 km west of Lefroy Bay. There are no live data, so its current position is not shown.",
    );
  });

  it("labels every classification in plain language", () => {
    expect(CLASSIFICATION_LABEL).toEqual({
      measured: "Measured",
      interpreted: "Interpreted · preliminary",
      "open-question": "Open question · stated by the source",
      "proposed-by-source": "Proposed by the source · conditional",
      "simulated-idea": "Simulated idea · MDI, not reviewed",
    });
  });
});
