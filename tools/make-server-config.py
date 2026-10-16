"""Writes publish/fd/appsettings.Production.json from secrets/deploy.local.json.
Never commit the output; it holds the database password and the import key."""
import json, os, secrets, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sp = os.path.join(root, "secrets", "deploy.local.json")
s = json.load(open(sp))
if not s.get("importKey"):
    s["importKey"] = secrets.token_urlsafe(32)
    json.dump(s, open(sp, "w"), indent=2)
cs = ("Server=sql5110.site4now.net;Database=db_a0bef1_pastimerivals;User Id=db_a0bef1_pastimerivals_admin;"
      f"Password={s['dbPassword']};Encrypt=True;TrustServerCertificate=True;")
out = os.path.join(root, sys.argv[1] if len(sys.argv) > 1 else "publish/fd", "appsettings.Production.json")
json.dump({"ConnectionStrings": {"Stats": cs}, "Import": {"Key": s["importKey"]}}, open(out, "w"), indent=2)
print("wrote", os.path.relpath(out, root))
