#!/usr/bin/env python3
"""
flatTalk 部署脚本
将本地代码部署到 10.21.202.9:/app/aiyl/znt/flatTalk
策略：打包源码→上传→远程构建Docker镜像→重启容器
"""
import os
import tarfile
import paramiko
import time

HOST = '10.21.202.9'
USER = 'dapp'
PASSWORD = 'qUcu#3kMg4'
REMOTE_DIR = '/app/aiyl/znt/flatTalk'
LOCAL_DIR = r'd:\GuiCare\flatTalk'
TARBALL_NAME = 'flattalk-deploy.tar.gz'
REMOTE_TARBALL = f'/tmp/{TARBALL_NAME}'

# 排除列表（不打包这些目录和文件）
EXCLUDE_DIRS = {
    'node_modules', '.git', '.worktrees', 'ssl', 'scripts',
    'docker-images', '.claude', '.codebuddy', '.idea', '.vscode',
    'tests', 'coverage', 'playwright-report', '.nyc_output',
    'tmp', 'temp', 'dist', 'build',
}

EXCLUDE_FILES = {
    '.env', '.env.local', '.env.bak', 'package-lock.json',
    'docker-images', 'flatTalk-20260731-v2.tar.gz', 'flatTalk-20260731-v3.tar.gz',
}

EXCLUDE_PATTERNS = ['.tar.gz', '.tmp', '.log', '.swp', '.swo', '.DS_Store', 'Thumbs.db']


def should_exclude(name, is_dir=False):
    if name in EXCLUDE_DIRS:
        return True
    if name in EXCLUDE_FILES:
        return True
    # 排除 Office 锁文件 ~$xxx
    if name.startswith('~$'):
        return True
    for pat in EXCLUDE_PATTERNS:
        if name.endswith(pat):
            return True
    return False


def create_tarball():
    """创建源码压缩包"""
    tarball_path = os.path.join(LOCAL_DIR, TARBALL_NAME)
    count = 0
    skipped = 0
    with tarfile.open(tarball_path, 'w:gz') as tar:
        for root, dirs, files in os.walk(LOCAL_DIR):
            # 过滤排除目录（原地修改 dirs 以阻止遍历）
            dirs[:] = [d for d in dirs if not should_exclude(d, True)]

            for fname in files:
                if should_exclude(fname):
                    continue
                fpath = os.path.join(root, fname)
                arcname = os.path.relpath(fpath, LOCAL_DIR)
                # 跳过压缩包自身
                if arcname == TARBALL_NAME:
                    continue
                try:
                    tar.add(fpath, arcname=arcname)
                    count += 1
                except (PermissionError, OSError) as e:
                    skipped += 1
                    continue

    size_mb = os.path.getsize(tarball_path) / (1024 * 1024)
    print(f"[OK] 打包完成: {count} 个文件, 跳过 {skipped} 个, {size_mb:.1f}MB → {tarball_path}")
    return tarball_path


def upload_and_deploy(tarball_path):
    """上传并远程部署"""
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    print(f"[OK] SSH 连接到 {HOST}")

    # 1. 上传压缩包
    print(f"\n[1/7] 上传源码包 ({os.path.getsize(tarball_path)/(1024*1024):.1f}MB)...")
    sftp = ssh.open_sftp()
    sftp.put(tarball_path, REMOTE_TARBALL)
    sftp.close()
    print("      上传完成")

    # 2. 备份现有代码（保留 .env 和 ssl）
    print("\n[2/7] 备份现有部署...")
    run_remote(ssh, f"cd {REMOTE_DIR} && cp .env /tmp/flattalk.env.backup")
    run_remote(ssh, f"cp -r {REMOTE_DIR}/ssl /tmp/flattalk-ssl-backup 2>/dev/null || true")
    run_remote(ssh, f"cp {REMOTE_DIR}/data/integrations.json /tmp/flattalk-integrations.backup 2>/dev/null || true")
    run_remote(ssh, f"cp {REMOTE_DIR}/data/model-registry.json /tmp/flattalk-model-registry.backup 2>/dev/null || true")
    run_remote(ssh, f"cp {REMOTE_DIR}/data/api-keys.json /tmp/flattalk-api-keys.backup 2>/dev/null || true")
    run_remote(ssh, f"cp {REMOTE_DIR}/data/permissions.json /tmp/flattalk-permissions.backup 2>/dev/null || true")
    run_remote(ssh, f"cp {REMOTE_DIR}/data/config.json /tmp/flattalk-config.backup 2>/dev/null || true")
    print("      备份完成")

    # 3. 解压新代码（保留 .env 和 ssl 不覆盖）
    print("\n[3/7] 解压新代码...")
    run_remote(ssh, f"cd {REMOTE_DIR} && tar -xzf {REMOTE_TARBALL} --overwrite")
    # 恢复 .env
    run_remote(ssh, f"cp /tmp/flattalk.env.backup {REMOTE_DIR}/.env")
    print("      解压完成（已保留现有 .env）")

    # 4. 更新 data/ 中的关键 JSON（合并新条目）
    print("\n[4/7] 更新 data/integrations.json...")
    update_integrations_cmd = f"""python3 -c "
import json
# 读取新版本的 integrations.json
with open('{REMOTE_DIR}/data/integrations.json', 'r') as f:
    new_data = json.load(f)
# 读取备份的 integrations.json（可能含有用户自定义密钥）
try:
    with open('/tmp/flattalk-integrations.backup', 'r') as f:
        old_data = json.load(f)
except:
    old_data = {{'items': []}}

# 合并：用新版本的 base_url/description 更新，保留旧版本中用户填写的 config.api_key
old_map = {{i['key']: i for i in old_data.get('items', [])}}
for item in new_data.get('items', []):
    k = item.get('key')
    if k in old_map:
        # 保留用户已填写的密钥
        old_config = old_map[k].get('config', {{}})
        if old_config.get('api_key'):
            item.setdefault('config', {{}})['api_key'] = old_config['api_key']

with open('{REMOTE_DIR}/data/integrations.json', 'w') as f:
    json.dump(new_data, f, ensure_ascii=False, indent=2)
print('integrations.json updated with', len(new_data.get('items', [])), 'items')
\""""
    run_remote(ssh, update_integrations_cmd)

    # 5. 构建 Docker 镜像
    print("\n[5/7] 构建 Docker 镜像（使用 Dockerfile.remote）...")
    build_cmd = f"cd {REMOTE_DIR} && docker build -f Dockerfile.remote -t flattalk:latest . 2>&1 | tail -20"
    run_remote(ssh, build_cmd, timeout=300)
    print("      镜像构建完成")

    # 6. 重启容器
    print("\n[6/7] 重启容器...")
    # 获取现有容器的网络配置
    run_remote(ssh, "docker stop flattalk-app 2>/dev/null || true")
    run_remote(ssh, "docker rm flattalk-app 2>/dev/null || true")

    # 启动新容器（使用相同配置 + data/proto/geographicSVG/ui 挂载）
    run_cmd = (
        f"docker run -d --name flattalk-app "
        f"--restart unless-stopped "
        f"--network tag-system_default "
        f"--network tag-system-net "
        f"--env-file {REMOTE_DIR}/.env "
        f"-p 5298:5298 -p 5444:5444 "
        f"-v {REMOTE_DIR}/ssl:/app/ssl:ro "
        f"-v {REMOTE_DIR}/data:/app/data "
        f"-v {REMOTE_DIR}/proto:/app/proto:ro "
        f"-v {REMOTE_DIR}/geographicSVG:/app/geographicSVG:ro "
        f"-v {REMOTE_DIR}/ui:/app/ui:ro "
        f"flattalk:latest"
    )
    run_remote(ssh, run_cmd)
    print("      容器已启动")

    # 7. 验证
    print("\n[7/7] 验证服务...")
    time.sleep(5)
    run_remote(ssh, "docker ps --filter name=flattalk-app --format '{{.Names}} | {{.Status}} | {{.Ports}}'")
    run_remote(ssh, "curl -s http://localhost:5298/api/health 2>&1 || echo '(服务未就绪)'")
    run_remote(ssh, "curl -sk https://localhost:5444/api/health 2>&1 || echo '(HTTPS未就绪)'")

    # 清理
    run_remote(ssh, f"rm -f {REMOTE_TARBALL}")

    ssh.close()
    print("\n[完成] 部署结束")


def run_remote(ssh, cmd, timeout=120):
    """执行远程命令并打印输出"""
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out:
        for line in out.split('\n'):
            print(f"      {line}")
    if err and 'WARNING' not in err and 'warning' not in err.lower():
        for line in err.split('\n')[:5]:
            print(f"      (stderr) {line}")


if __name__ == '__main__':
    print("=" * 60)
    print("  flatTalk 部署 → 10.21.202.9:/app/aiyl/znt/flatTalk")
    print("=" * 60)

    # 1. 打包
    tarball = create_tarball()

    # 2. 上传+部署
    upload_and_deploy(tarball)

    # 3. 清理本地压缩包
    os.remove(tarball)
    print("\n本地压缩包已清理")
