"""Uploads pipeline CSVs to the server's import endpoint in ~1 MB chunks.
Usage: python3 tools/upload-data.py <baseUrl> <table>=<csv> [<table>=<csv> ...]
Several CSVs for one table (e.g. exposure from two year ranges) are appended in order."""
import json, os, sys, urllib.request
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
key = json.load(open(os.path.join(root, "secrets", "deploy.local.json")))["importKey"]
base = sys.argv[1].rstrip("/")
started = set()

def send(table, mode, body):
    req = urllib.request.Request(f"{base}/api/admin/import/{table}?mode={mode}", data=body.encode(),
                                 headers={"X-Import-Key": key, "Content-Type": "text/csv"}, method="POST")
    with urllib.request.urlopen(req, timeout=170) as r:
        return json.loads(r.read())

for arg in sys.argv[2:]:
    table, path = arg.split("=", 1)
    with open(os.path.join(root, path)) as f:
        header = f.readline()
        chunk, size, last = [], 0, None
        for line in f:
            chunk.append(line); size += len(line)
            if size > 1_000_000:
                last = send(table, "append" if table in started else "replace", header + "".join(chunk)); started.add(table)
                chunk, size = [], 0
        if chunk or table not in started:
            last = send(table, "append" if table in started else "replace", header + "".join(chunk)); started.add(table)
    print(table, path, last)
