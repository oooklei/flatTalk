#!/bin/bash
# 把本机导出的 42 表结构 + 数据恢复到远程 flattalk-postgres 的 tag_system 库。
# 现有库只有 1 张表，本脚本会 DROP 重建同名表，其余对象不动。
set -u
cd /mnt/llgj/apps/gxy/pgdump || exit 1

PGC=flattalk-postgres
PGU=tag_system
PGD=tag_system

echo "=== 恢复前表数 ==="
docker exec $PGC psql -U $PGU -d $PGD -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"

echo ""
echo "=== 1/3 建表结构 ==="
docker cp 00_schema.sql $PGC:/tmp/00_schema.sql
docker exec $PGC psql -U $PGU -d $PGD -v ON_ERROR_STOP=0 -q -f /tmp/00_schema.sql 2>&1 | tail -20

echo ""
echo "=== 2/3 导入数据 ==="
ok=0; fail=0
for f in data_*.sql; do
  docker cp "$f" $PGC:/tmp/d.sql >/dev/null 2>&1
  if docker exec $PGC psql -U $PGU -d $PGD -v ON_ERROR_STOP=1 -q -f /tmp/d.sql >/tmp/imp.log 2>&1; then
    ok=$((ok+1))
  else
    fail=$((fail+1))
    echo "  FAIL $f:"
    tail -3 /tmp/imp.log | sed 's/^/    /'
  fi
done
echo "导入结果: ok=$ok fail=$fail"

echo ""
echo "=== 3/3 序列重置 ==="
docker cp 99_sequences.sql $PGC:/tmp/99_seq.sql
docker exec $PGC psql -U $PGU -d $PGD -q -f /tmp/99_seq.sql 2>&1 | tail -5

echo ""
echo "=== 恢复后核对 ==="
docker exec $PGC psql -U $PGU -d $PGD -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"

echo ""
echo "=== 关键表行数 ==="
for t in user_center_user user_center_org entity_tag tag_definition mobile_workorder service_order work_order feedback mobile_service_item; do
  n=$(docker exec $PGC psql -U $PGU -d $PGD -tAc "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo ERR)
  printf "  %-28s %s\n" "$t" "$n"
done

echo ""
echo "=== 清理容器内临时文件 ==="
docker exec $PGC sh -c 'rm -f /tmp/00_schema.sql /tmp/d.sql /tmp/99_seq.sql /tmp/imp.log'
echo done
