#!/bin/bash
# 诊断 gxy-lis unhealthy 与 gxy-flattalk 镜像缺失
set -u

echo "=== gxy-lis 健康检查日志 ==="
docker inspect gxy-lis --format '{{range .State.Health.Log}}exit={{.ExitCode}} out={{.Output}}
{{end}}' 2>&1 | tail -c 1200

echo ""
echo "=== 容器内直连 /health ==="
docker exec gxy-lis curl -sS -o /dev/null -w 'http=%{http_code} time=%{time_total}s\n' --max-time 10 http://127.0.0.1:8100/health 2>&1

echo ""
echo "=== healthcheck 命令是否存在 ==="
docker inspect gxy-lis --format '{{json .Config.Healthcheck}}' 2>&1

echo ""
echo "=== 宿主机访问 ==="
curl -sS -o /dev/null -w 'http=%{http_code}\n' --max-time 8 http://127.0.0.1:8100/health 2>&1

echo ""
echo "=== gxy-flattalk 镜像 ==="
docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep -E 'flattalk' || echo "(无 flattalk 镜像)"

echo ""
echo "=== 全部 gxy 镜像 ==="
docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep -E '^gxy'
