#!/usr/bin/env python3
"""探测 10.21.202.9 上 sauc-nginx-1 和 asr-service 容器的部署情况"""
import paramiko

HOST = '10.21.202.9'
USER = 'dapp'
PASSWORD = 'qUcu#3kMg4'

CMDS = [
    ("== 1. asr/sauc 相关容器 ==", "docker ps -a --filter name=asr --filter name=sauc --format '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}'"),
    ("== 2. 所有运行中容器(找nginx/asr) ==", "docker ps --format '{{.Names}} | {{.Ports}}' | grep -iE 'asr|sauc|nginx'"),
    ("== 3. asr-service 容器详情 ==", "docker inspect asr-service --format 'Image={{.Config.Image}} | Cmd={{.Config.Cmd}} | Env={{range .Config.Env}}{{println .}}{{end}}Ports={{range $p,$v := .NetworkSettings.Ports}}{{$p}}->{{range $v}}{{.HostPort}}{{end}} {{end}}' 2>/dev/null || echo '(容器名可能不同)'"),
    ("== 4. sauc-nginx-1 容器详情 ==", "docker inspect sauc-nginx-1 --format 'Image={{.Config.Image}} | Ports={{range $p,$v := .NetworkSettings.Ports}}{{$p}}->{{range $v}}{{.HostPort}}{{end}} {{end}}' 2>/dev/null || echo '(容器名可能不同)'"),
    ("== 5. asr-service 日志最后10行 ==", "docker logs asr-service --tail 10 2>&1 || echo '(无asr-service)'"),
    ("== 6. sauc-nginx-1 nginx配置 ==", "docker exec sauc-nginx-1 cat /etc/nginx/conf.d/default.conf 2>/dev/null || docker exec sauc-nginx-1 cat /etc/nginx/nginx.conf 2>/dev/null || echo '(无法读取nginx配置)'"),
    ("== 7. 测试 ASR HTTP 端点 ==", "curl -s -o /dev/null -w '%{http_code}' http://localhost:9100/ 2>/dev/null; echo ' :9100'; curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/ 2>/dev/null; echo ' :8000'; curl -s -o /dev/null -w '%{http_code}' http://localhost:5000/ 2>/dev/null; echo ' :5000'"),
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
        if err and 'Permission' not in err: print(f"  (stderr) {err}")
        print()

    ssh.close()

if __name__ == '__main__':
    main()
