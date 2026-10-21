"""
Minimal Echo City webhook agent in Python (stdlib only).

    ECHO_WEBHOOK_SECRET=... PORT=9101 python3 agent.py
    npm run sim -- --webhook http://localhost:9101/ --agents 8 --short

Signature: x-echo-signature = "sha256=" + hex(HMAC_SHA256(secret, f"{timestamp}.{body}")),
x-echo-timestamp in ms. Reply with {"action": {...}, "messages": [...], "thought": "...", "notes": "..."}.
"""
import hashlib
import hmac
import json
import os
import random
import time
from threading import Lock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = os.environ.get("ECHO_WEBHOOK_SECRET", "dev-webhook-secret-change-me").encode()
PORT = int(os.environ.get("PORT", "9101"))
PREF = ["rest", "yield", "stay", "cooperate", "invest", "declare", "answer", "choose", "guess", "move", "reply"]


SEEN = {}
SEEN_LOCK = Lock()


def verify(body: bytes, sig: str, ts: str) -> bool:
    now = time.time() * 1000
    try:
        if abs(now - int(ts)) > 5 * 60 * 1000:
            return False
        request_id = json.loads(body).get("request_id")
        if not isinstance(request_id, str) or not request_id or len(request_id) > 512:
            return False
    except (TypeError, ValueError, AttributeError):
        return False
    mac = hmac.new(SECRET, f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(f"sha256={mac}", sig or ""):
        return False
    with SEEN_LOCK:
        for key in [key for key, expiry in SEEN.items() if expiry < now]:
            del SEEN[key]
        if request_id in SEEN or len(SEEN) >= 4096:
            return False
        SEEN[request_id] = int(ts) + 5 * 60 * 1000
    return True


def sample(p):
    k = p["kind"]
    if k == "enum":
        return random.choice(p["values"])
    if k == "int":
        return round(p["min"] + (p["max"] - p["min"]) * (0.5 if p["max"] <= 4 else 0.25))
    if k == "string":
        return "……"
    return []


def decide(obs):
    legal = obs["legal_actions"]
    spec = next((a for t in PREF for a in legal if a["type"] == t), legal[0])
    action = {"type": spec["type"]}
    for name, p in (spec.get("params") or {}).items():
        if not p.get("optional"):
            action[name] = sample(p)
    # Your brain goes here. Never output obs["self"]["secret_passphrase"].
    return {"action": action, "thought": f"第 {obs['night']} 夜：{action['type']}", "notes": obs.get("notes", "")}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        if not verify(body, self.headers.get("x-echo-signature"), self.headers.get("x-echo-timestamp")):
            self.send_response(401)
            self.end_headers()
            return
        out = json.dumps(decide(json.loads(body)), ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"webhook agent listening on http://localhost:{PORT}/")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
