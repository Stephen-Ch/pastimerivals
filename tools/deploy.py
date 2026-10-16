"""Upload a published folder to SmarterASP over FTPS.
Usage: python3 tools/deploy.py publish/api [remote_subfolder]
Reads credentials from secrets/deploy.local.json (git-ignored). Takes the site offline
with app_offline.htm during upload so IIS releases locked files."""
import ftplib, io, json, os, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg = json.load(open(os.path.join(root, "secrets", "deploy.local.json")))
local = os.path.join(root, sys.argv[1])
remote_base = sys.argv[2] if len(sys.argv) > 2 else ""

ftp = ftplib.FTP_TLS(cfg["ftpHost"], timeout=60)
ftp.login(cfg["ftpUser"], cfg["ftpPassword"])
ftp.prot_p()
if remote_base:
    try: ftp.mkd(remote_base)
    except ftplib.error_perm: pass
    ftp.cwd(remote_base)

offline = b"<html><body><h1>Pastime Rivals is updating. Back in a minute.</h1></body></html>"
ftp.storbinary("STOR app_offline.htm", io.BytesIO(offline))

made = set()
count = 0
for dirpath, _, files in os.walk(local):
    rel = os.path.relpath(dirpath, local).replace(os.sep, "/")
    if rel != "." and rel not in made:
        parts = rel.split("/")
        for i in range(1, len(parts) + 1):
            p = "/".join(parts[:i])
            if p not in made:
                try: ftp.mkd(p)
                except ftplib.error_perm: pass
                made.add(p)
    for f in files:
        target = f if rel == "." else f"{rel}/{f}"
        with open(os.path.join(dirpath, f), "rb") as fh:
            ftp.storbinary(f"STOR {target}", fh)
        count += 1
        if count % 50 == 0: print(f"{count} files uploaded", flush=True)

ftp.delete("app_offline.htm")
ftp.quit()
print(f"Done: {count} files")
