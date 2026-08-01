#!/bin/bash
# flatTalk 一键部署脚本
# 使用方法: bash deploy.sh

set -e

APP_DIR="/mnt/llgj/apps/flatTalk"
TARBALL="/tmp/flatTalk-20260731.tar.gz"
SSL_SRC="/mnt/llgj/apps/guixiaoyang-chat-system/certs"

echo "=== flatTalk 部署脚本 ==="

# 1. 检查压缩包
if [ ! -f "$TARBALL" ]; then
    echo "错误: 压缩包不存在: $TARBALL"
    echo "请先上传项目文件"
    exit 1
fi

# 2. 清理旧版本
echo "[1/6] 清理旧版本..."
rm -rf "$APP_DIR"

# 3. 解压
echo "[2/6] 解压项目文件..."
cd /mnt/llgj/apps
tar -xzf "$TARBALL"

# 4. 复制 SSL 证书
echo "[3/6] 复制 SSL 证书..."
mkdir -p "$APP_DIR/ssl"
cp "$SSL_SRC/guixiaoyang.key" "$APP_DIR/ssl/server.key"
cp "$SSL_SRC/guixiaoyang.crt" "$APP_DIR/ssl/server.crt"

# 5. 配置环境变量
echo "[4/6] 配置环境变量..."
cd "$APP_DIR"
if [ ! -f .env ]; then
    cp .env.example .env
    echo "提示: 请编辑 .env 文件填入实际密钥"
fi

# 6. 修改 Dockerfile 使用国内镜像
echo "[5/6] 配置 Docker 镜像源..."
sed -i 's|docker.io/library/node|registry.cn-hangzhou.aliyuncs.com/library/node|g' Dockerfile 2>/dev/null || true

# 7. 构建并启动容器
echo "[6/6] 构建 Docker 容器..."
docker compose up -d --build

# 8. 等待服务启动
echo "等待服务启动..."
sleep 5

# 9. 验证服务
echo ""
echo "=== 部署完成 ==="
echo ""
echo "HTTP 健康检查:"
curl -s http://localhost:5298/api/health || echo "HTTP 检查失败"
echo ""
echo "HTTPS 健康检查:"
curl -sk https://localhost:5444/api/health || echo "HTTPS 检查失败"
echo ""

# 10. 显示容器状态
echo "容器状态:"
docker compose ps

echo ""
echo "访问地址:"
echo "  HTTP:  http://192.168.1.2:5298"
echo "  HTTPS: https://192.168.1.2:5444"