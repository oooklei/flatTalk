#!/usr/bin/env python3
"""
增量部署：仅上传景点图片和JSON索引到远程flatTalk
1. 上传 data/spot-images/ 新增目录到远程
2. 上传更新后的 dashboard-spot-images.json
3. 重启 flattalk-app 容器
"""
import os
import stat
import paramiko
import time

HOST = '10.21.202.9'
USER = 'dapp'
PASSWORD = 'qUcu#3kMg4'
REMOTE_DIR = '/app/aiyl/znt/flatTalk'
LOCAL_DIR = r'd:\GuiCare\flatTalk'

LOCAL_SPOTS = os.path.join(LOCAL_DIR, 'data', 'spot-images')
LOCAL_JSON = os.path.join(LOCAL_DIR, 'src', 'skills', 'travel_route', 'knowledge', 'dashboard-spot-images.json')
REMOTE_SPOTS = f'{REMOTE_DIR}/data/spot-images'
REMOTE_JSON = f'{REMOTE_DIR}/src/skills/travel_route/knowledge/dashboard-spot-images.json'


def run_remote(ssh, cmd, timeout=120):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    code = stdout.channel.recv_exit_status()
    if out:
        print(f'  {out}')
    if err and code != 0:
        print(f'  [ERR] {err}')
    return code


def sftp_mkdir_p(sftp, remote_dir):
    """递归创建远程目录"""
    parts = remote_dir.strip('/').split('/')
    cur = ''
    for p in parts:
        cur += '/' + p
        try:
            sftp.stat(cur)
        except IOError:
            sftp.mkdir(cur)


def main():
    print('=' * 60)
    print('增量部署景点图片到远程 10.21.202.9')
    print('=' * 60)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sftp = ssh.open_sftp()

    # 1. 上传JSON
    print('\n[1] 上传 dashboard-spot-images.json')
    sftp.put(LOCAL_JSON, REMOTE_JSON)
    print(f'  OK -> {REMOTE_JSON}')

    # 2. 上传景点图片
    print('\n[2] 上传景点图片')
    local_dirs = [d for d in os.listdir(LOCAL_SPOTS)
                  if os.path.isdir(os.path.join(LOCAL_SPOTS, d))]
    print(f'  本地共 {len(local_dirs)} 个景点目录')

    uploaded = 0
    skipped = 0
    for spot_name in local_dirs:
        local_spot_dir = os.path.join(LOCAL_SPOTS, spot_name)
        remote_spot_dir = f'{REMOTE_SPOTS}/{spot_name}'

        # 检查远程是否已有该目录且图片数>=3
        try:
            remote_files = sftp.listdir(remote_spot_dir)
            remote_imgs = [f for f in remote_files if f.endswith(('.jpg', '.jpeg', '.png'))]
            if len(remote_imgs) >= 3:
                skipped += 1
                continue
        except IOError:
            pass  # 远程目录不存在，需要上传

        # 创建远程目录
        sftp_mkdir_p(sftp, remote_spot_dir)

        # 上传该目录下所有图片
        local_files = [f for f in os.listdir(local_spot_dir)
                       if f.endswith(('.jpg', '.jpeg', '.png'))]
        for fname in local_files:
            local_path = os.path.join(local_spot_dir, fname)
            remote_path = f'{remote_spot_dir}/{fname}'
            sftp.put(local_path, remote_path)

        uploaded += 1
        if uploaded % 10 == 0:
            print(f'  已上传 {uploaded} 个景点...')

    print(f'  上传: {uploaded} 个景点, 跳过(已有): {skipped} 个')

    # 3. 验证远程图片数量
    print('\n[3] 验证远程图片')
    run_remote(ssh, f'ls {REMOTE_SPOTS} | wc -l')
    run_remote(ssh, f'find {REMOTE_SPOTS} -name "*.jpg" | wc -l')

    # 4. 重启容器
    print('\n[4] 重启 flattalk-app 容器')
    run_remote(ssh, 'docker restart flattalk-app', timeout=60)
    time.sleep(5)
    run_remote(ssh, 'docker ps --filter name=flattalk-app --format "{{.Names}} | {{.Status}}"')

    # 5. 健康检查
    print('\n[5] 健康检查')
    time.sleep(3)
    run_remote(ssh, 'curl -s http://localhost:5298/api/health 2>&1 || echo "(服务未就绪)"')

    sftp.close()
    ssh.close()
    print('\n[完成]')


if __name__ == '__main__':
    main()
