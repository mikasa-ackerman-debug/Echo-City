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
