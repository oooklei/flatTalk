#!/bin/bash
# 探测 PG 真实凭据、已有 flatTalk 部署结构、gxy 目录状态
echo "=== pg 容器真实用户 ==="
docker inspect pg --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -Ei 'POSTGRES|PG'

echo ""
echo "=== flattalk-postgres 真实用户 ==="
docker inspect flattalk-postgres --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -Ei 'POSTGRES|PG'

echo ""
echo "=== flattalk-postgres 库清单（用真实用户）==="
PGU=$(docker inspect flattalk-postgres --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^POSTGRES_USER=' | cut -d= -f2)
echo "user=$PGU"
docker exec flattalk-postgres psql -U "${PGU:-tag_system}" -tAc "SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname" 2>&1 | head -20

echo ""
echo "=== tag_system 库表数 ==="
docker exec flattalk-postgres psql -U "${PGU:-tag_system}" -d tag_system -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>&1
echo "关键表:"
docker exec flattalk-postgres psql -U "${PGU:-tag_system}" -d tag_system -tAc "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('user_center_user','tag','entity','sync_task') ORDER BY table_name" 2>&1

echo ""
echo "=== pg (pgvector) 真实用户探测 ==="
PGU2=$(docker inspect pg --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^POSTGRES_USER=' | cut -d= -f2)
echo "user=$PGU2"
docker exec pg psql -U "${PGU2:-root}" -tAc "SELECT datname FROM pg_database WHERE datistemplate=false" 2>&1 | head

echo ""
echo "=== /mnt/llgj/apps/gxy 现状 ==="
ls -la /mnt/llgj/apps/gxy/ 2>/dev/null || echo "(gxy 为空或不存在)"

echo ""
echo "=== 现有 flatTalk2 部署结构 ==="
ls -1 /mnt/llgj/apps/flatTalk2/ 2>/dev/null | head -20
echo "--- compose 文件 ---"
cat /mnt/llgj/apps/flatTalk2/docker-compose.yml 2>/dev/null | head -40

echo ""
echo "=== 可停止的 exited 容器占用空间 ==="
docker system df

echo ""
echo "=== 内存 top5 容器 ==="
docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}' 2>/dev/null | head -12
