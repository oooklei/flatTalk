import http from "node:http";
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

const server = http.createServer(createApp(env));

server.listen(env.port, env.host, () => {
  console.log(`flatTalk listening on http://${env.host}:${env.port}`);
});
