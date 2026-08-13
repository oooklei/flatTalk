#!/bin/bash
# 探测 192.168.1.2 现有环境，为 4 项目部署做准备。只读，不改动任何服务。
echo "=== 系统 ==="
uname -r
docker --version
docker compose version 2>/dev/null || docker-compose --version 2>/dev/null

echo ""
echo "=== 磁盘 ==="
df -h /mnt/llgj 2>/dev/null | tail -1
echo "free mem:"
free -h | head -2

echo ""
echo "=== /mnt/llgj/apps 现有目录 ==="
ls -1 /mnt/llgj/apps/ 2>/dev/null || echo "(apps 不存在)"

echo ""
echo "=== 运行中的容器（可复用中间件）==="
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'

echo ""
echo "=== pg (pgvector) 数据库清单 ==="
docker exec pg psql -U postgres -tAc "SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname" 2>&1 | head -20

echo ""
echo "=== pg 已装扩展 ==="
docker exec pg psql -U postgres -tAc "SELECT extname FROM pg_extension ORDER BY extname" 2>&1 | head -10

echo ""
echo "=== flattalk-postgres 数据库清单 ==="
docker exec flattalk-postgres psql -U postgres -tAc "SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname" 2>&1 | head -20

echo ""
echo "=== flattalk-redis 状态 ==="
docker exec flattalk-redis redis-cli PING 2>&1
docker exec flattalk-redis redis-cli INFO keyspace 2>&1 | head -5

echo ""
echo "=== 网络 ==="
docker network ls --format '{{.Name}}\t{{.Driver}}'

echo ""
echo "=== flattalk2-app 所属网络与环境 ==="
docker inspect flattalk2-app --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>&1
docker inspect flattalk2-app --format '{{range .Config.Env}}{{println .}}{{end}}' 2>&1 | grep -Ei 'PG|REDIS|LIS|KB|PORT|TAG' | head -20

echo ""
echo "=== 端口占用（目标端口）==="
for p in 5298 5299 5300 8100 8011 8010 8200 5432 6379; do
  if ss -ltn 2>/dev/null | grep -q ":$p "; then echo "$p OCCUPIED"; else echo "$p free"; fi
done

echo ""
echo "=== 已停止但占资源的容器数 ==="
docker ps -a --filter status=exited --format '{{.Names}}' | wc -l
