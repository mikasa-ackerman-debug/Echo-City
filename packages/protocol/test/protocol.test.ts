import { describe, expect, it } from "vitest";
import { extractJsonObject, normalizeResponse, sanitizeText, validateAction, type ActionSpec } from "../src";
import { signPayload, verifySignature } from "../src/signing";

const legal: ActionSpec[] = [
  { type: "rest" },
  { type: "move", params: { to: { kind: "enum", values: ["A", "B"] } } },
  { type: "choose", params: { number: { kind: "int", min: 0, max: 100 } } },
];

describe("validateAction", () => {
  it("accepts legal actions and normalizes ints", () => {
    expect(validateAction({ type: "move", to: "A" }, legal).ok).toBe(true);
    const r = validateAction({ type: "choose", number: "42" }, legal);
    expect(r.ok && r.value.number).toBe(42);
  });
  it("rejects unknown types, bad enums and out-of-range ints", () => {
    expect(validateAction({ type: "fly" }, legal).ok).toBe(false);
    expect(validateAction({ type: "move", to: "Z" }, legal).ok).toBe(false);
    expect(validateAction({ type: "choose", number: 101 }, legal).ok).toBe(false);
  });
});

describe("normalizeResponse", () => {
  it("drops messages on channels that were not offered", () => {
    const n = normalizeResponse({ action: { type: "rest" }, messages: [{ channel: "broadcast", to: "all", text: "hi" }] }, legal, []);
    expect(n.valid).toBe(true);
    expect(n.response.messages).toEqual([]);
  });
  it("marks garbage as invalid", () => {
    expect(normalizeResponse("nope", legal, []).valid).toBe(false);
    expect(normalizeResponse({ action: { type: "fly" } }, legal, []).valid).toBe(false);
  });
});

describe("text helpers", () => {
  it("sanitizes control characters and clamps length", () => {
    expect(sanitizeText("a\u0000b\u202ec", 10)).not.toMatch(/[\u0000\u202e]/);
    expect(sanitizeText("x".repeat(50), 5).length).toBe(5);
  });
  it("extracts JSON from fenced LLM output", () => {
    expect(extractJsonObject('好的：\n```json\n{"action":{"type":"rest"}}\n```')).toEqual({ action: { type: "rest" } });
  });
});

describe("signing", () => {
  it("round-trips and rejects tampering / stale timestamps", () => {
    const now = Date.now();
    const sig = signPayload('{"a":1}', "s3cret", now);
    expect(verifySignature('{"a":1}', "s3cret", sig, now, now)).toBe(true);
    expect(verifySignature('{"a":2}', "s3cret", sig, now, now)).toBe(false);
    expect(verifySignature('{"a":1}', "other", sig, now, now)).toBe(false);
    expect(verifySignature('{"a":1}', "s3cret", sig, now, now + 10 * 60 * 1000)).toBe(false);
  });
});
