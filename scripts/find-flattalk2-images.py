#!/usr/bin/env python3
"""扫描192.168.1.2上 flattalk2 在各日期的镜像"""
import paramiko

HOST = '192.168.1.2'
USER = 'root'
PASSWORD = '1Q2W3E4R!234'

def run(ssh, cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8', errors='replace').strip()

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)

    # 查 08-02 ~ 08-04 所有 >=300MB 镜像，识别 flattalk2
    for date in ['2026-08-02', '2026-08-03', '2026-08-04']:
        cmd = f"docker images -a --format '{{{{.ID}}}}\\t{{{{.Size}}}}\\t{{{{.CreatedAt}}}}' | grep '{date}'"
        out = run(ssh, cmd)
        print(f"\n=== {date} 所有镜像 ===")
        for line in out.splitlines():
            parts = line.split('\t')
            if len(parts) < 3: continue
            img_id, size, created = parts
            size_mb = 0
            try:
                if 'MB' in size: size_mb = int(float(size.replace('MB','').strip()))
                elif 'GB' in size: size_mb = int(float(size.replace('GB','').strip())*1024)
            except: pass
            if size_mb < 300: continue  # 跳过小镜像
            # inspect label
            labels = run(ssh, f"docker inspect {img_id} --format '{{{{.Config.Labels}}}}'")
            proj = 'unknown'
            if 'project:flattalk2' in labels: proj = 'flattalk2'
            elif 'project:flattalk' in labels: proj = 'flattalk'
            print(f"  {img_id}  {size_mb}MB  {created}  [{proj}]")

    ssh.close()

if __name__ == '__main__':
    main()
