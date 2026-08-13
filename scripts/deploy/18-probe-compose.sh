#!/bin/bash
# probe compose tooling on 192.168.1.2
set -u
echo "=== docker version ==="
docker version --format '{{.Server.Version}}' 2>/dev/null || docker version | head -20
echo ""
echo "=== which compose ==="
which docker-compose 2>/dev/null || echo no-docker-compose
docker compose version 2>&1 | head -5
docker-compose version 2>&1 | head -5
echo ""
echo "=== images gxy ==="
docker images --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}' | grep -E '^gxy-|REPOSITORY' | head -20
echo ""
echo "=== containers gxy ==="
docker ps -a --filter name=gxy- --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
echo ""
echo "=== network ==="
docker network ls | grep -i flat
docker network inspect flattalk_flattalk-network --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null | tr ' ' '\n' | head -20
echo ""
echo "=== .env.deploy exists? ==="
ls -la /mnt/llgj/apps/gxy/flatTalk/.env.deploy 2>&1 | head -3
ls -la /mnt/llgj/apps/gxy/docker-compose.yml 2>&1 | head -3
