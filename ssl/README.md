# SSL 证书目录

此目录存放 HTTPS 服务器证书文件。

## 文件说明

| 文件 | 说明 |
|------|------|
| `server.key` | 服务器私钥（保密） |
| `server.crt` | 服务器证书 |

## 生成自签名证书（开发测试）

```bash
# Linux/Mac
chmod +x generate-cert.sh
./generate-cert.sh

# Windows (PowerShell)
# 需要安装 OpenSSL 或使用 Git Bash
```

## 生产环境证书

生产环境请使用正规 CA 签发的证书，如：
- Let's Encrypt（免费）
- 阿里云 SSL 证书
- 腾讯云 SSL 证书

将证书文件放入此目录：
- `server.key` - 私钥文件
- `server.crt` - 证书文件（包含完整证书链）

## 注意事项

1. **私钥文件不要提交到版本控制**
2. **生产环境证书建议使用通配符证书或多域名证书**
3. **证书过期前需要提前更新**