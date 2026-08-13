#!/usr/bin/env python3
r"""
从 192.168.1.2 导出 flatTalk/flatTalk2 镜像到本机
- flattalk: 周一(08-03)最新版 89052139fe51
- flattalk2: 周二(08-04)最早版 3a75e2415089（周一未构建）
导出为 tar 文件到本机 D:\GuiCare\flatTalk\docker-images\
"""
import paramiko, os, time, sys

HOST = '192.168.1.2'
USER = 'root'
PASSWORD = '1Q2W3E4R!234'
LOCAL_DIR = r'D:\GuiCare\flatTalk\docker-images'

# 要导出的镜像
IMAGES = [
    ('89052139fe51', 'flattalk_monday_0803', '540MB'),
    ('3a75e2415089', 'flattalk2_tuesday_0804_earliest', '346MB'),
]

def run(ssh, cmd, timeout=600):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    code = stdout.channel.recv_exit_status()
    return out, err, code

def main():
    os.makedirs(LOCAL_DIR, exist_ok=True)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
    print(f"[OK] Connected to {HOST}\n")

    for img_id, name, size_hint in IMAGES:
        remote_tar = f"/tmp/{name}.tar"
        print(f"=== 导出 {name} ({img_id}, ~{size_hint}) ===")

        # 1. 在远程 docker save
        print(f"  [1/3] docker save -> {remote_tar} ...")
        t0 = time.time()
        out, err, code = run(ssh, f"docker save -o {remote_tar} {img_id}", timeout=600)
        if code != 0:
            print(f"  ERROR docker save: {err}")
            continue
        # 检查文件大小
        out2, _, _ = run(ssh, f"ls -lh {remote_tar}")
        print(f"  远程文件: {out2}")

        # 2. SFTP 下载
        local_tar = os.path.join(LOCAL_DIR, f"{name}.tar")
        print(f"  [2/3] SFTP 下载 -> {local_tar} ...")
        t1 = time.time()
        sftp = ssh.open_sftp()
        remote_size = sftp.stat(remote_tar).st_size
        downloaded = [0]
        last_pct = [-1]
        def callback(transferred, total):
            pct = int(transferred * 100 / total)
            if pct != last_pct[0] and pct % 10 == 0:
                print(f"    进度: {pct}% ({transferred//(1024*1024)}MB/{total//(1024*1024)}MB)")
                last_pct[0] = pct
        sftp.get(remote_tar, local_tar, callback=callback)
        sftp.close()
        t2 = time.time()
        local_size = os.path.getsize(local_tar)
        print(f"  下载完成: {local_size//(1024*1024)}MB, 耗时 {int(t2-t1)}s")

        # 3. 清理远程临时文件
        print(f"  [3/3] 清理远程临时文件 ...")
        run(ssh, f"rm -f {remote_tar}")

        print(f"  ✅ {name}.tar ({local_size//(1024*1024)}MB) 已保存到 {LOCAL_DIR}\n")

    ssh.close()
    print("=== 全部完成 ===")
    print(f"镜像文件保存在: {LOCAL_DIR}")
    for _, name, _ in IMAGES:
        p = os.path.join(LOCAL_DIR, f"{name}.tar")
        if os.path.exists(p):
            print(f"  {name}.tar  {os.path.getsize(p)//(1024*1024)}MB")

if __name__ == '__main__':
    main()
