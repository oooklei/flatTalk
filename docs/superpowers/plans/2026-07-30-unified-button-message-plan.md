# 统一按钮消息处理实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一追问栏按钮和模板内按钮的消息处理机制，通过 postMessage 实现内聚解耦。

**Architecture:** 所有按钮（模板内 + 追问栏）都通过 `postMessage` 发送统一格式的消息 `{ type: 'gxy_card_action', ... }`，父窗口统一处理，根据是否有 `action_key` 决定调用 `handleAssistantAction` 或 `handleFollowupSuggestion`。

**Tech Stack:** JavaScript, postMessage API, flatTalk mobile.js

---

## 文件结构

| 文件 | 改动类型 | 职责 |
|------|----------|------|
| `src/public/mobile.js` | 修改 | 1. 新增统一消息处理器<br>2. 改造追问按钮发送 postMessage<br>3. 改造两个处理方法支持 `show_in_history` |
| `src/skills/travel_route/templates/html/travel_itinerary_card.html` | 修改 | 按钮使用 postMessage 示例 |

---

### Task 1: 新增统一消息处理器

**Files:**
- Modify: `src/public/mobile.js:2540-2560`

- [ ] **Step 1: 扩展现有的 message 监听器，支持统一消息格式**

找到现有的 `window.addEventListener('message', ...)` 代码块（约第 2544 行），扩展为支持统一消息格式：

```javascript
// 统一消息处理器：处理所有按钮消息（模板内按钮 + 追问栏按钮）
window.addEventListener('message', (event) => {
  try {
    const data = event.data;
    if (!data || data.type !== 'gxy_card_action') return;

    const app = window.GuiXiaoYangMobileApp;
    if (!app) return;

    // 根据是否有 action_key 决定调用哪个方法
    if (data.action_key) {
      // 执行动作
      app.handleAssistantAction(null, data);
    } else {
      // 发送追问
      app.handleFollowupSuggestion(data, null);
    }
  } catch (e) {
    console.error('handleCardActionMessage error:', e);
  }
});
```

- [ ] **Step 2: 验证修改后服务能正常启动**

Run: `npm start`
Expected: 服务正常启动，无语法错误

- [ ] **Step 3: Commit**

```bash
git add src/public/mobile.js
git commit -m "feat: 新增统一消息处理器 handleCardActionMessage"
```

---

### Task 2: 改造 handleAssistantAction 支持 show_in_history

**Files:**
- Modify: `src/public/mobile.js:1801-1841`

- [ ] **Step 1: 修改 handleAssistantAction 方法**

找到 `async handleAssistantAction(action = {}, button = null)` 方法（约第 1801 行），修改为：

```javascript
async handleAssistantAction(action = {}, button = null) {
  if (!action?.action_key || this.state.sending) return;
  const conversation = this.currentConversation();
  const originalText = button?.textContent || action.label || action.action_key;
  const showInHistory = action.show_in_history !== false;

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "处理中...";
    }

    // 根据 show_in_history 决定是否显示在对话历史中
    if (showInHistory) {
      this.addBubble("user", action.user_prompt || action.label || action.action_key);
      this.addBubble("ai", "处理中...", { pending: true });
    }

    const payload = await fetchJson("/api/chat/action", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ...action,
        user_prompt: action.user_prompt || action.label || action.action_key,
        execute_action: true,
        reenter_chat: false,
        conversation_id: conversation?.id || "",
        roleKey: this.auth.roleKey,
        channel: "mobile",
        userToken: this.auth.token,
        elderScope: this.auth.elderScope,
        terminal: this.auth.terminal,
        authLevel: this.auth.authLevel,
        userName: this.auth.userName,
        orgName: this.auth.orgName,
        presetKey: this.auth.presetKey,
      }),
    });
    this.handleRemoteResult(payload);
  } catch (err) {
    if (showInHistory) {
      this.updateLastAiBubble(`操作执行异常：${err.message}`, { error: true });
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}
```

- [ ] **Step 2: 验证修改后服务能正常启动**

Run: `npm start`
Expected: 服务正常启动，无语法错误

- [ ] **Step 3: Commit**

```bash
git add src/public/mobile.js
git commit -m "feat: handleAssistantAction 支持 show_in_history 参数"
```

---

### Task 3: 改造 handleFollowupSuggestion 支持 show_in_history

**Files:**
- Modify: `src/public/mobile.js:1877-1932`

- [ ] **Step 1: 修改 handleFollowupSuggestion 方法**

找到 `async handleFollowupSuggestion(suggestion = {}, button = null)` 方法（约第 1877 行），在开头添加 `show_in_history` 逻辑：

```javascript
async handleFollowupSuggestion(suggestion = {}, button = null) {
  const prompt = String(suggestion.user_prompt || suggestion.label || "").trim();
  if (!prompt || this.state.sending) return;
  const conversation = this.currentConversation();
  const originalText = button?.textContent || suggestion.label || prompt;
  const canExecuteAction = Boolean(suggestion.action_key && isSupportedMobileAction(suggestion));
  const showInHistory = suggestion.show_in_history !== false;

  const payloadSuggestion = { ...suggestion };
  if (!canExecuteAction && payloadSuggestion.action_key) {
    payloadSuggestion.unsupported_action_key = payloadSuggestion.action_key;
    delete payloadSuggestion.action_key;
    delete payloadSuggestion.actionKey;
  }
  if (!canExecuteAction) {
    delete payloadSuggestion.skill_key;
    delete payloadSuggestion.skillKey;
    delete payloadSuggestion.source_template_id;
    delete payloadSuggestion.next_template_id;
  }
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "处理中...";
    }

    // 根据 show_in_history 决定是否显示在对话历史中
    if (showInHistory) {
      this.addBubble("user", prompt);
      this.addBubble("ai", "处理中...", { pending: true });
    }

    const payload = await fetchJson("/api/chat/followup", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ...payloadSuggestion,
        message: prompt,
        user_prompt: prompt,
        execute_action: canExecuteAction,
        reenter_chat: !canExecuteAction,
        conversation_id: conversation?.id || "",
        roleKey: this.auth.roleKey,
        channel: "mobile",
        userToken: this.auth.token,
        elderScope: this.auth.elderScope,
        terminal: this.auth.terminal,
        authLevel: this.auth.authLevel,
        userName: this.auth.userName,
        orgName: this.auth.orgName,
        presetKey: this.auth.presetKey,
      }),
    });
    this.handleRemoteResult(payload);
  } catch (err) {
    if (showInHistory) {
      this.updateLastAiBubble(`操作执行异常：${err.message}`, { error: true });
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}
```

- [ ] **Step 2: 验证修改后服务能正常启动**

Run: `npm start`
Expected: 服务正常启动，无语法错误

- [ ] **Step 3: Commit**

```bash
git add src/public/mobile.js
git commit -m "feat: handleFollowupSuggestion 支持 show_in_history 参数"
```

---

### Task 4: 改造追问按钮发送 postMessage

**Files:**
- Modify: `src/public/mobile.js:1872-1874`

- [ ] **Step 1: 修改追问按钮点击事件**

找到 `appendFollowupSuggestions` 方法中绑定点击事件的代码（约第 1872 行）：

原代码：
```javascript
last.querySelectorAll("[data-mobile-followup]").forEach((button) => {
  button.addEventListener("click", () => this.handleFollowupSuggestion(decodeFollowup(button.dataset.mobileFollowup), button));
});
```

改为：
```javascript
last.querySelectorAll("[data-mobile-followup]").forEach((button) => {
  button.addEventListener("click", () => {
    const suggestion = decodeFollowup(button.dataset.mobileFollowup);
    // 通过 postMessage 发送统一消息格式
    window.postMessage({
      type: 'gxy_card_action',
      ...suggestion,
    }, '*');
  });
});
```

- [ ] **Step 2: 验证追问按钮点击功能正常**

测试步骤：
1. 打开移动端页面
2. 发送消息触发追问按钮
3. 点击追问按钮，验证是否正常显示对话历史

Expected: 追问按钮点击后，正常显示用户提示和 AI 回复

- [ ] **Step 3: Commit**

```bash
git add src/public/mobile.js
git commit -m "feat: 追问按钮改为发送 postMessage"
```

---

### Task 5: 模板按钮示例改造

**Files:**
- Modify: `src/skills/travel_route/templates/html/travel_itinerary_card.html`

- [ ] **Step 1: 找到模板中的按钮，改为 postMessage**

以"查看天气风险"按钮为例，修改为使用 postMessage：

```html
<button type="button" class="action" onclick="window.parent.postMessage({
  type: 'gxy_card_action',
  action_key: 'travel_route.check_weather_risk',
  user_prompt: '请结合这条旅居路线和目的地，检查近期天气风险',
  template_id: 'travel_weather_risk_card',
  intent: 'travel_route_weather',
  skill_key: 'travel_route',
  show_in_history: true,
  params: { city: '防城港' }
}, '*')">查看天气风险</button>
```

- [ ] **Step 2: Commit**

```bash
git add src/skills/travel_route/templates/html/travel_itinerary_card.html
git commit -m "feat: 模板按钮使用统一 postMessage 格式"
```

---

### Task 6: 集成测试

- [ ] **Step 1: 测试追问按钮点击**

1. 打开移动端页面 `http://localhost:5198/mobile.html`
2. 输入"养老补贴政策"
3. 点击追问按钮"查询补贴条件"
4. 验证是否正常显示对话历史和新卡片

Expected: 追问按钮正常工作，显示新的 policy_list_card

- [ ] **Step 2: 测试模板内按钮点击**

1. 打开移动端页面
2. 输入"旅居规划"
3. 点击模板内的"查看天气风险"按钮
4. 验证是否正常显示对话历史和天气风险卡片

Expected: 模板按钮正常工作，显示 travel_weather_risk_card

- [ ] **Step 3: 测试 show_in_history: false**

修改测试按钮配置，添加 `show_in_history: false`，验证是否不在对话历史中显示。

Expected: 不显示用户提示气泡，直接更新 AI 回复

---

## 自检清单

- [x] Spec coverage: 所有设计文档中的需求都有对应任务
- [x] Placeholder scan: 无 TBD/TODO/待实现内容
- [x] Type consistency: 消息格式在各任务中一致