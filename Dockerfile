# flatTalk 服务容器化部署配置
# 使用目标机本地 node 镜像，避免轩辕代理 429

# ==================== 构建阶段 ====================
FROM node:20-alpine AS builder

WORKDIR /app

# 设置 npm 镜像源
RUN npm config set registry https://registry.npmmirror.com

# 复制依赖文件
COPY package*.json ./

# 安装所有依赖（包括开发依赖，用于构建）
RUN npm ci

# 复制源代码
COPY . .

# ==================== 生产阶段 ====================
FROM node:20-alpine AS production

# 安装 tini 作为进程管理器（优雅退出）
RUN apk add --no-cache tini

# 创建非 root 用户运行应用
# node:20-alpine 已占用 uid/gid 1000，改用 1001
RUN addgroup -g 1001 flattalk && \
    adduser -u 1001 -G flattalk -s /bin/sh -D flattalk

WORKDIR /app

# 设置 npm 镜像源
RUN npm config set registry https://registry.npmmirror.com

# 复制依赖文件
COPY package*.json ./

# 仅安装生产依赖
RUN npm ci --only=production && \
    npm cache clean --force

# 复制源代码（排除 .dockerignore 中的文件）
COPY --chown=flattalk:flattalk . .

# 创建日志和证书目录
RUN mkdir -p /app/data /app/ssl && \
    chown -R flattalk:flattalk /app/data /app/ssl

# 切换到非 root 用户
USER flattalk

# 暴露端口（HTTP + HTTPS）
EXPOSE 5298 5444

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5298/api/health || exit 1

# 设置环境变量
ENV NODE_ENV=production \
    FLATTALK_HOST=0.0.0.0 \
    FLATTALK_PORT=5298 \
    FLATTALK_SSL_PORT=5444

# 启动命令（使用 tini 管理进程）
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
