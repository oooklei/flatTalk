# 女娲平台API参考(从源码分析得出)

## 从nuwax-backend-main源码分析的API清单

## 一、智能体(Agent)管理

| API | 方法 | 用途 | 请求体 |
|-----|------|------|--------|
| `/api/agent/add` | POST | 创建智能体 | `{spaceId, name, description, type}` |
| `/api/agent/{agentId}` | GET | 查询智能体详情 | - |
| `/api/agent/config/update` | POST | 更新配置(含systemPrompt) | `{id, systemPrompt, userPrompt, openLongMemory, ...}` |
| `/api/agent/delete/{agentId}` | POST | 删除智能体 | - |
| `/api/agent/publish/apply/{agentId}` | POST | 发布智能体 | `{remark}` |

### AgentAddDto
```json
{
  "spaceId": 7,
  "name": "findService",
  "description": "AI找服务智能体",
  "type": "ChatBot"
}
```

### AgentConfigUpdateDto (config/update)
```json
{
  "id": 99,
  "systemPrompt": "系统提示词...",
  "userPrompt": "{{AGENT_USER_MSG}}",
  "openLongMemory": "Open",
  "openSuggest": "Close"
}
```

## 二、智能体组件绑定

| API | 方法 | 用途 | 请求体 |
|-----|------|------|--------|
| `/api/agent/component/knowledge/update` | POST | 绑定知识库 | `{id:组件ID, targetId:知识库ID, bindConfig:{invokeType,searchStrategy,maxRecallCount,matchingDegree}}` |
| `/api/agent/component/workflow/update` | POST | 绑定Workflow | `{id:组件ID, targetId:工作流ID, bindConfig:{invokeType}}` |
| `/api/agent/component/skill/update` | POST | 绑定技能 | `{id:组件ID, targetId:技能ID, bindConfig:{invokeType}}` |
| `/api/agent/component/table/update` | POST | 绑定数据表 | `{id:组件ID, targetId:表ID, bindConfig}` |
| `/api/agent/component/model/update` | POST | 更新模型配置 | `{id:组件ID, targetId:模型ID, bindConfig}` |
| `/api/agent/component/add` | POST | 添加组件 | `{id:agentId, name, type, targetId}` |

### KnowledgeBaseBindConfigDto
```json
{
  "invokeType": "AUTO",
  "defaultSelected": 1,
  "searchStrategy": "SEMANTIC",
  "maxRecallCount": 5,
  "matchingDegree": 0.85,
  "noneRecallReplyType": "DEFAULT",
  "noneRecallReply": ""
}
```

### WorkflowBindConfigDto
```json
{
  "invokeType": "AUTO",
  "argBindConfigs": [],
  "outputArgBindConfigs": [],
  "async": 0,
  "defaultSelected": 1,
  "directOutput": 0,
  "useResultCache": false
}
```

## 三、知识库管理

| API | 方法 | 用途 | 请求体 |
|-----|------|------|--------|
| `/api/knowledge/config/add` | POST | 创建知识库Collection | `{name, description, spaceId, embeddingModelId}` |
| `/api/knowledge/config/list` | POST | 查询知识库列表 | `{pageNo, pageSize, spaceId}` |
| `/api/knowledge/document/add` | POST | 上传文件到知识库 | `{kbId, fileList:[{fileUrl,fileSize}], autoSegmentConfigFlag}` |
| `/api/knowledge/document/customAdd` | POST | **自定义文本上传到知识库** | `{kbId, name, fileContent, autoSegmentConfigFlag}` |
| `/api/knowledge/document/list` | POST | 查询文档列表 | `{kbId, pageNo, pageSize}` |
| `/api/knowledge/query` | POST | 知识库检索 | `{collection, query, top_k, filter, min_score}` |
| `/api/knowledge/document/deleteById` | GET | 删除文档 | `?id=xxx` |

### KnowledgeDocumentCustomAddRequest (customAdd - 文本上传)
```json
{
  "kbId": 49,
  "name": "紧急关键词_心脏病",
  "fileContent": "心脏病、心梗、中风、脑梗、跌倒",
  "autoSegmentConfigFlag": true
}
```

## 四、Workflow管理

| API | 方法 | 用途 | 请求体 |
|-----|------|------|--------|
| `/api/workflow/add` | POST | 创建Workflow | `{spaceId, name, description}` |
| `/api/workflow/save` | POST | 保存Workflow配置(含节点) | `{workflowConfig: {id, nodes, edges, ...}}` |
| `/api/workflow/{workflowId}` | GET | 查询Workflow详情 | - |
| `/api/workflow/update` | POST | 更新Workflow | `{id, name, description}` |
| `/api/workflow/delete/{workflowId}` | POST | 删除Workflow | - |
| `/api/workflow/node/add` | POST | 添加节点 | `{workflowId, nodeType, config}` |
| `/api/workflow/node/update` | POST | 更新节点 | `{id, config}` |

### WorkflowAddDto
```json
{
  "spaceId": 7,
  "name": "findService_workflow",
  "description": "找服务智能体工作流"
}
```

## 五、技能(Skill)管理

| API | 方法 | 用途 | 请求体 |
|-----|------|------|--------|
| `/api/skill/add` | POST | 创建技能 | `{name, description, spaceId, files:[{name, contents, isDir}], usageScenarios}` |
| `/api/skill/update` | POST | 更新技能 | `{id, name, description, files:[...]}` |
| `/api/skill/delete/{skillId}` | POST | 删除技能 | - |

### SkillAddDto
```json
{
  "name": "findService_skill",
  "description": "找服务技能",
  "spaceId": 7,
  "files": [
    {"name": "workflows/kb_retrieve.md", "contents": "# 文件内容...", "isDir": false},
    {"name": "templates", "contents": "", "isDir": true},
    {"name": "templates/kb_answer_template.md", "contents": "...", "isDir": false},
    {"name": "scripts", "contents": "", "isDir": true},
    {"name": "scripts/backend", "contents": "", "isDir": true},
    {"name": "scripts/backend/kb_retrieve_api.js", "contents": "...", "isDir": false}
  ],
  "usageScenarios": ["TaskAgent"]
}
```

### SkillFileDto
```json
{
  "name": "文件路径(相对于技能根目录)",
  "contents": "文件内容(文本)",
  "isDir": false
}
```

## 六、数据表管理

| API | 方法 | 用途 |
|-----|------|------|
| `/api/compose/db/table/add` | POST | 创建表定义 |
| `/api/compose/db/table/updateTableDefinition` | POST | 定义字段 |
| `/api/compose/db/table/addBusinessData` | POST | 插入数据 |
| `/api/compose/db/table/getTableDataById` | GET | 查询数据 |
| `/api/compose/db/table/list` | POST | 查询表列表 |
| `/api/compose/db/table/detailById` | GET | 查询表详情 |

## 七、认证

| API | 方法 | 用途 |
|-----|------|------|
| `/api/user/passwordLogin` | POST | 密码登录(返回Cookie: ticket) |

Token传递方式: `Cookie: ticket={token}` 或 `Authorization: Bearer {token}`

---

**源码位置**: `nuwax-backend-main/app-platform-modules/`
- Agent: `app-platform-agent/app-platform-agent-core-ui/src/main/java/com/xspaceagi/agent/web/ui/controller/`
- Knowledge: `app-platform-knowledge/app-platform-knowledge-core-ui/src/main/java/com/xspaceagi/knowledge/man/ui/web/`
- Workflow: `app-platform-agent/app-platform-agent-core-ui/src/main/java/com/xspaceagi/agent/web/ui/controller/WorkflowController.java`
- Skill: `app-platform-agent/app-platform-agent-core-ui/src/main/java/com/xspaceagi/agent/web/ui/controller/SkillController.java`
