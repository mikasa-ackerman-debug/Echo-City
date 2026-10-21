import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { botRoster, buildReplay, runCycle } from "@echo/runner";
import { deriveView, markers } from "../lib/player";

describe("web replay reducer", () => {
  it("derives a consistent view at every cursor of a real cycle", async () => {
    const { roster, drivers } = botRoster(12);
    const r = await runCycle({ id: "w", seed: "web", roster, drivers, config: { trialLength: "short" } }, { timeoutScale: 0.01 });
    const replay = JSON.parse(JSON.stringify(buildReplay(r.state, r.events)));
    for (let c = 0; c <= replay.events.length; c += 37) deriveView(replay.events, c);
    const end = deriveView(replay.events);
    expect(end.order).toHaveLength(12);
    expect(end.ending?.title).toBeTruthy();
    expect(end.venues.length).toBeGreaterThan(0);
    const deleted = Object.values(end.agents).filter((a) => a.status === "deleted").length;
    expect(deleted).toBe(r.events.filter((e) => e.type === "agent_deleted").length);
    expect(markers(replay.events).some((m) => m.glyph === "◆")).toBe(true);
  });
  it("plays the bundled demo replay", () => {
    const demo = JSON.parse(readFileSync(join(__dirname, "../public/replays/demo.json"), "utf8"));
    expect(demo.format).toBe("echo-replay/1");
    expect(deriveView(demo.events).ending).toBeTruthy();
  });
});
