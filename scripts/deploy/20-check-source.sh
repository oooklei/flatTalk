#!/bin/bash
set -u
BASE=/mnt/llgj/apps/gxy
echo "=== LIS app/__init__.py ==="
head -5 "$BASE/LIS-System/app/__init__.py"
echo "=== Tag models/__init__.py Base ==="
grep -n 'Base' "$BASE/Tag-System/app/models/__init__.py" | head -5
echo "=== file counts ==="
find "$BASE/LIS-System/app" -type f | wc -l
find "$BASE/Tag-System/app" -type f | wc -l
echo "=== missing critical? ==="
for f in \
  LIS-System/app/__init__.py \
  LIS-System/app/main.py \
  Tag-System/app/models/__init__.py \
  Tag-System/app/models/base.py \
  Tag-System/scripts/init_db.py \
  flatTalk/Dockerfile \
  flatTalk/.env.deploy
 do
  if [ -f "$BASE/$f" ]; then echo OK $f; else echo MISSING $f; fi
done
echo "=== Tag-System top ==="
ls -la "$BASE/Tag-System" | head -20
