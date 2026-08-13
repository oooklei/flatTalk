#!/usr/bin/env python3
"""扫描192.168.1.2上本周一(2026-08-03)创建的镜像，识别哪些是 flattalk/flattalk2"""
import paramiko, json, sys

HOST = '192.168.1.2'
USER = 'root'
PASSWORD = '1Q2W3E4R!234'

# 目标标识（从 latest 镜像获取）
TARGETS = {
    'flattalk': {'project': 'flattalk', 'ports': {'5298/tcp', '5444/tcp'}, 'size_hint': 584},
    'flattalk2': {'project': 'flattalk2', 'ports': {'5298/tcp', '5444/tcp'}, 'size_hint': 346},
}

def run(ssh, cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
    print(f"[OK] Connected to {HOST}")

    # 获取本周一创建的所有镜像（带详细信息）
    cmd = r"""docker images -a --format '{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.CreatedAt}}\t{{.Size}}' | grep '2026-08-03'"""
    out, err = run(ssh, cmd)
    print(f"\n=== 周一(08-03)所有镜像: {len(out.splitlines())}个 ===")

    candidates = []
    for line in out.splitlines():
        parts = line.split('\t')
        if len(parts) < 5:
            continue
        img_id, repo, tag, created, size = parts[:5]
        # 只关注大于 300MB 的镜像（flattalk 级别），跳过170MB基础镜像
        size_mb = 0
        try:
            if 'MB' in size: size_mb = int(float(size.replace('MB','').strip()))
            elif 'GB' in size: size_mb = int(float(size.replace('GB','').strip()) * 1024)
        except: pass
        if size_mb >= 300:
            candidates.append({'id': img_id, 'repo': repo, 'tag': tag, 'created': created, 'size': size, 'size_mb': size_mb})

    print(f"\n=== 候选镜像(>=300MB): {len(candidates)}个 ===")
    for c in candidates:
        print(f"  {c['id']}  {c['size_mb']}MB  {c['created']}  {c['repo']}:{c['tag']}")

    # inspect 每个候选，匹配 project label
    print(f"\n=== inspect 候选镜像 labels ===")
    matched = {'flattalk': [], 'flattalk2': []}
    for c in candidates:
        out2, _ = run(ssh, f"docker inspect {c['id']} --format '{{{{.Config.Labels}}}}|{{{{.Config.ExposedPorts}}}}'")
        labels_str = out2
        print(f"  {c['id']} ({c['size_mb']}MB): {labels_str}")
        for proj in ['flattalk2', 'flattalk']:
            if f'project:{proj}' in labels_str or f'compose.project:{proj}' in labels_str:
                matched[proj].append(c)
                print(f"    -> 匹配 {proj}")
                break

    # 汇总结果
    print(f"\n{'='*60}")
    print("=== 匹配结果 ===")
    for proj in ['flattalk', 'flattalk2']:
        ms = matched[proj]
        if ms:
            # 取周一最新的一个
            latest = sorted(ms, key=lambda x: x['created'], reverse=True)[0]
            print(f"\n{proj} 周一镜像: {latest['id']} ({latest['size_mb']}MB, {latest['created']})")
        else:
            print(f"\n{proj} 周一镜像: 未找到 (周一可能未构建，或已被清理)")

    ssh.close()

if __name__ == '__main__':
    main()
