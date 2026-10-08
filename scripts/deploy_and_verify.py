import os
import paramiko
import time
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def get_ssh():
    for i in range(1, 8):
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            print(f"Connecting to Hostinger VPS 187.77.143.211 (try {i}/7)...")
            client.connect('187.77.143.211', username='root', password='NkbManufacturing@2025', timeout=25)
            print("Connected to Hostinger VPS!")
            return client
        except Exception as e:
            print(f"Try {i} failed: {e}")
            time.sleep(3)
    raise RuntimeError("Could not connect to VPS")

ssh = get_ssh()

def run(cmd):
    print(f"\n>>> {cmd}")
    _, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out:
        print(out)
    if err:
        print("ERR:", err)
    return out, err

# Ensure directories exist on host
run("mkdir -p /var/www/dcc/apps/api/src/modules/converter /var/www/dcc/apps/api/dist/modules/converter /var/www/dcc/apps/api/src/modules/documents /var/www/dcc/apps/api/src/modules/scanners /var/www/dcc/apps/api/src/modules/vault /var/www/dcc/apps/web/public")

files_to_upload = [
    ("WALKTHROUGH_AND_BLUEPRINT.md", "/var/www/dcc/WALKTHROUGH_AND_BLUEPRINT.md"),
    ("apps/web/public/index.html", "/var/www/dcc/apps/web/public/index.html"),
    ("apps/api/src/app.ts", "/var/www/dcc/apps/api/src/app.ts"),
    ("apps/api/src/modules/documents/document.controller.ts", "/var/www/dcc/apps/api/src/modules/documents/document.controller.ts"),
    ("apps/api/src/modules/scanners/scanner.service.ts", "/var/www/dcc/apps/api/src/modules/scanners/scanner.service.ts"),
    ("apps/api/src/modules/scanners/scanner.controller.ts", "/var/www/dcc/apps/api/src/modules/scanners/scanner.controller.ts"),
    ("apps/api/src/modules/scanners/scanner.routes.ts", "/var/www/dcc/apps/api/src/modules/scanners/scanner.routes.ts"),
    ("apps/api/src/modules/vault/vault.service.ts", "/var/www/dcc/apps/api/src/modules/vault/vault.service.ts"),
    ("apps/api/src/modules/vault/vault.controller.ts", "/var/www/dcc/apps/api/src/modules/vault/vault.controller.ts"),
    ("apps/api/src/modules/vault/vault.routes.ts", "/var/www/dcc/apps/api/src/modules/vault/vault.routes.ts"),
    ("apps/api/src/modules/converter/converter.routes.ts", "/var/www/dcc/apps/api/src/modules/converter/converter.routes.ts"),
]

sftp = ssh.open_sftp()
print("Uploading updated source files and frontend to Hostinger VPS...")
for rel_local, remote_path in files_to_upload:
    local_path = os.path.join(BASE_DIR, *rel_local.split("/"))
    print(f"  -> {rel_local} => {remote_path}")
    sftp.put(local_path, remote_path)
sftp.close()

# Ensure converter directory exists in dcc_app container and copy source files into container
run("docker exec dcc_app mkdir -p /app/apps/api/src/modules/converter /app/apps/api/dist/modules/converter")

for rel_local, remote_path in files_to_upload:
    if rel_local.startswith("apps/"):
        container_path = f"/app/{rel_local}"
        run(f"docker cp {remote_path} dcc_app:{container_path}")

# Compile TypeScript inside dcc_app container so /app/apps/api/dist is freshly built
run("docker exec dcc_app sh -c 'cd /app/apps/api && npm run build'")

# Also sync compiled dist back to host /var/www/dcc/apps/api/dist
run("docker cp dcc_app:/app/apps/api/dist/. /var/www/dcc/apps/api/dist/")

# Restart dcc_app container
run("docker restart dcc_app")
time.sleep(5)

# Verify health status and frontend JS syntax
run("curl -s http://127.0.0.1:4000/readyz")
run("node -e 'const fs = require(\"fs\"); const html = fs.readFileSync(\"/var/www/dcc/apps/web/public/index.html\", \"utf8\"); const script = html.match(/<script.*?>([\\s\\S]*?)<\\/script>/)[1]; new Function(script); console.log(\"DEPLOYMENT VERIFICATION PASSED: ZERO JS ERRORS!\");'")

ssh.close()
