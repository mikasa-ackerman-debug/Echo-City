import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { isAllowedAddress, networkText, validateNetworkUrl } from "../src/network";

const init = { method: "POST", body: "{}" };
describe("SSRF-safe transport", () => {
  it("rejects non-public IPv4, IPv6 and mapped forms", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "2002:7f00:1::", "2001:db8::1"]) expect(isAllowedAddress(ip), ip).toBe(false);
    expect(isAllowedAddress("8.8.8.8")).toBe(true);
    expect(isAllowedAddress("2606:4700:4700::1111")).toBe(true);
    expect(isAllowedAddress("127.0.0.1", true)).toBe(true);
    expect(isAllowedAddress("10.0.0.1", true)).toBe(false);
    expect(() => validateNetworkUrl("http://127.0.0.1")).toThrow();
    expect(() => validateNetworkUrl("https://2130706433")).toThrow();
    expect(() => validateNetworkUrl("https://0x7f000001")).toThrow();
    expect(() => validateNetworkUrl("https://[::ffff:127.0.0.1]")).toThrow();
    expect(() => validateNetworkUrl("https://user:pass@example.com")).toThrow();
  });
  it("rejects private DNS answers before connecting", async () => {
    await expect(networkText("https://localhost/", init)).rejects.toThrow("Non-public DNS");
    await expect(networkText("http://8.8.8.8/", init, { allowHttp: true })).rejects.toThrow("loopback-only");
  });
  it("pins localhost, refuses redirects, caps streaming and aborts stalled responses", async () => {
    let redirected = false;
    const server = createServer((req, res) => {
      if (req.url === "/ok") res.end("ok");
      else if (req.url === "/redirect") { res.writeHead(302, { location: "/target" }); res.end(); }
      else if (req.url === "/target") { redirected = true; res.end(); }
      else if (req.url === "/large") res.end("x".repeat(1024));
      else if (req.url === "/stall") { res.writeHead(200); res.write("x"); }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const local = `http://localhost:${(server.address() as AddressInfo).port}`;
    try {
      expect((await networkText(local + "/ok", init, { allowHttp: true })).text).toBe("ok");
      await expect(networkText(local + "/redirect", init, { allowHttp: true })).rejects.toThrow();
      expect(redirected).toBe(false);
      await expect(networkText(local + "/large", init, { allowHttp: true, maxBytes: 32 })).rejects.toThrow();
      await expect(networkText(local + "/stall", init, { allowHttp: true, timeoutMs: 20 })).rejects.toThrow();
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
