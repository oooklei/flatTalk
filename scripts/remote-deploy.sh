#!/bin/bash
# flatTalk 远程部署构建脚本
set -e

DEPLOY_DIR="/app/aiyl/znt/flatTalk"
cd "$DEPLOY_DIR"

echo "===== 1. 解压代码 ====="
tar xzf flattalk-deploy.tar.gz
echo "解压完成: $(ls -1 | head -10)"

echo "===== 2. 检查 Docker 环境 ====="
docker version --format '{{.Server.Version}}' 2>/dev/null || { echo "Docker 不可用!"; exit 1; }

# 检查端口占用
echo "===== 3. 检查端口 ====="
for port in 5298 5444; do
  if ss -tlnp | grep ":$port " > /dev/null 2>&1; then
    echo "警告: 端口 $port 被占用"
    ss -tlnp | grep ":$port "
  else
    echo "端口 $port 可用"
  fi
done

echo "===== 4. 检查 node 镜像 ====="
if docker images | grep -q "node.*20.*alpine"; then
  echo "node:20-alpine 镜像已存在"
else
  echo "需要拉取 node:20-alpine 镜像"
fi

echo "===== 5. 创建 .env（如不存在）====="
if [ ! -f .env ]; then
  cat > .env << 'ENVEOF'
FLATTALK_HOST=0.0.0.0
FLATTALK_PORT=5298
FLATTALK_SSL_PORT=5444
FLATTALK_RUNTIME_MODE=local
NODE_ENV=production
ENVEOF
  echo ".env 已创建（基础配置）"
else
  echo ".env 已存在"
fi

echo "===== 6. 构建 Docker 镜像 ====="
# 尝试使用 docker.xuanyuan.me 代理，失败则用直连
docker build -t flattalk:latest --target production . 2>&1 | tail -20
BUILD_EXIT=${PIPESTATUS[0]}

if [ $BUILD_EXIT -ne 0 ]; then
  echo "构建失败，尝试修改 Dockerfile 使用直连..."
  sed -i 's|docker.xuanyuan.me/library/||g' Dockerfile
  docker build -t flattalk:latest --target production . 2>&1 | tail -20
fi

echo "===== 7. 启动容器 ====="
docker run -d \
  --name flattalk-app \
  --restart unless-stopped \
  -p 5298:5298 \
  -p 5444:5444 \
  -e NODE_ENV=production \
  -e FLATTALK_HOST=0.0.0.0 \
  -e FLATTALK_PORT=5298 \
  -e FLATTALK_SSL_PORT=5444 \
  -v flattalk-logs:/app/data \
  flattalk:latest

echo "===== 8. 等待启动 ====="
sleep 5

echo "===== 9. 检查状态 ====="
docker ps | grep flattalk-app
echo "--- 日志 ---"
docker logs flattalk-app --tail 10 2>&1

echo "===== 部署完成 ====="
echo "访问地址: http://$(hostname -I | awk '{print $1}'):5298"
