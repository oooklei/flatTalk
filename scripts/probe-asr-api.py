#!/usr/bin/env python3
"""探测 sauc-api 和 tencent-asr 的 HTTP 接口格式"""
import paramiko

HOST = '10.21.202.9'
USER = 'dapp'
PASSWORD = 'qUcu#3kMg4'

CMDS = [
    ("== 1. sauc-api 容器环境变量(找密钥配置) ==", "docker inspect sauc-api-1 --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -iE 'ASR|VOLC|TENCENT|KEY|TOKEN|APP|SECRET|ENDPOINT|API' | head -20"),
    ("== 2. sauc-api 源码中的路由 ==", "docker exec sauc-api-1 grep -rn 'asr/file\\|asr/stream\\|/asr\\|def.*asr\\|@app.route\\|@router' /app/ --include='*.py' 2>/dev/null | head -30 || echo '(无法访问源码)'"),
    ("== 3. sauc-api /asr/file 端点详情 ==", "docker exec sauc-api-1 grep -A 20 'asr/file' /app/*.py /app/**/*.py 2>/dev/null | head -40 || echo '(无法读取)'"),
    ("== 4. tencent-asr 容器详情 ==", "docker inspect tencent-asr --format 'Image={{.Config.Image}} Cmd={{.Config.Cmd}} Env={{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | head -20"),
    ("== 5. tencent-asr 源码 ==", "docker exec tencent-asr cat /app/main.py 2>/dev/null || docker exec tencent-asr cat /app/app.py 2>/dev/null || docker exec tencent-asr find /app -name '*.py' -exec head -30 {} + 2>/dev/null | head -50 || echo '(无法读取)'"),
    ("== 6. 测试 sauc-api /asr/file (OPTIONS) ==", "curl -s -X OPTIONS http://localhost:9080/asr/file -w '\\nHTTP %{http_code}' 2>&1 | head -5"),
    ("== 7. 测试 tencent-asr :8020 ==", "curl -s http://localhost:8020/ -w '\\nHTTP %{http_code}' 2>&1 | head -5"),
    ("== 8. docker-compose ==", "find /home -name 'docker-compose*' -path '*sauc*' 2>/dev/null -exec cat {} + | head -60; find /home/dapp -name 'docker-compose*' 2>/dev/null -exec cat {} + | head -60"),
]

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
    print(f"[OK] Connected to {HOST}\n")

    for title, cmd in CMDS:
        print(title)
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
        out = stdout.read().decode('utf-8', errors='replace').strip()
        err = stderr.read().decode('utf-8', errors='replace').strip()
        if out: print(out)
        if err and 'Permission' not in err and 'warning' not in err.lower(): print(f"  (stderr) {err}")
        print()

    ssh.close()

if __name__ == '__main__':
    main()
