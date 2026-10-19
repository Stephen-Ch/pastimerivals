"""Writes publish/fd/appsettings.Production.json from secrets/deploy.local.json.
Never commit the output; it holds the database password and the import key."""
import json, os, secrets, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sp = os.path.join(root, "secrets", "deploy.local.json")
s = json.load(open(sp))
changed = False
for k in ("importKey", "ipSalt", "funnelKey"):  # funnelKey: plan 29 read-only funnel readout  # generated once, kept in the git-ignored secrets file
    if not s.get(k):
        s[k] = secrets.token_urlsafe(32); changed = True
if changed:
    json.dump(s, open(sp, "w"), indent=2)
cs = ("Server=sql5110.site4now.net;Database=db_a0bef1_pastimerivals;User Id=db_a0bef1_pastimerivals_admin;"
      f"Password={s['dbPassword']};Encrypt=True;TrustServerCertificate=True;")
out = os.path.join(root, sys.argv[1] if len(sys.argv) > 1 else "publish/fd", "appsettings.Production.json")
json.dump({"ConnectionStrings": {"Stats": cs}, "Import": {"Key": s["importKey"]}, "Challenges": {"IpSalt": s["ipSalt"]}, "Funnel": {"Key": s["funnelKey"]}}, open(out, "w"), indent=2)
print("wrote", os.path.relpath(out, root))
