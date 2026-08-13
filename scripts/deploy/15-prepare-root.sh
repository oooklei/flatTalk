#!/bin/bash
# 把 compose 与 env 放到 /mnt/llgj/apps/gxy 根目录，并报告现状
set -u
BASE=/mnt/llgj/apps/gxy
cd "$BASE" || exit 1

echo "=== 目录 ==="
ls -1
du -sh . 2>/dev/null | head -1

echo ""
echo "=== 放置 compose / env ==="
if [ -f flatTalk/scripts/deploy/docker-compose.gxy.yml ]; then
  cp -f flatTalk/scripts/deploy/docker-compose.gxy.yml ./docker-compose.yml
  echo "compose OK"
else
  echo "MISSING flatTalk/scripts/deploy/docker-compose.gxy.yml"
fi
if [ -f flatTalk/.env.deploy ]; then
  # compose 用 env_file: ./flatTalk/.env.deploy，保持原位即可
  echo "env.deploy OK"
else
  echo "MISSING flatTalk/.env.deploy"
fi

echo ""
echo "=== 现有 gxy 容器 ==="
docker ps -a --filter name=gxy- --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'

echo ""
echo "=== 中间件网络别名 ==="
docker inspect flattalk-postgres --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} aliases={{json $v.Aliases}}{{"\n"}}{{end}}' 2>&1 | head -20
docker inspect flattalk-redis --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} aliases={{json $v.Aliases}}{{"\n"}}{{end}}' 2>&1 | head -20

echo ""
echo "=== PG 角色探测（flattalk-postgres）==="
docker exec flattalk-postgres sh -c 'psql -U tag_system -d tag_system -tAc "SELECT current_user, current_database(); SELECT count(*) FROM information_schema.tables WHERE table_name='\''mobile_service_item'\'';"' 2>&1 | head -10
