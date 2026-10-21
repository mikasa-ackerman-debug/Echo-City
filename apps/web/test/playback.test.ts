import { describe, expect, it } from "vitest";
import type { CycleEvent } from "@echo/engine";
import { anchorCursor, cycleHumanities, defaultVenue, eventText, markerLabel, mergeEvents, mineContext, nextCursor, revealAllowed, touchesMine } from "../lib/playback";
import { deriveView } from "../lib/player";
const event = (seq: number, type = "say", data: any = {}, extra: any = {}): CycleEvent => ({ seq, type, data, night: 1, phase: "day", ...extra } as CycleEvent);

describe("late live delivery", () => {
  it("sorts and dedupes seq independently from delivery cursors", () => {
    const old = [event(1), event(5, "say", {}, { deliveryCursor: 2 })];
    const next = mergeEvents(old, [event(3, "thought", {}, { deliveryCursor: 3 }), event(5)]);
    expect(next.map((e) => e.seq)).toEqual([1, 3, 5]);
    expect(anchorCursor(old, next, 2)).toBe(3);
    expect(anchorCursor(old, next, 1)).toBe(1);
    expect(anchorCursor(old, next, 0)).toBe(0);
  });
});

describe("mine playback", () => {
  const events = [event(1, "cycle_start", { agents: [{ id: "a", name: "Moth" }, { id: "b", name: "Other" }] }), event(2, "trial_start", { venue: "other", players: ["Other"] }), event(3, "trial_start", { venue: "mine", players: ["Moth"] }), event(4, "trial_message", { text: "hello" }, { venue: "mine" })];
  it("matches ids, names and participant venues without unrelated trials", () => {
    const context = mineContext(events, ["a"]);
    expect(touchesMine(events[1], context)).toBe(false);
    expect(touchesMine(events[2], context)).toBe(true);
    expect(touchesMine(events[3], context)).toBe(true);
    expect(touchesMine(event(5, "move", { agent: "Moth" }), context)).toBe(true);
    expect(nextCursor(events, 1, context)).toBe(3);
    expect(nextCursor(events, events.length, context)).toBe(events.length);
  });
});

describe("spoiler-free defaults", () => {
  it("hides future marker identity until the event has played", () => {
    expect(markerLabel("Moth", 4, 4)).not.toContain("Moth");
    expect(markerLabel("Moth", 4, 5)).toBe("Moth");
  });
  it("prioritizes own active venue then any active then newest", () => {
    const other = { ended: false, players: ["Other"] };
    const mine = { ended: false, players: ["Moth"] };
    const ended = { ended: true, players: ["Moth"] };
    expect(defaultVenue([other, mine, ended], new Set(["Moth"]))).toBe(mine);
    expect(defaultVenue([other, ended], new Set(["Moth"]))).toBe(other);
    expect(defaultVenue([ended], new Set(["Moth"]))).toBe(ended);
  });
});

describe("safe display and reveal", () => {
  it("renders data-only private events and metadata", () => {
    for (const type of ["thought", "whisper", "host_whisper"]) expect(eventText(event(1, type, { text: "hello" }))).toContain("hello");
    expect(eventText(event(1, "whisper_meta", { from: "Moth", to: "Other" }))).toContain("Moth");
    expect(eventText(event(1, "trial_reveal", { state: { passphrase: "SECRET" } }, { text: "SECRET" }))).not.toContain("SECRET");
  });
  it("uses all cycle_end humanities and only allows ended reveal", () => {
    expect(cycleHumanities([event(1, "cycle_end", { agents: [{ id: "a", humanity: 81 }, { id: "b", humanity: 15 }, { id: "c", humanity: 42 }] })])).toEqual({ a: 81, b: 15, c: 42 });
    expect(revealAllowed(false, 10, 10, true)).toBe(false);
    expect(revealAllowed(true, 9, 10, false)).toBe(false);
    expect(revealAllowed(true, 10, 10, false)).toBe(true);
    expect(revealAllowed(true, 0, 10, true)).toBe(true);
  });
  it("reducer does not reveal final state before the ending cursor", () => {
    const events = [event(1, "cycle_start", { districts: [], map: {}, agents: [{ id: "a", name: "Moth", host: "Host" }] }), event(2, "cycle_end", { ending_title: "End", winner: { name: "Moth" }, agents: [{ id: "a", status: "ascended" }] })];
    expect(deriveView(events, 1).ending).toBeUndefined();
    expect(deriveView(events, 1).agents.a.status).toBe("alive");
    expect(deriveView(events, 2).agents.a.status).toBe("ascended");
    expect(deriveView(events, 2).ending?.title).toBe("End");
  });
});
