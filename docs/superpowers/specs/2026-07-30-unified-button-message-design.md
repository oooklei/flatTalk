# 统一按钮消息处理设计

## 背景

当前 flatTalk 项目中存在两种按钮处理机制：
1. **追问栏按钮（followup）**：直接调用 `handleFollowupSuggestion` 方法
2. **模板内按钮**：通过 iframe `postMessage` 发送消息

这两种机制耦合度不同、消息格式不同，维护成本高。本设计旨在统一消息处理机制，实现"内聚而非耦合"。

## 目标

1. 统一按钮消息格式
2. 模板内按钮和追问栏按钮使用相同的消息协议
3. 支持可选显示对话历史
4. 支持发送提示（触发新对话）和执行动作（调用 API）

## 设计

### 统一消息格式

```javascript
{
  type: 'gxy_card_action',              // 固定标识，用于过滤消息
  action_key: 'xxx',                    // 可选：动作键（如 travel_route.check_weather_risk）
  user_prompt: '查看天气风险',          // 用户提示文本
  template_id: 'travel_weather_risk_card',  // 可选：目标模板
  intent: 'travel_route_weather',           // 可选：意图标识
  skill_key: 'travel_route',                // 可选：技能键
  show_in_history: true,                    // 是否在对话历史中显示，默认 true
  params: { city: '防城港' }                // 可选：额外参数
}
```

**字段说明**：
- `type`：必填，固定为 `gxy_card_action`，用于过滤消息
- `action_key`：可选，有则调用 `/api/chat/action`，否则调用 `/api/chat/followup`
- `user_prompt`：必填，显示给用户的文本
- `template_id` / `intent` / `skill_key`：可选，用于智能路由
- `show_in_history`：默认 `true`，控制是否在对话气泡中显示
- `params`：可选，传递给后端的额外参数

### 消息处理流程

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│ 追问栏按钮点击   │────>│ postMessage 发送消息  │────>│ 统一消息处理器   │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                                                              │
┌─────────────────┐     ┌──────────────────────┐             │
│ 模板内按钮点击   │────>│ postMessage 发送消息  │─────────────┘
└─────────────────┘     └──────────────────────┘
                                                              │
                                              ┌───────────────┴───────────────┐
                                              │                               │
                                      有 action_key                    无 action_key
                                              │                               │
                                              ▼                               ▼
                                    handleAssistantAction         handleFollowupSuggestion
                                              │                               │
                                              ▼                               ▼
                                      /api/chat/action             /api/chat/followup
```

### 代码改造

#### 1. 新增统一消息处理器

```javascript
// mobile.js
function handleCardActionMessage(event) {
  const data = event.data;
  if (!data || data.type !== 'gxy_card_action') return;

  const app = window.GuiXiaoYangMobileApp;
  if (!app) return;

  // 根据是否有 action_key 决定调用哪个方法
  if (data.action_key) {
    app.handleAssistantAction(null, data);
  } else {
    app.handleFollowupSuggestion(data, null);
  }
}

window.addEventListener('message', handleCardActionMessage);
```

#### 2. 追问按钮改造

```javascript
// 追问按钮点击 -> 发送 postMessage
button.addEventListener('click', () => {
  window.postMessage({
    type: 'gxy_card_action',
    ...suggestion,
  }, '*');
});
```

#### 3. handleAssistantAction 改造

```javascript
async handleAssistantAction(button, action = {}) {
  if (!action?.action_key || this.state.sending) return;

  const showInHistory = action.show_in_history !== false;

  if (showInHistory) {
    this.addBubble('user', action.user_prompt || action.label || action.action_key);
    this.addBubble('ai', '处理中...', { pending: true });
  }

  // 调用 action API
  const payload = await fetchJson('/api/chat/action', { ... });
  this.handleRemoteResult(payload);
}
```

#### 4. handleFollowupSuggestion 改造

```javascript
async handleFollowupSuggestion(suggestion = {}, button = null) {
  const prompt = suggestion.user_prompt || suggestion.label || '';
  if (!prompt || this.state.sending) return;

  const showInHistory = suggestion.show_in_history !== false;

  if (showInHistory) {
    this.addBubble('user', prompt);
    this.addBubble('ai', '处理中...', { pending: true });
  }

  // 调用 followup API
  const payload = await fetchJson('/api/chat/followup', { ... });
  this.handleRemoteResult(payload);
}
```

#### 5. 模板内按钮示例

```html
<button onclick="window.parent.postMessage({
  type: 'gxy_card_action',
  user_prompt: '查看天气风险',
  template_id: 'travel_weather_risk_card',
  intent: 'travel_route_weather',
  skill_key: 'travel_route',
  show_in_history: true,
  params: { city: '防城港' }
}, '*')">查看天气风险</button>
```

### 需要修改的文件

| 文件 | 改动 |
|------|------|
| `src/public/mobile.js` | 1. 新增统一消息处理器 `handleCardActionMessage`<br>2. 改造追问按钮，改为发送 postMessage<br>3. 改造 `handleAssistantAction` 支持 `show_in_history`<br>4. 改造 `handleFollowupSuggestion` 支持 `show_in_history` |
| 模板 HTML 文件 | 按钮使用 `postMessage` 发送统一格式消息 |

### 向后兼容

- 现有的 `data-mobile-action` 和 `data-mobile-followup` 属性保持不变
- 点击事件改为发送 postMessage，而不是直接调用方法
- 消息处理器作为统一入口

### 测试要点

1. 追问按钮点击 → 正常显示对话历史 → 正确路由到模板
2. 模板内按钮点击 → 正常显示对话历史 → 正确调用 action API
3. `show_in_history: false` → 不显示在对话历史中
4. 带 `params` 参数的按钮 → 参数正确传递到后端

## 收益

1. **内聚**：消息格式统一，处理逻辑集中在一处
2. **解耦**：模板不需要知道父窗口的实现细节
3. **可扩展**：新增按钮行为只需配置，不需要改代码
4. **一致性**：追问按钮和模板内按钮行为一致
