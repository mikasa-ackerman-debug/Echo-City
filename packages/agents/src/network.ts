import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export interface NetworkOptions { allowHttp?: boolean; maxBytes?: number; timeoutMs?: number }

/** Globally routable addresses only; loopback requires an explicit development opt-in. */
export function isAllowedAddress(address: string, allowLocal = false): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 127) return allowLocal;
    return !(a === 0 || a === 10 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(ip) !== 6) return false;
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  if (normalized === "::1") return allowLocal;
  const first = parseInt(normalized.split(":")[0], 16);
  return first >= 0x2000 && first < 0x3fff && !/^2001:(?:0:|db8:|2:|10:|20:)/.test(normalized) && !normalized.startsWith("2002:");
}

export function validateNetworkUrl(raw: string, allowHttp = false): URL {
  const url = new URL(raw);
  if (url.username || url.password || url.hash) throw new Error("URL credentials/fragments are forbidden");
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) throw new Error("HTTPS is required");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isAllowedAddress(host, allowHttp)) throw new Error("Non-public destination is forbidden");
  if (url.protocol === "http:" && isIP(host) && isAllowedAddress(host)) throw new Error("Development HTTP is loopback-only");
  return url;
}

/** Resolve once, validate every answer and pin the socket. TLS verifies original hostname. */
export async function networkText(raw: string, init: RequestInit, options: NetworkOptions = {}): Promise<{ status: number; text: string }> {
  const url = validateNetworkUrl(raw, options.allowHttp);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Network timeout")), options.timeoutMs ?? 30000);
  const signal = AbortSignal.any([...(init.signal ? [init.signal] : []), controller.signal]);
  try {
  signal.throwIfAborted();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let abortDns: () => void = () => {};
  const addresses = await Promise.race([
    isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : lookup(host, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => { abortDns = () => reject(signal.reason); signal.addEventListener("abort", abortDns, { once: true }); }),
  ]).finally(() => signal.removeEventListener("abort", abortDns));
  signal.throwIfAborted();
  if (!addresses.length || addresses.some((a) => !isAllowedAddress(a.address, options.allowHttp))) throw new Error("Non-public DNS destination is forbidden");
  if (url.protocol === "http:" && addresses.some((a) => isAllowedAddress(a.address))) throw new Error("Development HTTP is loopback-only");
  const pinned = addresses[0];
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
  return await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: init.method ?? "POST", headers, signal,
      agent: false, family: pinned.family,
      lookup: ((_hostname: string, _opts: unknown, callback: Function) => callback(null, pinned.address, pinned.family)) as any,
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) { reject(new Error("Redirects are forbidden")); response.destroy(); request.destroy(); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > (options.maxBytes ?? 64 * 1024)) { reject(new Error("Response too large")); response.destroy(); request.destroy(); }
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("aborted", () => reject(new Error("Response aborted")));
      response.on("end", () => resolve({ status, text: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end(init.body ? String(init.body) : undefined);
  });
  } finally { clearTimeout(timer); }
}

/** Trusted injection hook for tests; enforces redirect and streaming size limits. */
export async function injectedText(fetchImpl: typeof fetch, url: string, init: RequestInit, maxBytes: number) {
  const response = await fetchImpl(url, { ...init, redirect: "error" });
  if (response.redirected || (response.status >= 300 && response.status < 400)) { await response.body?.cancel(); throw new Error("Redirects are forbidden"); }
  const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (reader) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > maxBytes) throw new Error("Response too large"); chunks.push(value);
    }
    return { status: response.status, text: Buffer.concat(chunks).toString("utf8") };
  } finally { await reader?.cancel(); reader?.releaseLock(); }
}
