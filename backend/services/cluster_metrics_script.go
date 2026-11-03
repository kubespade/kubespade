package services

import "fmt"

// BuildCollectorScript returns the in-cluster Python collector (stdlib only).
func BuildCollectorScript(retentionDays int) string {
	if retentionDays < 1 {
		retentionDays = 1
	}
	if retentionDays > 30 {
		retentionDays = 30
	}
	return fmt.Sprintf(`#!/usr/bin/env python3
import json, os, ssl, time, threading, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DATA = Path(os.environ.get("DATA_DIR", "/data"))
TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
CA = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
HOST = os.environ.get("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc")
PORT = os.environ.get("KUBERNETES_SERVICE_PORT", "443")
API = f"https://{HOST}:{PORT}"
RETENTION_DAYS = int(os.environ.get("RETENTION_DAYS", "%d"))
NODE_INTERVAL = int(os.environ.get("NODE_INTERVAL_SEC", "60"))
POD_INTERVAL = int(os.environ.get("POD_INTERVAL_SEC", "120"))
HTTP_PORT = int(os.environ.get("HTTP_PORT", "8080"))
SSL_CTX = ssl.create_default_context(cafile=CA)

def read_token():
    # Projected ServiceAccount tokens are short-lived and rotated in place by the
    # kubelet (BoundServiceAccountTokenVolume, ~1h). Read the token fresh on every
    # request so an expired cached token never causes HTTP 401.
    return Path(TOKEN_PATH).read_text().strip()

def api_get(path):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {read_token()}", "Accept": "application/json"})
    with urllib.request.urlopen(req, context=SSL_CTX, timeout=30) as r:
        return json.loads(r.read().decode())

def parse_cpu(q):
    q = str(q or "0")
    if q.endswith("n"): return int(round(float(q[:-1]) / 1e6))
    if q.endswith("u"): return int(round(float(q[:-1]) / 1e3))
    if q.endswith("m"): return int(float(q[:-1]))
    try: return int(round(float(q) * 1000))
    except: return 0

def parse_mem(q):
    q = str(q or "0")
    if q.endswith("Ki"): return int(round(float(q[:-2]) * 1024))
    if q.endswith("Mi"): return int(round(float(q[:-2]) * 1024 * 1024))
    if q.endswith("Gi"): return int(round(float(q[:-2]) * 1024 * 1024 * 1024))
    try: return int(float(q))
    except: return 0

def append_point(path: Path, point: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(point, separators=(",", ":")) + "\n")

def prune_file(path: Path, cutoff: int):
    if not path.exists(): return
    keep = []
    try:
        with path.open() as f:
            for line in f:
                line = line.strip()
                if not line: continue
                try:
                    p = json.loads(line)
                    if int(p.get("ts", 0)) >= cutoff:
                        keep.append(line)
                except: pass
        with path.open("w") as f:
            f.write("\n".join(keep) + ("\n" if keep else ""))
    except Exception as e:
        print("prune error", path, e, flush=True)

def read_points(path: Path, since=None):
    out = []
    if not path.exists(): return out
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try:
                p = json.loads(line)
                if since is not None and int(p.get("ts", 0)) < since: continue
                out.append({"ts": int(p["ts"]), "cpuMilli": int(p["cpuMilli"]), "memBytes": int(p["memBytes"])})
            except: pass
    return out

def scrape_nodes():
    now = int(time.time())
    try:
        data = api_get("/apis/metrics.k8s.io/v1beta1/nodes")
    except Exception as e:
        print("nodes scrape failed", e, flush=True)
        return
    cpu_t = mem_t = 0
    for n in data.get("items") or []:
        name = (n.get("metadata") or {}).get("name") or ""
        if not name: continue
        usage = n.get("usage") or {}
        cpu = parse_cpu(usage.get("cpu"))
        mem = parse_mem(usage.get("memory"))
        cpu_t += cpu; mem_t += mem
        append_point(DATA / "nodes" / f"{name}.jsonl", {"ts": now, "cpuMilli": cpu, "memBytes": mem})
    append_point(DATA / "cluster.jsonl", {"ts": now, "cpuMilli": cpu_t, "memBytes": mem_t})

def scrape_pods():
    now = int(time.time())
    try:
        data = api_get("/apis/metrics.k8s.io/v1beta1/pods")
    except Exception as e:
        print("pods scrape failed", e, flush=True)
        return
    for p in data.get("items") or []:
        meta = p.get("metadata") or {}
        ns = meta.get("namespace") or ""
        name = meta.get("name") or ""
        if not ns or not name: continue
        cpu = mem = 0
        for c in p.get("containers") or []:
            usage = c.get("usage") or {}
            cpu += parse_cpu(usage.get("cpu"))
            mem += parse_mem(usage.get("memory"))
        append_point(DATA / "pods" / ns / f"{name}.jsonl", {"ts": now, "cpuMilli": cpu, "memBytes": mem})

def prune_all():
    cutoff = int(time.time()) - RETENTION_DAYS * 86400
    prune_file(DATA / "cluster.jsonl", cutoff)
    nd = DATA / "nodes"
    if nd.exists():
        for f in nd.glob("*.jsonl"): prune_file(f, cutoff)
    pd = DATA / "pods"
    if pd.exists():
        for f in pd.rglob("*.jsonl"): prune_file(f, cutoff)

def loop_nodes():
    while True:
        scrape_nodes()
        prune_all()
        time.sleep(NODE_INTERVAL)

def loop_pods():
    time.sleep(5)
    while True:
        scrape_pods()
        time.sleep(POD_INTERVAL)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/health", "/healthz"):
            return self._json(200, {"ok": True})
        if path == "/v1/meta":
            return self._json(200, {
                "version": 1,
                "retentionDays": RETENTION_DAYS,
                "nodeIntervalSec": NODE_INTERVAL,
                "podIntervalSec": POD_INTERVAL,
            })
        if path == "/v1/history/cluster":
            return self._json(200, {"points": read_points(DATA / "cluster.jsonl")})
        if path.startswith("/v1/history/nodes/"):
            name = path[len("/v1/history/nodes/"):]
            return self._json(200, {"points": read_points(DATA / "nodes" / f"{name}.jsonl")})
        if path.startswith("/v1/history/pods/"):
            rest = path[len("/v1/history/pods/"):]
            parts = rest.split("/", 1)
            if len(parts) != 2:
                return self._json(400, {"error": "need /v1/history/pods/{ns}/{name}"})
            ns, name = parts
            return self._json(200, {"points": read_points(DATA / "pods" / ns / f"{name}.jsonl")})
        self._json(404, {"error": "not found"})

def main():
    DATA.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=loop_nodes, daemon=True).start()
    threading.Thread(target=loop_pods, daemon=True).start()
    print(f"collector listening on :{HTTP_PORT} retention={RETENTION_DAYS}d", flush=True)
    ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), Handler).serve_forever()

if __name__ == "__main__":
    main()
`, retentionDays)
}
