import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv();

// 守卫：单条非法请求（如坏 JSON）导致的未捕获 Promise rejection 不应拖垮整个服务
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const app = createApp(env);

// HTTP 服务器（内部通信）
const httpServer = http.createServer(app);

// HTTPS 服务器（前端访问，用于话筒等需要安全上下文的功能）
let httpsServer = null;
const sslEnabled = env.sslKey && env.sslCert;

if (sslEnabled) {
  try {
    const sslOptions = {
      key: fs.readFileSync(env.sslKey),
      cert: fs.readFileSync(env.sslCert),
    };
    httpsServer = https.createServer(sslOptions, app);
    console.log("[SSL] HTTPS 服务器已启用");
  } catch (err) {
    console.error("[SSL] 无法加载 SSL 证书:", err.message);
    console.error("[SSL] 将仅使用 HTTP 服务器");
  }
}

// 启动 HTTP 服务器
httpServer.listen(env.port, env.host, () => {
  console.log(`flatTalk HTTP listening on http://${env.host}:${env.port}`);
});

// 启动 HTTPS 服务器
if (httpsServer && env.sslPort) {
  httpsServer.listen(env.sslPort, env.host, () => {
    console.log(`flatTalk HTTPS listening on https://${env.host}:${env.sslPort}`);
  });
}

// 优雅退出
const shutdown = () => {
  console.log("[shutdown] 正在关闭服务器...");
  httpServer.close(() => {
    console.log("[shutdown] HTTP 服务器已关闭");
    if (httpsServer) {
      httpsServer.close(() => {
        console.log("[shutdown] HTTPS 服务器已关闭");
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
  // 强制退出超时
  setTimeout(() => {
    console.error("[shutdown] 强制退出");
    process.exit(1);
  }, 5000);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);