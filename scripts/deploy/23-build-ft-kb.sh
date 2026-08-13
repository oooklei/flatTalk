#!/bin/bash
# 仅重建并启动 local-kb + flattalk（LIS/TAG/BGE 已就绪）
set -u
BASE=/mnt/llgj/apps/gxy
cd "$BASE" || exit 1
DC=docker-compose

echo "=== strip BOM in Dockerfiles ==="
for f in flatTalk/Dockerfile flatTalk/local-kb/Dockerfile flatTalk/local-kb/Dockerfile.bge Tag-System/Dockerfile LIS-System/Dockerfile; do
  python3 - <<PY
from pathlib import Path
p=Path("$f")
b=p.read_bytes()
n=0
while b.startswith(b"\xef\xbb\xbf"):
    b=b[3:]; n+=1
p.write_bytes(b)
print(p, "bom_stripped", n, "head", b[:40])
PY
done

echo ""
echo "=== build local-kb + flattalk ==="
$DC build gxy-local-kb gxy-flattalk 2>&1 | tee /tmp/gxy-build-ft2.log | tail -60

echo ""
echo "=== up ==="
$DC up -d gxy-local-kb gxy-flattalk 2>&1 | tail -20

for i in $(seq 1 48); do
  f=$(curl -fsS --max-time 3 http://127.0.0.1:5301/api/health >/dev/null 2>&1 && echo 1 || echo 0)
  k=$(curl -fsS --max-time 3 http://127.0.0.1:9016/health >/dev/null 2>&1 && echo 1 || echo 0)
  echo "t=$((i*5))s ft=$f kb=$k"
  [ "$f" = 1 ] && [ "$k" = 1 ] && break
  sleep 5
done

echo ""
docker ps -a --filter name=gxy- --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
printf "LIS  : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:8100/health
printf "TAG  : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:8011/api/v1/health
printf "KB   : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:9016/health
printf "FT   : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 http://127.0.0.1:5301/api/health

for c in gxy-local-kb gxy-flattalk; do
  st=$(docker inspect "$c" --format '{{.State.Status}}' 2>/dev/null || echo missing)
  if [ "$st" != running ]; then
    echo "--- $c ($st) ---"
    docker logs "$c" --tail 50 2>&1
  fi
done
