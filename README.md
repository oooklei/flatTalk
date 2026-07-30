# flatTalk

flatTalk 是一个独立的本地技能运行时项目，用于承载后续从旧系统拆分出的对话技能、场景路由、运行时服务与资源副本。

当前 Task 1 只创建项目骨架，并提供最小 HTTP 服务：

- `GET /api/health` 返回 flatTalk 健康状态。
- 其他路径返回 JSON 形式的 `not_found`。

启动方式：

```bash
npm install
npm start
```

默认服务地址为 `http://127.0.0.1:5298`。
