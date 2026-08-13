#!/bin/bash
set -u
echo "=== local python base images ==="
docker images --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}' | grep -iE 'python|xuanyuan' | head -30
echo ""
echo "=== host __init__ files ==="
ls -la /mnt/llgj/apps/gxy/LIS-System/app/__init__.py
ls -la /mnt/llgj/apps/gxy/Tag-System/app/models/__init__.py
ls -la /mnt/llgj/apps/gxy/Tag-System/app/__init__.py 2>&1
echo ""
echo "=== dockerignore ==="
cat /mnt/llgj/apps/gxy/Tag-System/.dockerignore
echo "---"
cat /mnt/llgj/apps/gxy/LIS-System/.dockerignore 2>&1 || echo no-lis-dockerignore
echo ""
echo "=== find all __init__ under Tag app ==="
find /mnt/llgj/apps/gxy/Tag-System/app -name '__init__.py' | head -40
find /mnt/llgj/apps/gxy/LIS-System/app -name '__init__.py' | head -20
