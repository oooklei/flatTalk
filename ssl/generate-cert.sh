#!/bin/bash
# 生成自签名 SSL 证书（仅用于开发测试）
# 生产环境请使用正规 CA 签发的证书

set -e

SSL_DIR="$(dirname "$0")"
cd "$SSL_DIR"

echo "=== 生成自签名 SSL 证书 ==="
echo "证书目录: $SSL_DIR"
echo ""

# 生成私钥
openssl genrsa -out server.key 2048

# 生成证书签名请求（CSR）
openssl req -new -key server.key -out server.csr -subj "/C=CN/ST=Guangxi/L=Nanning/O=GuiCare/OU=flatTalk/CN=localhost"

# 生成自签名证书（有效期 365 天）
openssl x509 -req -days 365 -in server.csr -signkey server.key -out server.crt

# 清理 CSR 文件
rm -f server.csr

# 设置权限
chmod 600 server.key server.crt

echo ""
echo "=== 证书生成完成 ==="
echo "私钥: $SSL_DIR/server.key"
echo "证书: $SSL_DIR/server.crt"
echo ""
echo "注意: 此证书仅用于开发测试，生产环境请使用正规 CA 签发的证书。"