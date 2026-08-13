#!/bin/bash
# quick diagnose lis/tag crash
set -u
echo "=== gxy-tag last 80 ==="
docker logs gxy-tag --tail 80 2>&1
echo ""
echo "=== gxy-lis last 40 ==="
docker logs gxy-lis --tail 40 2>&1
echo ""
echo "=== pg alias resolve from gxy-lis ==="
docker exec gxy-lis getent hosts postgres 2>&1 || true
docker exec gxy-lis getent hosts redis 2>&1 || true
echo ""
echo "=== tag env DATABASE_URL ==="
docker inspect gxy-tag --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -E 'DATABASE|REDIS|POSTGRES' || true
