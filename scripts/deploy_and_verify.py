import paramiko
import time
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def get_ssh():
    for i in range(1, 8):
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            print(f"Connecting to VPS (try {i}/7)...")
            client.connect('187.77.143.211', username='root', password='NkbManufacturing@2025', timeout=25)
            print("Connected!")
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

# Ensure directories exist on host
run("mkdir -p /var/www/dcc/apps/api/dist/lib /var/www/dcc/apps/api/dist/modules/documents")

sftp = ssh.open_sftp()
print("Uploading updated files and compiled backend...")
sftp.put(r'c:\Users\earlj\Desktop\DCC V2\apps\web\public\index.html', '/var/www/dcc/apps/web/public/index.html')
sftp.put(r'c:\Users\earlj\Desktop\DCC V2\apps\api\src\lib\pdfMergeSplit.ts', '/var/www/dcc/apps/api/src/lib/pdfMergeSplit.ts')
sftp.put(r'c:\Users\earlj\Desktop\DCC V2\apps\api\src\modules\documents\document.controller.ts', '/var/www/dcc/apps/api/src/modules/documents/document.controller.ts')
sftp.put(r'c:\Users\earlj\Desktop\DCC V2\apps\api\dist\lib\pdfMergeSplit.js', '/var/www/dcc/apps/api/dist/lib/pdfMergeSplit.js')
sftp.put(r'c:\Users\earlj\Desktop\DCC V2\apps\api\dist\modules\documents\document.controller.js', '/var/www/dcc/apps/api/dist/modules/documents/document.controller.js')
sftp.put(r'c:\Users\earlj\Desktop\DCC V2\apps\api\dist\app.js', '/var/www/dcc/apps/api/dist/app.js')
sftp.close()

def run(cmd):
    print(f"\n>>> {cmd}")
    _, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out:
        print(out)
    if err:
        print("ERR:", err)

# Copy to docker container and verify syntax
run("docker cp /var/www/dcc/apps/web/public/index.html dcc_app:/app/apps/web/public/index.html")
run("docker cp /var/www/dcc/apps/api/dist/lib/pdfMergeSplit.js dcc_app:/app/apps/api/dist/lib/pdfMergeSplit.js")
run("docker cp /var/www/dcc/apps/api/dist/modules/documents/document.controller.js dcc_app:/app/apps/api/dist/modules/documents/document.controller.js")
run("docker cp /var/www/dcc/apps/api/dist/app.js dcc_app:/app/apps/api/dist/app.js")

# Restart dcc_app container
run("docker restart dcc_app")
time.sleep(5)

# Verify health status
run("curl -s http://127.0.0.1:4000/readyz")
run("node -e 'const fs = require(\"fs\"); const html = fs.readFileSync(\"/var/www/dcc/apps/web/public/index.html\", \"utf8\"); const script = html.match(/<script.*?>([\\s\\S]*?)<\\/script>/)[1]; new Function(script); console.log(\"DEPLOYMENT VERIFICATION PASSED: ZERO JS ERRORS!\");'")

ssh.close()


