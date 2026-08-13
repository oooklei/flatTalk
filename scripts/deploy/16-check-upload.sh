#!/bin/bash
set -u
echo "=== remote tar ==="
ls -lh /tmp/gxy_deploy.tar.gz 2>&1 || echo "no tar"
echo "=== gxy dir ==="
du -sh /mnt/llgj/apps/gxy 2>&1
ls -1 /mnt/llgj/apps/gxy
echo "=== flatTalk mtime sample ==="
stat -c '%y %n' /mnt/llgj/apps/gxy/flatTalk/src/skills/find_service/lib/data-assembler.js 2>&1 || echo missing
echo "=== compose ==="
head -5 /mnt/llgj/apps/gxy/docker-compose.yml 2>&1 || echo no compose
echo "=== containers ==="
docker ps -a --filter name=gxy- --format '{{.Names}}\t{{.Status}}'
