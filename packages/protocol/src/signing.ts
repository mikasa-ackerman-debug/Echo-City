import { createHmac, timingSafeEqual } from "node:crypto";

export const HEADER_PROTOCOL = "x-echo-protocol";
export const HEADER_SIGNATURE = "x-echo-signature";
export const HEADER_TIMESTAMP = "x-echo-timestamp";
export const HEADER_DEADLINE = "x-echo-deadline";
export const HEADER_REQUEST_ID = "x-echo-request-id";

/** Maximum clock skew accepted when verifying a signed request. */
export const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Sign a webhook body. The signed payload is `${timestamp}.${body}` so that a
 * captured request cannot be replayed later with a fresh timestamp.
 */
export function signPayload(body: string, secret: string, timestamp: number): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${mac}`;
}

/** Headers are hints only: authenticate request_id/deadline_ms from the signed JSON body. */
export class WebhookReplayGuard {
  private seen = new Map<string, number>();
  constructor(private readonly capacity = 4096) {}

  accept(body: string, secret: string, signature: string | undefined | null, timestamp: string | number | undefined | null, now = Date.now()): boolean {
    if (!verifySignature(body, secret, signature, timestamp, now)) return false;
    let requestId: unknown;
    try { requestId = JSON.parse(body).request_id; } catch { return false; }
    if (typeof requestId !== "string" || !requestId || requestId.length > 512) return false;
    for (const [key, expiry] of this.seen) if (expiry < now) this.seen.delete(key);
    if (this.seen.has(requestId) || this.seen.size >= this.capacity) return false;
    // Covers future-skewed signed timestamps as well as the normal replay window.
    this.seen.set(requestId, Number(timestamp) + SIGNATURE_TOLERANCE_MS);
    return true;
  }
}

export function verifySignature(
  body: string,
  secret: string,
  signature: string | undefined | null,
  timestamp: string | number | undefined | null,
  now: number = Date.now(),
): boolean {
  if (!signature || timestamp === undefined || timestamp === null) return false;
  const ts = typeof timestamp === "number" ? timestamp : Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SIGNATURE_TOLERANCE_MS) return false;
  const expected = Buffer.from(signPayload(body, secret, ts));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
