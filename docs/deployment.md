# flatTalk 容器化部署指南

本文档说明如何将 flatTalk 服务容器化部署到 Linux 服务器。

## 📋 前置条件

- Docker 20.10+
- Docker Compose 2.0+
- 至少 2GB 可用内存
- SSL 证书文件（用于 HTTPS）
- 网络可访问依赖服务（数据库、Redis 等）

## 🔒 HTTPS 安全端口

由于前端需要使用话筒输入功能，浏览器要求必须使用 HTTPS 安全上下文。服务将同时监听：
- **HTTP 5298**：内部通信、健康检查
- **HTTPS 5443**：前端访问（话筒等安全功能）

## 🚀 快速部署

### 1. 准备 SSL 证书

```bash
# 开发测试：生成自签名证书
cd ssl/
chmod +x generate-cert.sh
./generate-cert.sh

# 生产环境：使用正规 CA 证书
# 将证书文件放入 ssl/ 目录
# - server.key (私钥)
# - server.crt (证书)
```

### 2. 准备环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置，填入实际的密钥和地址
vim .env
```

### 3. 构建并启动

```bash
# 构建镜像
docker compose build

# 启动服务
docker compose up -d

# 查看日志
docker compose logs -f flattalk
```

### 4. 验证部署

```bash
# HTTP 健康检查
curl http://localhost:5298/api/health

# HTTPS 前端访问
curl -k https://localhost:5443/api/health

# 预期返回
# {"ok":true,"service":"flatTalk","runtime_mode":"production"}
```

## 📁 文件结构

```
flatTalk/
├── Dockerfile              # 容器构建配置
├── docker-compose.yml      # 服务编排配置
├── .dockerignore           # 构建排除文件
├── ecosystem.config.cjs    # PM2 进程管理配置
├── nginx.conf              # Nginx 反向代理配置
├── .env.example            # 环境变量模板
├── ssl/                    # SSL 证书目录
│   ├── server.key          # 私钥（不要提交）
│   ├── server.crt          # 证书
│   ├── generate-cert.sh    # 自签名证书生成脚本
│   └── README.md           # 证书说明
└── src/
    └── server.js           # 服务入口（支持 HTTP + HTTPS）
```

## 🔧 配置说明

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `FLATTALK_HOST` | 监听地址 | `0.0.0.0` |
| `FLATTALK_PORT` | HTTP 端口 | `5298` |
| `FLATTALK_SSL_PORT` | HTTPS 端口 | `5443` |
| `FLATTALK_SSL_KEY` | SSL 私钥路径 | `/app/ssl/server.key` |
| `FLATTALK_SSL_CERT` | SSL 证书路径 | `/app/ssl/server.crt` |
| `FLATTALK_PG_URL` | PostgreSQL 连接串 | - |
| `FLATTALK_REDIS_URL` | Redis 连接串 | - |

### 数据持久化

以下目录需要挂载卷或持久化：

| 目录 | 说明 |
|------|------|
| `/app/data` | 日志文件 |
| `/app/ssl` | SSL 证书 |
| `/app/assets` | 静态资源 |

## 🐳 Docker 命令

```bash
# 查看容器状态
docker compose ps

# 重启服务
docker compose restart flattalk

# 停止服务
docker compose down

# 查看资源使用
docker stats flattalk-app

# 进入容器
docker compose exec flattalk sh

# 清理构建缓存
docker builder prune
```

## 📊 监控与日志

### 日志查看

```bash
# Docker 日志
docker compose logs -f --tail 100 flattalk

# 应用日志（容器内）
docker compose exec flattalk cat /app/data/runtime.log
```

### 健康检查

```bash
# Docker 健康状态
docker inspect --format='{{.State.Health.Status}}' flattalk-app

# API 健康检查
curl -s http://localhost:5298/api/health | jq .
```

## 🔐 安全建议

1. **不要提交 `.env` 文件**：包含敏感信息
2. **不要提交 `ssl/server.key`**：私钥文件
3. **使用 Docker Secrets**：生产环境推荐使用 secrets 管理密钥
4. **限制网络访问**：仅开放必要端口
5. **定期更新基础镜像**：`docker compose pull && docker compose up -d`
6. **生产环境使用正规 CA 证书**：不要使用自签名证书

## 🔄 更新部署

```bash
# 拉取最新代码
git pull

# 更新 SSL 证书（如需要）
cp /path/to/new/server.key ssl/
cp /path/to/new/server.crt ssl/

# 重新构建并启动
docker compose up -d --build

# 清理旧镜像
docker image prune -f
```

## 🎤 话筒功能说明

话筒输入功能需要 HTTPS 安全上下文：

1. 浏览器要求 HTTPS 才能访问麦克风
2. 用户首次访问时会弹出权限请求
3. 权限授予后即可使用语音输入

前端访问地址：`https://your-domain:5443/`

## ❗ 常见问题

### Q1: 容器无法连接数据库

**原因**：网络拓扑变化，内网 IP 不可达

**解决**：修改 `.env` 中的数据库地址为服务名或外部可访问地址

### Q2: HTTPS 证书错误

**原因**：使用了自签名证书

**解决**：
- 开发测试：浏览器中手动信任证书
- 生产环境：使用正规 CA 证书

### Q3: 话筒无法使用

**原因**：
1. 未使用 HTTPS 访问
2. 浏览器权限未授予

**解决**：
1. 确保使用 `https://` 地址访问
2. 检查浏览器地址栏是否有权限图标

### Q4: 端口被占用

**原因**：宿主机端口已被使用

**解决**：修改 `docker-compose.yml` 中的 `ports` 映射

### Q5: 日志文件过大

**原因**：日志未轮转

**解决**：配置 Docker 日志驱动或挂载日志卷

## 📞 联系支持

如有问题，请联系技术团队。