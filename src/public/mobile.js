const screen = document.querySelector(".phone-screen");
const params = new URLSearchParams(location.search);
if (params.get("frame") === "1") document.body.classList.add("frame-preview");

const AUTH_KEYS = ["token", "userToken", "roleKey", "elderScope", "terminal", "authLevel", "userName", "orgName", "presetKey"];
const STORAGE_AUTH = "gxy_mobile_auth";
const STORAGE_HISTORY_LEGACY = "gxy_mobile_conversations";
const STORAGE_HISTORY = "gxy_mobile_conversations_v20260730_route_real";
const STORAGE_AUTO_SPEECH = "gxy_mobile_auto_speech";
const STORAGE_DEBUG_MODE = "gxy_debug_mode";
const STORAGE_FLOATING_SPEAK = "gxy_mobile_floating_speak_position";
const MAX_HISTORY = 30;
const INPUT_HISTORY_LIMIT = 40;
const BACKEND_SYNC_BASE_DELAY_MS = 5000;
const BACKEND_SYNC_MAX_BACKOFF_MS = 60000;
const BACKEND_SYNC_MAX_MESSAGES = 20;
const BACKEND_SYNC_MAX_TEXT = 800;
const VOICE_SUBMIT_COMMANDS = [
  "请发散再补充",
  "发散再补充",
  "请提交",
  "帮我提交",
  "确认提交",
  "提交一下",
  "提交吧",
  "请发送",
  "帮我发送",
  "发送一下",
  "发送吧",
  "请发出去",
  "发出去",
  "发出",
  "发送",
  "提交",
  "结束输入",
  "结束了",
  "结束",
  "好了",
  "好啦",
  "可以了",
  "说完了",
  "我说完了",
  "就这样",
  "就这些",
  "完成了",
  "完成",
  "确认",
  "确定",
  "开始发送",
  "开始提交",
  "开始吧",
  "开始",
  "OK",
  "Ok",
  "ok",
  "O了",
  "o了"
].sort((a, b) => b.length - a.length);
function isLocalSecureException(hostname = location.hostname) {
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return true;
  const isPrivateIP = /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/.test(hostname);
  return Boolean(isPrivateIP);
}

function voiceSecurityMessage() {
  if (window.isSecureContext || isLocalSecureException()) return "";
  const httpsPort = location.port === "5177" ? "5444" : location.port;
  const httpsHost = `${location.hostname}${httpsPort ? `:${httpsPort}` : ""}`;
  const httpsUrl = `https://${httpsHost}${location.pathname}${location.search}`;
  return `Microphone requires HTTPS or localhost. Please run npm run start:https and open ${httpsUrl}.`;
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function safeParseParams(datasetStr) {
  if (!datasetStr) return {};
  try { return JSON.parse(datasetStr); } catch (e) { return {}; }
}

function encodeFollowup(value = {}) {
  return encodeURIComponent(JSON.stringify(value || {}));
}

function decodeFollowup(value = "") {
  try {
    return JSON.parse(decodeURIComponent(value || ""));
  } catch {
    return {};
  }
}

const ACTION_LABELS_ZH = {
  "meal_plan.generate_weekly_plan": "生成一周计划",
  "meal_plan.adjust_for_condition": "按健康状况调整",
  "meal_plan.daily_diet": "今日三餐",
  "meal_plan.check_risk": "检查饮食风险",
  "meal_plan.shopping_list": "生成采购清单",
  "travel_route.compare_destinations": "对比目的地",
  "travel_route.check_availability": "查可订状态",
  "travel_route.calculate_budget": "测算旅居预算",
  "travel_route.check_weather_risk": "查看天气风险",
  "travel_route.check_accessibility": "查看适老设施",
  "travel_route.check_policy_subsidy": "查询政策补贴",
  "travel_route.explain_safety": "查看安全提示",
  "travel_route.replan": "重新规划路线",
  "travel_route.request_manual_review": "人工确认",
  "travel_route.book": "立即预定",
  "travel_route.book_now": "预定旅居",
  "travel_route.view": "查看路线",
  "health_risk_warning.refresh_signals": "重新读取信号",
  "health_risk_warning.view_rule_detail": "查看规则命中",
  "health_risk_warning.request_manual_review": "请求人工复核",
  "health_risk_warning.fill_elder_info": "补充老人信息",
  "health_risk_warning.fill_remote_info": "补充远程体检",
  "health_risk_warning.view_warning": "查看预警",
  "health_risk_warning.view_report": "查看总评",
  "health_risk_warning.view_advice": "查看调理建议",
  "find_service.recommend": "智能推荐",
  "find_service.catalog": "全部服务",
  "find_service.list_workers": "找护理人员",
  "find_service.list_orgs": "看养老机构",
  "find_service.detail_service": "查看服务详情",
  "find_service.detail_order": "查看服务订单",
  "dispatch_manage.list": "派单列表",
  "dispatch_manage.work_order": "查看工单",
  "dispatch_manage.status": "查看进度",
  "nearby_resource.all": "全部资源",
  "nearby_resource.medical": "只看医疗",
  "nearby_resource.food": "周边餐馆",
  "nearby_resource.leisure": "好玩的地方",
  "nearby_resource.navigate": "导航",
  "nearby_resource.favorite": "收藏",
  "nearby_resource.unfavorite": "取消收藏",
  "sos.call_120": "立即拨打120",
  "sos.notify_family": "通知家属"
};

function isRawActionKeyText(value = "") {
  return /^[a-z][a-z0-9_]*\.[a-z0-9_.-]+$/i.test(String(value || "").trim());
}

function inferActionLabel(actionKey = "") {
  const suffix = String(actionKey || "").split(".").filter(Boolean).pop() || "";
  if (!suffix) return "继续处理";
  if (/adjust|condition|chronic/i.test(suffix)) return "按健康状况调整";
  if (/weekly|generate.*plan|plan/i.test(suffix)) return "生成计划";
  if (/daily|diet|meal/i.test(suffix)) return "查看饮食建议";
  if (/risk|warning/i.test(suffix)) return "查看风险提示";
  if (/refresh|reload/i.test(suffix)) return "重新读取";
  if (/detail|view|explain/i.test(suffix)) return "查看详情";
  if (/list|catalog|all/i.test(suffix)) return "查看列表";
  if (/status|progress/i.test(suffix)) return "查看进度";
  if (/recommend/i.test(suffix)) return "智能推荐";
  if (/compare/i.test(suffix)) return "对比查看";
  if (/availability|available/i.test(suffix)) return "查可订状态";
  if (/budget|price|cost/i.test(suffix)) return "测算预算";
  if (/navigate|map/i.test(suffix)) return "导航";
  if (/book|order/i.test(suffix)) return "预定/下单";
  if (/manual|review/i.test(suffix)) return "人工确认";
  return "继续处理";
}

function localizeActionItem(item = {}) {
  if (!item || typeof item !== "object") return item;
  const actionKey = String(item.action_key || item.actionKey || item.key || "").trim();
  const rawLabel = visibleActionText(item.label || item.text || item.title || item.name || "");
  const label = ACTION_LABELS_ZH[actionKey] || (!isRawActionKeyText(rawLabel) && rawLabel) || inferActionLabel(actionKey);
  const rawPrompt = visibleActionText(item.user_prompt || item.prompt || "");
  const userPrompt = rawPrompt && !isRawActionKeyText(rawPrompt) ? rawPrompt : label;
  return {
    ...item,
    ...(actionKey ? { action_key: actionKey } : {}),
    label,
    user_prompt: userPrompt
  };
}

function readAuth() {
  const stored = safeJson(localStorage.getItem(STORAGE_AUTH), {});
  const fromUrl = {};
  for (const key of AUTH_KEYS) {
    const value = params.get(key);
    if (value) fromUrl[key] = value;
  }
  const auth = (fromUrl.token || fromUrl.userToken) ? fromUrl : { ...stored, ...fromUrl };
  if (auth.userToken && !auth.token) auth.token = auth.userToken;
  return auth;
}

function saveAuth(auth) {
  localStorage.setItem(STORAGE_AUTH, JSON.stringify(auth));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function visibleActionText(value = "") {
  return decodeBasicHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;|&#x[aA]0;/g, " ")
    .trim();
}

function initials(name = "?") {
  return String(name || "?").slice(0, 1);
}

function compactText(text = "", max = 54) {
  const value = cleanDisplayText(text).replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function looksMojibake(value = "") {
  return /[\uFFFD\u9420\u95C2\u95F8\u95F9\u6FDE\u7D31\u5A62\u9366\u5A11\u9210\u9359\u95C0\u93C8\u7EE9\u7ECE\u6D93]|\?{3,}|err\.message|\{err\.message\}/.test(String(value || ""));
}

function cleanDisplayText(value = "") {
  const text = String(value || "");
  if (!looksMojibake(text)) return text;
  const normalized = text
    .replace(/\{err\.message\}/g, "")
    .replace(/err\.message/g, "")
    .replace(/\?{3,}/g, "")
    .replace(/[\uFFFD\u9420\u95C2\u95F8\u95F9\u6FDE\u7D31\u5A62\u9366\u5A11\u9210\u9359\u95C0\u93C8\u7EE9\u7ECE\u6D93][^\n]{0,48}/g, "")
    .trim();
  return normalized || "";
}

const TEXT_FALLBACKS = [
  [/token|SSO/i, "业务系统 SSO token"],
  [/roleKey/i, "roleKey，如 elder_family"],
  [/elderScope/i, "elderScope"],
  [/Failed to fetch/i, "本地服务接口不可达或请求被中断"],
];

function fallbackCleanText(value = "") {
  const text = String(value || "");
  if (!looksMojibake(text)) return text;
  for (const [pattern, fallback] of TEXT_FALLBACKS) {
    if (pattern.test(text)) return fallback;
  }
  return cleanDisplayText(text);
}

function serializeConversationForSync(conversation = {}, auth = {}) {
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const compactMessages = messages
    .slice(-BACKEND_SYNC_MAX_MESSAGES)
    .map(serializeMessageForSync)
    .filter((message) => message.content || message.type);
  return {
    id: conversation.id,
    title: compactText(conversation.title || conversation.latestQuestion || "新对话", 80),
    messages: compactMessages,
    status: compactText(conversation.status || "", 24),
    favorite: Boolean(conversation.favorite),
    latestQuestion: compactText(conversation.latestQuestion || "", BACKEND_SYNC_MAX_TEXT),
    latestAnswer: compactText(conversation.latestAnswer || "", BACKEND_SYNC_MAX_TEXT),
    created: conversation.created || conversation.createdAt || null,
    updatedAt: conversation.updatedAt || null,
    roleKey: auth?.roleKey || "",
    userToken: auth?.userToken || "",
    presetKey: auth?.presetKey || "",
  };
}

function serializeMessageForSync(message = {}) {
  const content = message.type === "image"
    ? `[图片] ${message.fileName || message.status || "图片输入"}`
    : message.content || "";
  const meta = message.meta || {};
  return {
    role: message.role === "user" ? "user" : "ai",
    type: message.type || "text",
    content: compactText(content, BACKEND_SYNC_MAX_TEXT),
    markdown: Boolean(message.markdown),
    agent_key: message.agent_key || meta.agent_key || meta.skill_key || "",
    template_id: meta.template_id || "",
    at: message.at || null,
  };
}

function scrubVisibleMojibake(root = screen) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (looksMojibake(node.nodeValue)) node.nodeValue = fallbackCleanText(node.nodeValue);
  }
  root.querySelectorAll?.("[placeholder], [aria-label], [title], input[value]").forEach((el) => {
    for (const attr of ["placeholder", "aria-label", "title", "value"]) {
      if (el.hasAttribute?.(attr)) {
        const value = el.getAttribute(attr);
        if (looksMojibake(value)) el.setAttribute(attr, fallbackCleanText(value));
      }
    }
  });
}

function normalizeConversations(items = []) {
  const conversations = Array.isArray(items) ? items : [];
  return conversations.map((conversation) => {
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    const cleanedMessages = messages
      .filter((message) => !(looksMojibake(message?.content || "") && !message?.html))
      .map((message) => ({
        ...message,
        content: cleanDisplayText(message.content || ""),
        html: sanitizeHtmlCard(message.html || ""),
      }));
    return {
      ...conversation,
      title: cleanDisplayText(conversation.title || "New chat") || "New chat",
      status: cleanDisplayText(conversation.status || "") || "ready",
      latestQuestion: cleanDisplayText(conversation.latestQuestion || ""),
      latestAnswer: cleanDisplayText(conversation.latestAnswer || ""),
      messages: cleanedMessages,
    };
  }).filter((conversation) => conversation.messages.length > 0);
}

function hasRenderableAssistantState(conversation = {}) {
  return (conversation.messages || []).some((message) => (
    message?.role === "ai"
    && (sanitizeHtmlCard(message.html || "") || message.meta?.skill_key || message.meta?.template_id)
  ));
}

function renderPendingBubbleContent(text = "") {
  return `<span class="pending-run-icon" aria-hidden="true"></span><span class="pending-text">${escapeHtml(text)}</span><span class="pending-dots" aria-hidden="true"><i></i><i></i><i></i></span>`;
}

function sanitizeAssistantText(text = "") {
  return String(text || "")
    .replace(/\[SECURITY_BOUNDARY_START\][\s\S]*?\[SECURITY_BOUNDARY_END\]/gi, "")
    .replace(/IMPORTANT:\s*Content from tool outputs[\s\S]*?(?=\n{2,}|$)/gi, "")
    .replace(/Tool Use Formatting[\s\S]*?Final Output Rules/gi, "")
    .replace(/Technical tags are prohibited from being displayed to users\./gi, "")
    .replace(/<\/?(?:tool|tools|name|description|arguments|tool_use)>/gi, "")
    .replace(/```(?:json)?\s*{\s*"actions"\s*:\s*[\s\S]*?}\s*```/gi, "")
    .replace(/(?:^|\n)\s*(?:即将执行动作|执行动作)\s*[:：]?\s*[\s\S]*?(?=\n{2,}|$)/g, "")
    .replace(/(?:^|\n)\s*(?:---\s*)?(?:\*\*)?后续(?:您)?可以继续(?:追问|询问)?(?:\*\*)?\s*[:：]?\s*[\s\S]*?(?=\n{2,}(?!\s*(?:\d+\.|[-*]\s))|$)/g, "")
    .replace(/^\s*(?:即将执行动作|执行动作)\s*[:：]?.*$/gmi, "")
    .replace(/(?:^|\n)\s*(?:---\s*)?(?:\*\*)?后续(?:您)?可以继续(?:追问|询问)?(?:\*\*)?\s*[:：]?[\s\S]*$/g, "")
    .replace(/^\s*→?\s*action_key\s*[:：]\s*[a-zA-Z0-9_.-]+\s*$/gmi, "")
    .replace(/<task-result>[\s\S]*?<\/task-result>/gi, "")
    .replace(/<file>[\s\S]*?<\/file>/gi, "")
    .replace(/<markdown-custom-process[^>]*>[\s\S]*?<\/markdown-custom-process>/gi, "")
    .replace(/\btask-result\b/gi, "")
    .replace(/^\s*(?:Skill|Intent|Template|Agent|Confidence)\s*\n/gim, "")
    .replace(/^\s*Skill\s*[a-zA-Z0-9_\-]+\s*$/gim, "")
    .replace(/^\s*Intent\s*[A-Z_]+\s*$/gim, "")
    .replace(/^\s*Template\s*[a-zA-Z0-9_.\-]+\s*$/gim, "")
    .replace(/^\s*Agent\s*\d+\s*$/gim, "")
    .replace(/^\s*Confidence\s*[\d.]+\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function roleTitle(user = {}, auth = {}) {
  return user.role_name || auth.roleName || auth.roleKey || "老人/瀹跺睘";
}

function canShowPrivate(profile = {}) {
  const terminal = profile.user?.terminal || "";
  return ["G", "B", "Admin"].includes(terminal);
}

function mobileIconSvg(name) {
  const icons = {
    home: `<svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>`,
    bot: `<svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="12" rx="4"/><path d="M12 3v4"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M9 17h6"/></svg>`,
    messages: `<svg viewBox="0 0 24 24"><path d="M4 5h16v11H8l-4 4V5Z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>`,
    profile: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
    mic: `<svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M8 21h8"/></svg>`,
    image: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="m21 15-4.5-4.5L10 17l-2.5-2.5L3 19"/></svg>`,
    send: `<svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`,
    history: `<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6"/><path d="M12 7v5l3 2"/></svg>`,
    star: `<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>`,
    speaker: `<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a8 8 0 0 1 0 12"/></svg>`,
    plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15 6.7"/><path d="M3 12a9 9 0 0 1 15-6.7"/><path d="M18 3v5h-5"/><path d="M6 21v-5h5"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    open: `<svg viewBox="0 0 24 24"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>`,
    search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`
  };
  return icons[name] || "";
}

function renderMarkdown(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  const html = [];
  let listOpen = false;
  let table = [];
  const inline = (value = "") => escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
  const closeList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.map((line) => line.split("|").map((cell) => cell.trim()).filter(Boolean));
    if (rows.length > 1) {
      const [head, , ...body] = rows;
      html.push("<table><thead><tr>");
      html.push(head.map((cell) => `<th>${inline(cell)}</th>`).join(""));
      html.push("</tr></thead><tbody>");
      html.push(body.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join(""));
      html.push("</tbody></table>");
    }
    table = [];
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      flushTable();
      continue;
    }
    if (/^\|.+\|$/.test(line)) {
      closeList();
      table.push(line);
      continue;
    }
    flushTable();
    if (/^#{1,4}\s+/.test(line)) {
      closeList();
      const level = Math.min(4, line.match(/^#+/)[0].length);
      html.push(`<h${level}>${inline(line.replace(/^#{1,4}\s+/, ""))}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^>\s+/.test(line)) {
      closeList();
      html.push(`<blockquote>${inline(line.replace(/^>\s+/, ""))}</blockquote>`);
      continue;
    }
    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  flushTable();
  return html.join("");
}

function renderSafeHtmlFallback(result = {}) {
  const html = String(result.rendered_html || result.html_fallback || "");
  return sanitizeHtmlCard(html);
}

function sanitizeHtmlCard(html = "") {
  html = String(html || "");
  if (html.trimStart().startsWith("&lt;") && html.includes("gxy-html-fallback")) {
    html = decodeBasicHtmlEntities(html);
  }
  if (!html.includes("gxy-html-fallback") || !html.includes("data-renderer=")) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
}

function recoverHtmlCardFromSource(value = "") {
  let html = String(value || "");
  if (html.includes("&lt;")) html = decodeBasicHtmlEntities(html);
  const safeCard = sanitizeHtmlCard(html);
  if (safeCard) return safeCard;
  if (!html.includes("data-template-id") || !/<(?:!doctype|html|article)\b/i.test(html)) return "";
  const pageHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
  return [
    '<article class="gxy-html-fallback" data-renderer="template-card-renderer">',
    '<style>',
    '.gxy-html-fallback{padding:0;background:transparent;border:0;width:100%;max-width:100%;overflow:hidden;}',
    '.gxy-template-card-frame{display:block;width:100%;max-width:100%;height:860px;border:0;border-radius:10px;background:#fff;overflow:hidden;}',
    '</style>',
    `<iframe class="gxy-template-card-frame" title="template-card" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" scrolling="no" srcdoc="${escapeHtml(pageHtml)}"></iframe>`,
    '</article>',
  ].join('');
}

function decodeBasicHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function isSupportedMobileAction(action = {}) {
  const key = String(action.action_key || "");
  if (!key) return false;
  const explicitServerActions = new Set([
    "travel_route.compare_destinations",
    "travel_route.check_availability",
    "travel_route.calculate_budget",
  ]);
  if (explicitServerActions.has(key)) return true;
  return key.startsWith("meal_plan.")
    || key.startsWith("travel_route.")
    || key.startsWith("health_risk_warning.")
    || key.startsWith("find_service.")
    || key.startsWith("dispatch_manage.")
    || key.startsWith("nearby_resource.")
    || key === "sos.call_120"
    || key === "sos.notify_family";
}

function sanitizePhoneNumber(value = "") {
  return String(value || "").replace(/[^\d+]/g, "").trim();
}

function isLikelyDialCapableDevice() {
  const ua = navigator.userAgent || "";
  return Boolean(
    window.ReactNativeWebView
    || window.webkit?.messageHandlers
    || /android|iphone|ipod|ipad|windows phone|mobile/i.test(ua)
  );
}

function isSosPhoneAction(action = {}) {
  const key = String(action.action_key || "");
  return key === "sos.call_120" || key === "sos.notify_family";
}

function debugStatusLabel(status = "") {
  const value = String(status || "").toUpperCase();
  if (value === "FINISHED") return "完成";
  if (value === "EXECUTING" || value === "PROCESSING") return "执行中";
  if (value === "NO_MATCH") return "未命中";
  if (value === "FAILED" || value === "ERROR") return "失败";
  return status || "未知";
}

function debugScoreLabel(score) {
  if (score == null || score === "") return "未返回";
  const value = Number(score);
  if (!Number.isFinite(value)) return String(score);
  const level = value >= 0.75 ? "高相关" : value >= 0.55 ? "中相关" : "低相关";
  return `${level} ${value.toFixed(3)}`;
}

function debugTraceLabel(step = "") {
  const labels = {
    login_context: "身份上下文",
    remote_agent: "远端智能体",
    event_parse: "事件解析",
    intent_map: "意图映射",
    template_render: "模板渲染",
    tab_focus: "标签聚焦",
    kb_pre_retrieve: "知识预检索",
    yz365_check_detail: "云诊数据查询",
    health_runtime_injection: "健康数据注入"
  };
  return labels[step] || step || "未知步骤";
}

function parseVoiceSubmitCommand(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return { shouldSubmit: false, text: "" };
  const normalized = raw.replace(/[，。！？；、,.!?;：:\s]+$/g, "").trim();
  for (const command of VOICE_SUBMIT_COMMANDS) {
    if (normalized === command) return { shouldSubmit: true, text: "" };
    if (!normalized.endsWith(command)) continue;
    const stripped = normalized.slice(0, -command.length).replace(/[，。！？；、,.!?;：:\s]+$/g, "").trim();
    if (stripped) return { shouldSubmit: true, text: stripped };
  }
  return { shouldSubmit: false, text: raw };
}

async function fetchJson(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    const reason = err?.message || "network_error";
    throw new Error(`本地服务接口不可达或请求被中断：${reason}`);
  }
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      const preview = text.slice(0, 120).replace(/\s+/g, " ");
      throw new Error(`接口返回非 JSON（HTTP ${res.status}）：${preview || "空响应"}`);
    }
  }
  if (!res.ok && !body?.ok) {
    const err = new Error(body?.message || body?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = body?.error || '';
    throw err;
  }
  return body || {};
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

function audioBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("file read failed"));
    reader.readAsDataURL(blob);
  });
}

function preferredAudioMimeType() {
  const candidates = ["audio/ogg;codecs=opus", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/wav"];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

function audioFormatFromMime(mimeType = "") {
  if (mimeType.includes("ogg")) return "ogg-opus";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function encodePcm16Wav(samples, sampleRate = 16000) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);
  let offset = 44;
  for (const sample of samples) {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

function downsampleBuffer(buffer, sourceRate, targetRate = 16000) {
  if (sourceRate === targetRate) return buffer;
  const ratio = sourceRate / targetRate;
  const length = Math.round(buffer.length / ratio);
  const result = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(buffer.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += buffer[cursor];
    result[index] = sum / Math.max(1, end - start);
  }
  return result;
}

async function recordWavDataUrl(stream, durationMs = 6000) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw new Error("当前浏览器不支持 WAV 录音采集");
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let total = 0;
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    total += input.length;
  };
  source.connect(processor);
  processor.connect(context.destination);
  await new Promise((resolve) => window.setTimeout(resolve, durationMs));
  processor.disconnect();
  source.disconnect();
  await context.close?.();
  if (!total) throw new Error("未录到有效语音");
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  const rms = Math.sqrt(merged.reduce((sum, sample) => sum + sample * sample, 0) / merged.length);
  if (rms < 0.001) throw new Error("No clear voice detected. Please move closer to the microphone and try again.");
  const samples = downsampleBuffer(merged, context.sampleRate, 16000);
  const blob = encodePcm16Wav(samples, 16000);
  return audioBlobToDataUrl(blob);
}

class MobileApp {
  constructor() {
    this.auth = readAuth();
    this.state = {
      tab: "home",
      bootstrap: null,
      config: { showTemplatePanel: true, devSsoPresets: [] },
      conversations: normalizeConversations(safeJson(localStorage.getItem(STORAGE_HISTORY), [])),
      currentConversationId: null,
      latestResult: null,
      latestAnswer: "",
      recognizing: false,
      sending: false,
      pendingQueue: [],
      inputHistory: [],
      inputHistoryIndex: -1,
      templateTabs: [],
      activeTemplateKey: "",
      health: null,
      autoSpeech: localStorage.getItem(STORAGE_AUTO_SPEECH) === "true",
      debugEnabled: localStorage.getItem(STORAGE_DEBUG_MODE) === "true"
    };
    this.currentSpeechUtterance = null;
    this._syncTimeout = null;
    this._syncInFlight = false;
    this._syncDirty = false;
    this._syncFailureCount = 0;
    this._syncDisabledUntil = 0;
    this._lastSyncSignature = "";
    // 安全处理：清除 URL 上的敏感参数
    this._sanitizeUrl();
  }

  /**
   * 清除 URL 上的敏感参数，防止泄露
   */
  _sanitizeUrl() {
    const url = new URL(window.location.href);
    const sensitiveParams = ["token", "userToken", "userName", "presetKey", "authLevel", "elderScope"];
    let changed = false;
    for (const param of sensitiveParams) {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        changed = true;
      }
    }
    if (changed) {
      // 使用 replaceState 替换当前历史记录，不增加新记录
      window.history.replaceState({}, "", url.toString());
    }
  }

  async start() {
    this.state.config = await fetchJson("/api/client-config").catch(() => this.state.config);
    if (localStorage.getItem(STORAGE_DEBUG_MODE) == null) {
      this.state.debugEnabled = this.state.config.production !== true && this.state.config.showTemplatePanel !== false;
    }
    if (!this.auth.token && !this.auth.roleKey) {
      // 无真实 SSO 用户时，尝试自动使用默认模拟用户（开发/测试环境）
      const devPresets = (this.state.config && this.state.config.devSsoPresets) || [];
      const defaultPreset = devPresets.find((p) => p.key === "c_family") || devPresets[0];
      if (defaultPreset && this.state.config.production !== true) {
        this.auth = {
          token: defaultPreset.token,
          userToken: defaultPreset.token,
          roleKey: defaultPreset.roleKey,
          elderScope: defaultPreset.elderScope || "elder_unbound",
          terminal: defaultPreset.terminal || "H5",
          authLevel: defaultPreset.authLevel || "mock",
          userName: defaultPreset.userName || "",
          orgName: defaultPreset.orgName || "",
          presetKey: defaultPreset.key || "",
        };
        saveAuth(this.auth);
      } else {
        this.renderLogin();
        return;
      }
    }
    // 启动时获取用户位置（异步，不阻塞 UI），定位完成后触发天气加载
    this._initLocation().then(() => this._loadWeatherAsync()).catch(() => this._loadWeatherAsync());
    try {
      await this.loadBootstrap();
    } catch (e) {
      console.error("[Mobile] loadBootstrap failed, rendering shell anyway:", e);
      this.state.bootstrap = this.state.bootstrap || { messages: [], todos: [], orders: [], workOrders: [] };
    }
    // 如果本地没有对话历史，则从后端加载
    if (this.state.conversations.length === 0) {
      let restoredFromBackend = false;
      try { restoredFromBackend = await this._loadConversationsFromBackend(); } catch (e) { console.error("[Mobile] loadConversations failed:", e); }
      if (restoredFromBackend) this.startNewConversation({ render: false });
    }
    this.renderShell();
    this.checkHealth();
    // 退出或关闭时同步
    window.addEventListener("beforeunload", () => this._syncToBackend(true));
    window.addEventListener("pagehide", () => this._syncToBackend(true));
  }

  async _initLocation() {
    if (!window.locationService) return;
    try {
      this.state.location = await window.locationService.detect();
      console.log("[Mobile] location:", this.state.location);
    } catch (e) {
      console.warn("[Mobile] location detect failed:", e);
    }
  }

  async _loadWeatherAsync() {
    // 先尝试读缓存（30分钟有效期）
    const CACHE_KEY = "gxy_weather_cache";
    try {
      const cached = safeJson(localStorage.getItem(CACHE_KEY), null);
      if (cached && cached.timestamp && Date.now() - cached.timestamp < 30 * 60 * 1000) {
        this._updateWeatherDisplay(cached.text);
        return;
      }
    } catch (e) { /* ignore */ }

    // 等定位完成后再请求天气
    const location = this.state.location || {};
    const city = location.city || location.province || "";
    if (!city) {
      this._updateWeatherDisplay("\u6674\uff0c\u9002\u5408\u6563\u6b65");
      return;
    }

    try {
      const resp = await fetch(`/api/weather?city=${encodeURIComponent(city)}`);
      const data = await resp.json();
      let weatherText = "";
      if (data.ok && data.weather) {
        const w = data.weather;
        const casts = w.casts || [];
        const today = casts[0] || {};
        const desc = today.weather || w.weather || "\u6674";
        const temp = today.degree || today.temperature || w.temperature || "";
        weatherText = `${desc}${temp ? "\uff0c" + temp + "\u00b0C" : ""}\uff0c\u9002\u5408\u6563\u6b65`;
      } else {
        weatherText = "\u6674\uff0c\u9002\u5408\u6563\u6b65";
      }
      this._updateWeatherDisplay(weatherText);
      // 写缓存
      localStorage.setItem(CACHE_KEY, JSON.stringify({ text: weatherText, timestamp: Date.now() }));
    } catch (e) {
      console.warn("[Mobile] weather load failed:", e);
      this._updateWeatherDisplay("\u6674\uff0c\u9002\u5408\u6563\u6b65");
    }
  }

  _updateWeatherDisplay(text) {
    const el = screen.querySelector(".weather-info");
    if (el) el.textContent = text;
  }

  async _loadConversationsFromBackend() {
    try {
      const params = new URLSearchParams({
        roleKey: this.auth?.roleKey || "",
        userToken: this.auth?.userToken || "",
        limit: "50",
      });
      const res = await fetch(`/api/conversation/list?${params}`);
      const data = await res.json();
      if (data.ok && data.conversations?.length > 0) {
        const loaded = data.conversations.map((c) => {
          try { return JSON.parse(c.messages); } catch { return null; }
        }).filter(Boolean);
        const restored = normalizeConversations(loaded).filter(hasRenderableAssistantState);
        if (restored.length > 0) {
          this.state.conversations = restored;
          return true;
        }
      }
    } catch (e) {
      console.warn("[Mobile][ConversationHistory] 候车加载失败:", e.message);
    }
    return false;
  }

  renderLogin() {
    const presets = this.state.config.devSsoPresets || [];
    const nonAdmin = presets.filter((p) => p.roleKey !== "system_admin" && p.role_key !== "system_admin");
    const randomPreset = nonAdmin.length > 0 ? nonAdmin[Math.floor(Math.random() * nonAdmin.length)] : presets[0];
    const selectedKey = randomPreset?.key || "";
    const buttons = presets.map((preset) => {
      const isActive = preset.key === selectedKey;
      return `
      <button type="button" class="preset-button ${isActive ? "selected" : ""}" data-preset-key="${escapeHtml(preset.key)}">
        <strong>${escapeHtml(preset.userName || preset.label)}</strong>
        <span>${escapeHtml(preset.label)} / ${escapeHtml(preset.orgName || "")}</span>
      </button>`;
    }).join("");
    screen.classList.remove("mobile-app");
    screen.innerHTML = `
      <section class="login-page">
        <div class="login-card">
          <h1>&#26690;&#23567;&#20859;&#31227;&#21160;&#31471;</h1>
          <p>&#35831;&#36873;&#25321;&#32852;&#35843;&#36523;&#20221;&#36827;&#20837;&#12290;&#29983;&#20135;&#29615;&#22659;&#30001;&#19994;&#21153;&#31995;&#32479; SSO &#27880;&#20837;&#36523;&#20221; token&#12290;</p>
          ${buttons || `<p class="muted">&#26410;&#35835;&#21462;&#21040;&#32852;&#35843;&#36523;&#20221;&#65292;&#35831;&#20174; PC &#31471;&#24102;&#20837; SSO &#21442;&#25968;&#25171;&#24320;&#12290;</p>`}
          <form class="mobile-login-form" id="manualLoginForm">
            <input id="manualToken" placeholder="&#19994;&#21153;&#31995;&#32479; SSO token" />
            <input id="manualRoleKey" placeholder="roleKey&#65292;&#22914; elder_family" value="elder_family" />
            <input id="manualElderScope" placeholder="elderScope" value="elder_huang_xiuying" />
            <button type="submit">&#20351;&#29992; SSO &#21442;&#25968;&#36827;&#20837;</button>
          </form>
        </div>
      </section>
    `;
    screen.querySelectorAll("[data-preset-key]").forEach((button) => {
      button.addEventListener("click", async () => {
        const body = await fetchJson("/api/sso/dev-login", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ presetKey: button.dataset.presetKey })
        });
        this.auth = this.authFromLogin(body);
        saveAuth(this.auth);
        await this.start();
      });
    });
    screen.querySelector("#manualLoginForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const token = screen.querySelector("#manualToken").value.trim();
      if (!token) return;
      this.auth = {
        token,
        userToken: token,
        roleKey: screen.querySelector("#manualRoleKey").value.trim() || "elder_family",
        elderScope: screen.querySelector("#manualElderScope").value.trim() || "elder_unbound",
        terminal: "H5",
        authLevel: "sso",
        presetKey: "manual_sso"
      };
      saveAuth(this.auth);
      await this.start();
    });
  }

  authFromLogin(body = {}) {
    return {
      token: body.userToken || body.token || "",
      userToken: body.userToken || body.token || "",
      roleKey: body.roleKey || body.role_key || "elder_family",
      elderScope: body.elderScope || body.elder_scope || "elder_unbound",
      terminal: body.terminal || "H5",
      authLevel: body.authLevel || body.auth_level || "sso",
      userName: body.userName || body.user_name || "",
      orgName: body.orgName || body.org_name || "",
      presetKey: body.presetKey || body.preset_key || "",
    };
  }

  async loadBootstrap() {
    const params = new URLSearchParams({
      roleKey: this.auth.roleKey || "",
      userToken: this.auth.userToken || this.auth.token || "",
      elderScope: this.auth.elderScope || "",
      terminal: this.auth.terminal || "H5",
      authLevel: this.auth.authLevel || "sso",
      presetKey: this.auth.presetKey || "",
      userName: this.auth.userName || "",
      orgName: this.auth.orgName || "",
    });
    const payload = await fetchJson(`/api/mobile-bootstrap?${params}`);
    this.state.bootstrap = payload;
    // 从 bootstrap profile 提取 elder_id，与真实用户数据结构对齐
    const elders = payload?.profile?.elders;
    if (Array.isArray(elders) && elders.length > 0 && elders[0]?.elder_id) {
      this.auth.elderId = elders[0].elder_id;
    } else if (this.auth.elderScope && this.auth.elderScope.startsWith('elder_')) {
      this.auth.elderId = this.auth.elderScope;
    }
    return payload;
  }

  _getGreeting() {
    const hour = new Date().getHours();
    if (hour < 11) return "\u65e9\u4e0a\u597d";
    if (hour < 14) return "\u4e2d\u5348\u597d";
    if (hour < 18) return "\u4e0b\u5348\u597d";
    return "\u665a\u4e0a\u597d";
  }

  renderShell() {
    const { profile } = this.state.bootstrap || {};
    const userName = profile?.user?.real_name || "\u7528\u6237";
    const greeting = this._getGreeting();
    const weatherText = "\u52a0\u8f7d\u4e2d...";
    screen.classList.add("mobile-app");
    screen.innerHTML = `
      <header class="mobile-header">
        <div class="header-top">
          <span class="user-name">&#26690;&#23567;&#20859;</span>
        </div>
        <div class="greeting-text">${greeting}&#65292;${escapeHtml(userName)}</div>
        <div class="weather-info">${weatherText}</div>
      </header>
      <main class="page-stack">
        <section class="page active" data-page="home"></section>
        <section class="page" data-page="chat"></section>
        <section class="page" data-page="service"></section>
        <section class="page" data-page="profile"></section>
      </main>
      <button type="button" id="floatingSpeakButton" class="floating-speak-button" aria-label="&#35821;&#38899;&#25773;&#25253;">${mobileIconSvg("speaker")}</button>
      <div id="mobileModalHost"></div>
    `;
    screen.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => this.switchTab(button.dataset.tab)));
    this.bindFloatingSpeakButton();
    this.ensureConversation({ initial: true });
    this.renderHome();
    this.renderChat();
    this.renderService();
    this.renderProfile();
    this.switchTab(this.state.tab);
    this.applyDebugMode();
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        this.toggleDevDrawer();
      } else if (e.ctrlKey && (e.key === "x" || e.key === "X")) {
        e.preventDefault();
        this.toggleDebugSidePanel();
      } else if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        this.toggleHistorySearchPanel();
      }
    });
  }

  bindFloatingSpeakButton() {
    const button = screen.querySelector("#floatingSpeakButton");
    if (!button) return;
    const saved = safeJson(localStorage.getItem(STORAGE_FLOATING_SPEAK), null);
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      button.style.left = `${saved.left}px`;
      button.style.top = `${saved.top}px`;
      button.style.right = "auto";
      button.style.bottom = "auto";
    }
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    button.addEventListener("pointerdown", (event) => {
      dragging = true;
      moved = false;
      const parent = screen.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left - parent.left;
      startTop = rect.top - parent.top;
      button.classList.add("dragging");
      button.setPointerCapture?.(event.pointerId);
    });
    button.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const parent = screen.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      const nextLeft = clamp(startLeft + event.clientX - startX, 8, parent.width - rect.width - 8);
      const nextTop = clamp(startTop + event.clientY - startY, 58, parent.height - rect.height - 78);
      if (Math.abs(nextLeft - startLeft) > 3 || Math.abs(nextTop - startTop) > 3) moved = true;
      button.style.left = `${nextLeft}px`;
      button.style.top = `${nextTop}px`;
      button.style.right = "auto";
      button.style.bottom = "auto";
      event.preventDefault();
    });
    const finishDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      button.classList.remove("dragging");
      button.releasePointerCapture?.(event.pointerId);
      if (moved) {
        localStorage.setItem(STORAGE_FLOATING_SPEAK, JSON.stringify({
          left: Number.parseFloat(button.style.left) || 0,
          top: Number.parseFloat(button.style.top) || 0
        }));
      }
      window.setTimeout(() => { moved = false; }, 0);
    };
    button.addEventListener("pointerup", finishDrag);
    button.addEventListener("pointercancel", finishDrag);
    button.addEventListener("click", (event) => {
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this.speakLatestAnswer();
    });
    // 双击重置位置。
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      localStorage.removeItem(STORAGE_FLOATING_SPEAK);
      button.style.left = "";
      button.style.top = "";
      button.style.right = "";
      button.style.bottom = "";
      moved = false;
    });
  }

  tabButton(tab, label, icon, active = false) {
    const emojiIcons = { home: "馃彔", service: "馃摝", profile: "馃懁" };
    const emoji = emojiIcons[tab] || "";
    return `<button type="button" class="tab-button ${active ? "active" : ""}" data-tab="${tab}"><span class="tab-icon">${emoji}</span><span class="tab-text">${label}</span></button>`;
  }

  switchTab(tab) {
    this.state.tab = tab;
    screen.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.dataset.page === tab));
    screen.querySelectorAll(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    const header = screen.querySelector(".mobile-header");
    if (header) header.style.display = tab === "chat" ? "none" : "";
  }

  applyDebugMode() {
    document.body.classList.toggle("debug-mode", this.state.debugEnabled);
    screen.classList.toggle("debug-mode", this.state.debugEnabled);
    screen.classList.toggle("production-mode", !this.state.debugEnabled);
    screen.querySelectorAll(".debug-only").forEach((node) => {
      node.classList.toggle("production-hidden", !this.state.debugEnabled);
      node.setAttribute("aria-hidden", String(!this.state.debugEnabled));
    });
  }

  toggleDevDrawer() {
    let drawer = document.querySelector(".dev-drawer");
    const isOpen = drawer && drawer.classList.contains("open");
    if (isOpen) {
      this.closeDevDrawer();
      return;
    }
    this.renderDevDrawer();
    drawer = document.querySelector(".dev-drawer");
    const overlay = document.querySelector(".dev-drawer-overlay");
    if (drawer) drawer.classList.add("open");
    if (overlay) overlay.classList.add("open");
  }

  // 鈽?Ctrl+X 切换璋冩祴信息娴窗（可拖拽，不覆盖对话区）
  async toggleDebugSidePanel() {
    const existing = document.querySelector(".mobile-debug-side-panel");
    if (existing && existing.classList.contains("open")) {
      this.closeDebugSidePanel();
      return;
    }
    // 先生'修?health 信息存在（含 baseUrl / model / agentId 等）
    if (!this.state.health) {
      await this.checkHealth();
    }
    this.renderDebugSidePanel();
    const panel = document.querySelector(".mobile-debug-side-panel");
    if (panel) {
      panel.classList.add("open");
      this.bindDebugSidePanelDrag(panel);
    }
  }

  closeDebugSidePanel() {
    const panel = document.querySelector(".mobile-debug-side-panel");
    if (panel) panel.classList.remove("open");
  }

  // 调试浮窗拖拽逻辑。
  bindDebugSidePanelDrag(panel) {
    if (panel.__dragBound) return;
    panel.__dragBound = true;
    const STORAGE_POS = "gxy_mobile_debug_panel_pos";
    const saved = safeJson(localStorage.getItem(STORAGE_POS), null);
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      panel.style.left = `${saved.left}px`;
      panel.style.top = `${saved.top}px`;
      panel.style.right = "auto";
    }
    const head = panel.querySelector(".debug-side-head");
    if (!head) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    head.addEventListener("pointerdown", (event) => {
      // 点击关闭按钮不允Е发拖拽?      if (event.target.closest(".debug-side-close")) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      panel.classList.add("dragging");
      head.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    head.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const rect = panel.getBoundingClientRect();
      const nextLeft = clamp(startLeft + event.clientX - startX, 4, window.innerWidth - rect.width - 4);
      const nextTop = clamp(startTop + event.clientY - startY, 4, window.innerHeight - 40);
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
      panel.style.right = "auto";
      event.preventDefault();
    });
    const finishDrag = () => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove("dragging");
      const left = Number.parseFloat(panel.style.left);
      const top = Number.parseFloat(panel.style.top);
      if (Number.isFinite(left) && Number.isFinite(top)) {
        localStorage.setItem(STORAGE_POS, JSON.stringify({ left, top }));
      }
    };
    head.addEventListener("pointerup", finishDrag);
    head.addEventListener("pointercancel", finishDrag);
  }

  // 渲染右侧调试信息面板。
  renderDebugSidePanel() {
    let panel = document.querySelector(".mobile-debug-side-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "mobile-debug-side-panel";
      document.body.appendChild(panel);
    }

    const health = this.state.health || {};
    const platform = health.platform || {};
    const result = this.state.latestResult || {};
    const resultPlatform = result.platform || {};
    const role = result.role_context || {};

    // TOP 区：本地服务地址 / 远端地址 / 当前模型 / agentId / skill_id
    const localInfo = health.local_service || {};
    const localEndpoint = localInfo.endpoint || (localInfo.host && localInfo.port ? `${localInfo.host}:${localInfo.port}` : "-");
    const baseUrl = platform.baseUrl || resultPlatform.baseUrl || "";
    const remoteEndpoint = baseUrl ? baseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "-";
    const modelInfo = platform.model || {};
    const modelName = modelInfo.name || modelInfo.model || "-";
    const modelId = modelInfo.model || "-";
    const agentId = resultPlatform.agentId || result.target_agent_id || "-";
    const skillId = result.skill_key || "-";

    const routeItems = [
      ["最终意图", result.intent || "UNKNOWN"],
      ["目标技能", result.skill_key || "UNKNOWN"],
      ["输出模板", result.template_key || "remote_answer"],
      ["目标智能体", result.target_agent_id || resultPlatform.agentId || "未返回"],
      ["用户角色", `${role.title || result.role_key || "UNKNOWN"} / ${role.terminal || ""}`],
      ["置信度", result.confidence == null ? "未返回" : `${Math.round(Number(result.confidence) * 100)}%`],
      ["风险等级", result.risk_level || "未识别"],
      ["入口智能体", resultPlatform.agentId ? `space=${resultPlatform.spaceId || "-"} / agent=${resultPlatform.agentId}` : "未返回"]
    ];

    const trace = result.stages || [];
    const kbHits = Array.isArray(result.evidence) ? result.evidence : [];
    const warnings = result.debug?.model_error ? [`模型错误: ${result.debug.model_error}`] : [];
    if (result.debug?.knowledge_error) warnings.push(`知识库错误: ${result.debug.knowledge_error}`);
    if (result.debug?.render_status === 'error') warnings.push('渲染降级');
    const routeReason = result.route?.template_reason || result.route?.knowledge_source ? `场景=${result.route?.scene_key || '-'} / 决策=${result.route?.decision || '-'} / 知识=${result.route?.knowledge_status || '-'}` : '后端根据当前输入和模型响应完成调度。';
    const requestId = result.request_id || "无请求号";

    panel.innerHTML = `
      <div class="debug-side-head">
        <strong>调试信息</strong>
        <button type="button" class="debug-side-close" title="关闭 Ctrl+X">${mobileIconSvg("close")}</button>
      </div>
      <div class="debug-side-body">
        <div class="debug-side-request">请求号：${escapeHtml(requestId)}</div>
        <div class="debug-side-top">
          <div class="debug-side-top-item">
            <span class="label">本地服务</span>
            <span class="value" title="${escapeHtml(localEndpoint)}">${escapeHtml(localEndpoint)}</span>
          </div>
          <div class="debug-side-top-item">
            <span class="label">远端地址</span>
            <span class="value" title="${escapeHtml(remoteEndpoint)}">${escapeHtml(remoteEndpoint)}</span>
          </div>
          <div class="debug-side-top-item">
            <span class="label">当前模型</span>
            <span class="value" title="${escapeHtml(modelId)}">${escapeHtml(modelName)}</span>
          </div>
          <div class="debug-side-top-item">
            <span class="label">Agent ID</span>
            <span class="value" title="${escapeHtml(String(agentId))}">${escapeHtml(String(agentId))}</span>
          </div>
          <div class="debug-side-top-item full">
            <span class="label">技能 ID</span>
            <span class="value" title="${escapeHtml(String(skillId))}">${escapeHtml(String(skillId))}</span>
          </div>
        </div>
        <div class="debug-side-section">
          <div class="debug-side-section-title">路由信息</div>
          <dl class="debug-side-route">
            ${routeItems.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value ?? ""))}</dd></div>`).join("")}
          </dl>
        </div>
        <div class="debug-side-section">
          <div class="debug-side-section-title">路由原因</div>
          <p class="debug-side-reason">${escapeHtml(routeReason)}</p>
        </div>
        ${trace.length ? `
          <div class="debug-side-section">
            <div class="debug-side-section-title">流转链路</div>
            <ol class="debug-side-trace">${trace.map((step) => `<li>${escapeHtml(debugTraceLabel(step))}</li>`).join("")}</ol>
          </div>
        ` : ""}
        ${kbHits.length ? `
          <div class="debug-side-section">
            <div class="debug-side-section-title">知识命中 Top ${Math.min(6, kbHits.length)}</div>
            <div class="debug-side-list">
              ${kbHits.slice(0, 6).map((hit, index) => `
                <article>
                  <b>${index + 1}</b>
                  <div><span>${escapeHtml(hit.source || hit.kb_type || "知识库")}</span><p>${escapeHtml(hit.title || hit.text?.slice(0, 60) || "未返回标题")}</p></div>
                  <em>${escapeHtml(debugScoreLabel(hit.score))}</em>
                </article>
              `).join("")}
            </div>
          </div>
        ` : ""}
        ${warnings.length ? `
          <div class="debug-side-section">
            <div class="debug-side-section-title">警告</div>
            <div class="debug-side-warning">${escapeHtml(warnings.join("；"))}</div>
          </div>
        ` : ""}
        ${!result.intent && !result.skill_key ? `
          <div class="debug-side-empty">暂无调试数据，发起一次对话后再按 Ctrl+X 查看。</div>
        ` : ""}
      </div>
    `;

    panel.querySelector(".debug-side-close")?.addEventListener("click", () => this.closeDebugSidePanel());
  }

  closeDevDrawer() {
    const drawer = document.querySelector(".dev-drawer");
    const overlay = document.querySelector(".dev-drawer-overlay");
    if (drawer) drawer.classList.remove("open");
    if (overlay) overlay.classList.remove("open");
  }

  renderDevDrawer() {
    let drawer = document.querySelector(".dev-drawer");
    let overlay = document.querySelector(".dev-drawer-overlay");
    if (!drawer) {
      overlay = document.createElement("div");
      overlay.className = "dev-drawer-overlay";
      overlay.addEventListener("click", () => this.closeDevDrawer());
      document.body.appendChild(overlay);

      drawer = document.createElement("div");
      drawer.className = "dev-drawer";
      document.body.appendChild(drawer);
    }

    const presets = (this.state.config && this.state.config.devSsoPresets) || [];
    const currentPreset = (this.auth && this.auth.presetKey) || "";
    const terminalLabel = { C: "C端", G: "G端", B: "B端", Admin: "管理" };

    drawer.innerHTML = `
      <div class="dev-drawer-header">
        <h3>开发者面板</h3>
        <p>点击用户切换身份，Ctrl+Z 开关，Ctrl+X 调试信息。</p>
      </div>
      <div class="dev-drawer-body">
        <div class="dev-drawer-section-title">预置用户列表</div>
        ${presets.map((p) => `
          <div class="dev-preset-item ${p.key === currentPreset ? "active" : ""}" data-preset-key="${p.key}">
            <div class="dev-preset-badge terminal-${p.terminal || "C"}">${(p.userName || "?").slice(0, 1)}</div>
            <div class="dev-preset-info">
              <div class="name">${escapeHtml(p.userName || "")}</div>
              <div class="meta">${escapeHtml(p.label || "")} / ${terminalLabel[p.terminal] || p.terminal || ""}</div>
            </div>
          </div>
        `).join("")}
      </div>
      <div class="dev-drawer-footer">
        <button class="dev-drawer-close-btn" type="button">关闭</button>
      </div>
    `;

    drawer.querySelector(".dev-drawer-close-btn").addEventListener("click", () => this.closeDevDrawer());
    drawer.querySelectorAll(".dev-preset-item").forEach((item) => {
      item.addEventListener("click", () => {
        const key = item.getAttribute("data-preset-key");
        this.loginAsPreset(key);
      });
    });
  }

  async loginAsPreset(presetKey) {
    try {
      const resp = await fetch("/api/sso/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetKey })
      });
      const data = await resp.json();
      if (data.ok) {
        const auth = {
          token: data.userToken,
          userToken: data.userToken,
          roleKey: data.roleKey,
          elderScope: data.elderScope,
          terminal: data.terminal,
          authLevel: data.authLevel,
          userName: data.userName,
          orgName: data.orgName || "",
          presetKey: data.presetKey
        };
        saveAuth(auth);
        this.closeDevDrawer();
        location.reload();
      } else {
        alert("登录失败：" + (data.error || "未知错误"));
      }
    } catch (err) {
      alert("请求失败：" + err.message);
    }
  }

  renderHome() {
    const page = screen.querySelector('[data-page="home"]');
    page.innerHTML = `
      <div class="cards-grid">
        <button type="button" class="func-card card-health" data-func="health">
          <span class="card-icon">&#10084;&#65039;</span>
          <span class="card-label">&#20581;&#24247;&#30417;&#27979;</span>
        </button>
        <button type="button" class="func-card card-meal" data-func="diet">
          <span class="card-icon">&#127869;&#65039;</span>
          <span class="card-label">&#33203;&#39135;&#25512;&#33616;</span>
        </button>
      </div>
      <div class="home-section-title">&#24120;&#29992;&#26381;&#21153;</div>
      <div class="quick-actions">
        <button type="button" class="quick-btn" data-func="search"><span class="quick-btn-icon">&#128269;</span><span class="quick-btn-text">&#25214;&#26381;&#21153;</span></button>
        <button type="button" class="quick-btn" data-func="policy"><span class="quick-btn-icon">&#128203;</span><span class="quick-btn-text">&#26597;&#25919;&#31574;</span></button>
        <button type="button" class="quick-btn" data-func="travel"><span class="quick-btn-icon">&#9992;&#65039;</span><span class="quick-btn-text">&#26053;&#23621;&#35268;&#21010;</span></button>
      </div>
      <div class="home-section-title">&#32039;&#24613;&#27714;&#21161;</div>
      <div class="quick-actions">
        <button type="button" class="quick-btn sos-btn-trigger" data-func="sos-120" style="background:#E5484D;color:#fff;border:none;">
          <span class="quick-btn-icon" style="font-size:22px">&#128222;</span>
          <span class="quick-btn-text" style="font-weight:700">&#25320;&#25171;120</span>
        </button>
        <button type="button" class="quick-btn sos-btn-trigger" data-func="sos-family" style="background:#0E7C86;color:#fff;border:none;">
          <span class="quick-btn-icon" style="font-size:22px">&#128106;</span>
          <span class="quick-btn-text" style="font-weight:700">&#36890;&#30693;&#23478;&#23646;</span>
        </button>
        <button type="button" class="quick-btn sos-btn-trigger" data-func="sos-chat" style="background:#f0f5f6;color:#E5484D;border:1px solid #E5484D;">
          <span class="quick-btn-icon" style="font-size:22px">&#9888;&#65039;</span>
          <span class="quick-btn-text" style="font-weight:700">SOS&#27714;&#21161;</span>
        </button>
      </div>
      <div class="ai-entry-bar" id="mobileAiEntry">
        <div class="ai-avatar-sm">AI</div>
        <div class="ai-entry-placeholder">&#26377;&#20160;&#20040;&#24819;&#35828;&#30340;&#65292;&#30452;&#25509;&#35828;...</div>
        <div class="ai-entry-mic">&#127908;</div>
      </div>
    `;
    page.querySelectorAll("[data-func]").forEach((card) => {
      card.addEventListener("click", () => {
        const func = card.dataset.func;
        if (func === "health") { this.switchTab("chat"); this.sendMessage("\u67e5\u770b\u5065\u5eb7\u76d1\u6d4b\u6570\u636e"); }
        else if (func === "diet") { this.switchTab("chat"); this.sendMessage("\u63a8\u8350\u4eca\u65e5\u81b3\u98df"); }
        else if (func === "search") { this.switchTab("chat"); this.sendMessage("\u627e\u670d\u52a1"); }
        else if (func === "policy") { this.switchTab("chat"); this.sendMessage("\u67e5\u653f\u7b56"); }
        else if (func === "travel") { this.switchTab("chat"); this.sendMessage("\u5e2e\u6211\u89c4\u5212\u65c5\u5c45\u8def\u7ebf"); }
        else if (func === "sos-120") { this.handlePhoneDial("120", { fallbackMessage: "当前浏览器无法直接拨号，请使用手机拨打 120" }); }
        else if (func === "sos-family") { const ec = localStorage.getItem("emergency_contact_phone"); if (ec) { this.handlePhoneDial(ec); } else { this.switchTab("chat"); this.sendMessage("\u6211\u8981\u901a\u77e5\u5bb6\u5c5e"); } }
        else if (func === "sos-chat") { this.switchTab("chat"); this.sendMessage("\u6551\u547d\uff01\u7d27\u6025\u6c42\u52a9"); }
      });
    });
    page.querySelector("#mobileAiEntry")?.addEventListener("click", () => {
      this.switchTab("chat");
    });
  }

  renderService() {
    const page = screen.querySelector('[data-page="service"]');
    const data = this.state.bootstrap || { messages: [], todos: [], orders: [], workOrders: [] };
    page.innerHTML = `
      <div class="section-heading-row">
        <h2 class="section-title">&#26381;&#21153;</h2>
        <button type="button" class="small-icon-button" id="refreshMessages">${mobileIconSvg("refresh")}<span>&#21047;&#26032;</span></button>
      </div>
      <div class="summary-row two">
        <div class="summary-card"><strong>${data.messages.filter((item) => item.read_status === "unread").length}</strong><span>&#26410;&#35835;</span></div>
        <div class="summary-card"><strong>${data.todos.length}</strong><span>&#24453;&#21150;</span></div>
      </div>
      ${this.renderList(data.messages, "\u6682\u65e0\u6d88\u606f", "message")}
      <h2 class="section-title">&#35746;&#21333;&#19982;&#24037;&#21333;</h2>
      ${this.renderList([...data.orders, ...data.workOrders], "\u6682\u65e0\u8ba2\u5355\u6216\u5de5\u5355", "order")}
    `;
    page.querySelector("#refreshMessages")?.addEventListener("click", async () => {
      await this.loadBootstrap();
      this.renderHome();
      this.renderService();
      this.renderProfile();
    });
    this.bindListActions(page);
  }

  renderProfile() {
    const profile = this.state.bootstrap?.profile || { user: {}, elders: [] };
    const page = screen.querySelector('[data-page="profile"]');
    page.innerHTML = `
      <h2 class="section-title">&#26381;&#21153;&#26723;&#26696;</h2>
      ${this.renderArchive(profile)}
      <h2 class="section-title">&#25480;&#26435;&#32769;&#20154;</h2>
      ${this.renderList(profile.elders, "\u6682\u65e0\u6388\u6743\u8001\u4eba", "elder")}
      <button type="button" class="quick-card logout-card" id="logoutMobile"><strong>&#36864;&#20986;&#24403;&#21069;&#36523;&#20221;</strong><span>&#36820;&#22238;&#32852;&#35843;&#30331;&#24405;</span></button>
    `;
    page.querySelector("#logoutMobile")?.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_AUTH);
      this.auth = {};
      this.renderLogin();
    });
  }

  renderArchive(profile) {
    const user = profile?.user || {};
    const privateFields = user.terminal === "B"
      ? [["管理机构", user.org_name], ["服务床位", "128 张，当前入住 91 人"], ["今日工单", "待派 6 单，处理中 14 单"], ["风险提醒", "2 条待复核"]]
      : [["管辖区域", user.org_name], ["重点老人", "80 岁以上 326 人，失能 47 人"], ["待办事项", "补贴复核 12 件，能力评估 8 件"], ["数据权限", user.elder_scope]];
    return `
      <article class="archive-mobile-card">
        <div class="archive-head">
          <span>${escapeHtml(initials(user.real_name))}</span>
          <div><strong>${escapeHtml(user.real_name)}</strong><small>${escapeHtml(roleTitle(user, this.auth))} / ${escapeHtml(user.terminal)}端</small></div>
        </div>
        <dl>
          <div><dt>所属组织</dt><dd>${escapeHtml(user.org_name)}</dd></div>
          <div><dt>登录授权</dt><dd>${escapeHtml(user.auth_level)}</dd></div>
          <div><dt>授权范围</dt><dd>${escapeHtml(user.elder_scope)}</dd></div>
          <div><dt>联系方式</dt><dd>${escapeHtml(user.phone_masked || "未提供")}</dd></div>
        </dl>
        ${canShowPrivate(profile) ? `<dl class="business-profile">${privateFields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : `<p class="privacy-note">C 端仅展示当前登录人的 IT 账号档案，不展示居住情况、能力评估、经济情况等个人隐私数据。</p>`}
      </article>
    `;
  }

  renderList(items = [], emptyText = "", type = "item") {
    if (!items.length) return `<article class="list-card"><p>${escapeHtml(emptyText)}</p></article>`;
    return items.map((item, index) => {
      const title = item.title || item.elder_name || item.service_type || item.work_order_id || item.order_id || "\u4e8b\u9879";
      const content = item.content || item.address_label || item.status || item.care_level || "";
      return `
        <article class="list-card" data-list-type="${type}" data-list-index="${index}">
          <strong>${escapeHtml(title)}</strong>
          <p>${escapeHtml(content)}</p>
          <div class="list-meta">
            <span>${escapeHtml(item.priority || item.status || item.role_name || item.read_status || "")}</span>
            <span>${escapeHtml(item.created_at || item.due_at || "")}</span>
          </div>
          ${type !== "elder" ? `<div class="list-actions"><button type="button" data-list-action="detail">&#26597;&#30475;</button><button type="button" data-list-action="handle">&#22788;&#29702;</button></div>` : ""}
        </article>
      `;
    }).join("");
  }

  bindListActions(scope) {
    scope.querySelectorAll("[data-list-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const card = event.target.closest("[data-list-type]");
        const type = card.dataset.listType;
        const index = Number(card.dataset.listIndex);
        const data = this.state.bootstrap;
        const source = type === "message" ? data.messages : type === "todo" ? data.todos : [...data.orders, ...data.workOrders];
        const item = source[index];
        if (!item) return;
        const action = button.dataset.listAction === "handle" ? "\u5904\u7406" : "\u67e5\u770b";
        const prompt = `${action}${item.title || item.service_type || item.work_order_id || item.order_id || "\u4e8b\u9879"}\uff1a${item.content || item.status || ""}`;
        this.switchTab("chat");
        this.sendMessage(prompt);
      });
    });
  }

  renderChat() {
    const page = screen.querySelector('[data-page="chat"]');
    page.innerHTML = `
      <section class="chat-panel">
        <div class="chat-header">
          <button type="button" class="chat-back-btn" id="chatBackBtn">&lsaquo;</button>
          <span class="chat-header-title">AI &#20859;&#32769;&#21161;&#25163;</span>
        </div>
        <div class="chat-log" id="mobileChatLog"></div>
        <form class="mobile-chat-form" id="mobileChatForm">
          <button type="button" class="mobile-input-icon" id="mobileVoiceButton" aria-label="&#35821;&#38899;&#36755;&#20837;">${mobileIconSvg("mic")}</button>
          <textarea id="mobileChatInput" rows="2" placeholder="&#35828;&#28857;&#20160;&#20040;..."></textarea>
          <button type="button" class="mobile-input-icon" id="mobileImageButton" aria-label="&#26356;&#22810;">${mobileIconSvg("plus")}</button>
          <button type="submit" class="mobile-send-button" aria-label="&#21457;&#36865;">${mobileIconSvg("send")}<span>&#21457;&#36865;</span></button>
          <input id="mobileImageInput" type="file" accept="image/*" capture="environment" hidden />
        </form>
      </section>
    `;
    this.replayConversation();
    this.renderTemplatePanel(this.state.latestResult);
    page.querySelector("#mobileChatForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = page.querySelector("#mobileChatInput");
      const text = input.value.trim();
      if (!text) return;
      this.sendMessage(text);
    });
    page.querySelector("#chatBackBtn")?.addEventListener("click", () => this.switchTab("home"));
    page.querySelector("#mobileVoiceButton")?.addEventListener("click", () => this.startVoiceInput());
    page.querySelector("#mobileImageButton")?.addEventListener("click", () => page.querySelector("#mobileImageInput")?.click());
    page.querySelector("#mobileImageInput")?.addEventListener("change", (event) => this.handleImageInput(event));
    page.querySelector("#mobileChatInput")?.addEventListener("keydown", (event) => this.handleInputHistoryKey(event));
    const chatInput = page.querySelector("#mobileChatInput");
    const sendBtn = page.querySelector(".mobile-send-button");
    const plusBtn = page.querySelector("#mobileImageButton");
    const updateSendVisibility = () => {
      const hasText = chatInput && chatInput.value.trim().length > 0;
      if (sendBtn) sendBtn.style.display = hasText ? "" : "none";
      if (plusBtn) plusBtn.style.display = hasText ? "none" : "";
    };
    chatInput?.addEventListener("input", updateSendVisibility);
    updateSendVisibility();
    this.updateFavoriteButton();
  }

  ensureConversation({ initial = false } = {}) {
    if (this.state.currentConversationId && this.currentConversation()) return this.currentConversation();
    const existing = this.state.conversations[0];
    if (existing && initial) {
      this.state.currentConversationId = existing.id;
      return existing;
    }
    return this.startNewConversation({ render: false });
  }

  startNewConversation({ render = true } = {}) {
    const conversation = {
      id: `mconv-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: "\u65b0\u5bf9\u8bdd",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "\u5df2\u5f00\u542f",
      favorite: false,
      latestQuestion: "",
      latestAnswer: "",
      messages: [
        { role: "ai", content: "\u60a8\u597d\uff0c\u6211\u662f\u6842\u5c0f\u517b\u3002\u53ef\u4ee5\u5e2e\u60a8\u67e5\u653f\u7b56\u3001\u627e\u670d\u52a1\u3001\u505a\u81b3\u98df\u5efa\u8bae\u548c\u89c4\u5212\u5eb7\u517b\u65c5\u5c45\u3002", at: Date.now() }
      ]
    };
    this.state.conversations.unshift(conversation);
    this.state.currentConversationId = conversation.id;
    this.persistHistory();
    if (render) {
      this.replayConversation();
      this.updateFavoriteButton();
      this.state.latestResult = null;
      this.renderTemplatePanel(null);
    }
    return conversation;
  }

  currentConversation() {
    return this.state.conversations.find((item) => item.id === this.state.currentConversationId) || null;
  }

  persistHistory() {
    this.state.conversations = this.state.conversations.slice(0, MAX_HISTORY);
    try { localStorage.removeItem(STORAGE_HISTORY_LEGACY); } catch {}
    const MAX_BYTES = 4 * 1024 * 1024;
    let attempts = 0;
    const maxAttempts = this.state.conversations.length;
    while (attempts < maxAttempts) {
      try {
        const data = JSON.stringify(this.state.conversations);
        if (data.length > MAX_BYTES) {
          const oldest = this.state.conversations[this.state.conversations.length - 1];
          if (oldest?.messages?.length > 3) {
            oldest.messages = oldest.messages.slice(-3);
            oldest._trimmed = true;
            attempts++;
            continue;
          }
          this.state.conversations = this.state.conversations.slice(0, -1);
          attempts++;
          continue;
        }
        localStorage.setItem(STORAGE_HISTORY, data);
        break;
      } catch (e) {
        if (e.name === 'QuotaExceededError' && this.state.conversations.length > 1) {
          this.state.conversations = this.state.conversations.slice(0, -1);
          attempts++;
          continue;
        }
        console.warn('[Mobile] persistHistory failed:', e.message);
        break;
      }
    }
    this._scheduleBackendSync();
  }

  _scheduleBackendSync() {
    if (this._syncTimeout) clearTimeout(this._syncTimeout);
    const now = Date.now();
    const waitForBackoff = Math.max(0, (this._syncDisabledUntil || 0) - now);
    const delay = Math.max(BACKEND_SYNC_BASE_DELAY_MS, waitForBackoff);
    this._syncTimeout = setTimeout(() => {
      this._syncToBackend(false);
    }, delay);
  }

  // 同步到后端。
  async _syncToBackend(immediate = false) {
    if (this._syncTimeout) {
      clearTimeout(this._syncTimeout);
      this._syncTimeout = null;
    }
    if (this._syncInFlight) {
      this._syncDirty = true;
      return;
    }
    const now = Date.now();
    if (!immediate && this._syncDisabledUntil && now < this._syncDisabledUntil) {
      this._scheduleBackendSync();
      return;
    }
    if (!this._syncedSignatures) this._syncedSignatures = {};
    // 增量同步：只提交自上次成功同步以来发生变化的会话，避免每次都提交全部历史导致
    // 请求体过大被服务端重置连接（net::ERR_CONNECTION_RESET）。
    const all = this.state.conversations
      .slice(0, MAX_HISTORY)
      .map((c) => ({ c, payload: serializeConversationForSync(c, this.auth) }));
    let changed = all.filter((x) => this._syncedSignatures[x.c.id] !== JSON.stringify(x.payload));
    if (changed.length === 0) return;
    // 体积封顶：即便一次变化较多，也只发送累计体积可控的部分（~1MB 上限，远低于服务端 2MB 限制），
    // 其余会话留待后续同步逐步补齐。
    let total = 0;
    const selected = [];
    for (const x of changed) {
      const s = JSON.stringify(x.payload).length;
      if (selected.length > 0 && total + s > 1000000) break;
      selected.push(x);
      total += s;
    }
    changed = selected;
    const conversations = changed.map((x) => x.payload);
    const payload = { conversations };
    const signature = JSON.stringify(payload);
    if (!immediate && signature === this._lastSyncSignature) return;
    this._syncInFlight = true;
    try {
      const res = await fetch("/api/conversation/sync-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: signature,
        keepalive: immediate,
      });
      if (!res.ok) throw new Error(`sync failed: ${res.status}`);
      this._lastSyncSignature = signature;
      changed.forEach((x) => { this._syncedSignatures[x.c.id] = JSON.stringify(x.payload); });
      this._syncFailureCount = 0;
      this._syncDisabledUntil = 0;
    } catch (e) {
      this._syncFailureCount += 1;
      const backoff = Math.min(BACKEND_SYNC_MAX_BACKOFF_MS, BACKEND_SYNC_BASE_DELAY_MS * (2 ** Math.min(this._syncFailureCount - 1, 4)));
      this._syncDisabledUntil = Date.now() + backoff;
      if (this._syncFailureCount === 1 || this._syncFailureCount % 3 === 0) {
        console.warn("[Mobile][ConversationHistory] 后台同步失败，稍后自动重试:", e.message);
      }
    } finally {
      this._syncInFlight = false;
      if (this._syncDirty) {
        this._syncDirty = false;
        this._scheduleBackendSync();
      }
    }
  }

  replayConversation() {
    const log = screen.querySelector("#mobileChatLog");
    if (!log) return;
    const conversation = this.ensureConversation();
    log.innerHTML = "";
    for (const message of conversation.messages) {
      if (message.type === "image") this.appendImageBubble(message, { record: false });
      else {
        const html = recoverHtmlCardFromSource(message.html || message.content || "");
        this.appendBubble(message.role, message.content, { record: false, markdown: message.markdown && !html, html });
      }
    }
    log.scrollTop = log.scrollHeight;
  }

  appendImageBubble({ fileName = "已上传图片", imageBase64 = "", status = "等待 OCR 识别", statusState = "loading" } = {}, options = {}) {
    const log = screen.querySelector("#mobileChatLog");
    if (!log) return;
    const safeState = ["loading", "done", "error"].includes(statusState) ? statusState : "loading";
    log.insertAdjacentHTML("beforeend", `
      <div class="bubble user image-bubble">
        <img src="${escapeHtml(imageBase64)}" alt="${escapeHtml(fileName)}" />
        <div class="image-caption">
          <strong>${escapeHtml(fileName)}</strong>
          <span class="image-status ${escapeHtml(safeState)}"><i aria-hidden="true"></i><span>${escapeHtml(status)}</span></span>
        </div>
      </div>
    `);
    log.scrollTop = log.scrollHeight;
    if (options.record === false) return;
    const conversation = this.currentConversation();
    if (!conversation) return;
    const title = fileName ? `图片：${fileName}` : "图片输入";
    conversation.messages.push({ role: "user", type: "image", fileName, imageBase64, status, statusState: safeState, at: Date.now() });
    conversation.latestQuestion = title;
    conversation.title = compactText(title, 18);
    conversation.status = "等待答复";
    conversation.updatedAt = Date.now();
    this.persistHistory();
  }

  updateLastImageStatus(status, statusState = "done") {
    const safeState = ["loading", "done", "error"].includes(statusState) ? statusState : "done";
    const imageStatuses = screen.querySelectorAll(".image-bubble .image-status");
    const statusEl = imageStatuses[imageStatuses.length - 1];
    if (statusEl) {
      statusEl.classList.remove("loading", "done", "error");
      statusEl.classList.add(safeState);
      const textEl = statusEl.querySelector("span");
      if (textEl) textEl.textContent = status;
    }
    const conversation = this.currentConversation();
    const imageMessage = conversation?.messages?.filter((message) => message.type === "image").at(-1);
    if (imageMessage) {
      imageMessage.status = status;
      imageMessage.statusState = safeState;
      conversation.updatedAt = Date.now();
      this.persistHistory();
    }
  }

  appendBubble(kind, text, options = {}) {
    const log = screen.querySelector("#mobileChatLog");
    if (!log) return;
    const role = kind === "user" ? "user" : "ai";
    const safeText = fallbackCleanText(text);
    const html = options.html ? sanitizeHtmlCard(options.html) : "";
    const body = html
      ? html
      : options.pending
      ? renderPendingBubbleContent(safeText)
      : options.markdown ? renderMarkdown(safeText) : escapeHtml(safeText);
    log.insertAdjacentHTML("beforeend", `<div class="bubble ${role} ${options.markdown ? "markdown-body" : ""} ${html ? "html-card-bubble" : ""} ${options.pending ? "pending-bubble" : ""}">${body}</div>`);
    scrubVisibleMojibake(log);
    log.scrollTop = log.scrollHeight;
  }

  addBubble(kind, text, options = {}) {
    const safeText = fallbackCleanText(text);
    this.appendBubble(kind, safeText, options);
    if (options.record === false) return;
    const conversation = this.currentConversation();
    if (!conversation) return;
    conversation.messages.push({ role: kind, content: safeText, markdown: Boolean(options.markdown), html: options.html ? sanitizeHtmlCard(options.html) : "", agent_key: options.meta?.agent_key || "", at: Date.now() });
    conversation.updatedAt = Date.now();
    if (kind === "user") {
      conversation.latestQuestion = safeText;
      conversation.title = compactText(safeText, 18);
      conversation.status = "\u7b49\u5f85\u7b54\u590d";
    } else {
      conversation.latestAnswer = safeText;
      conversation.status = options.error ? "\u7b54\u590d\u5f02\u5e38" : "\u5df2\u7b54\u590d";
    }
    this.persistHistory();
  }

  addSystemNotice(text) {
    const notice = document.createElement("div");
    notice.className = "mobile-system-notice";
    notice.textContent = text;
    const wrap = screen || document.getElementById("messageList");
    if (wrap) {
      wrap.appendChild(notice);
      wrap.scrollTo?.({ top: wrap.scrollHeight, behavior: "smooth" });
    }
  }

  updateLastAiBubble(text, options = {}) {
    const safeText = fallbackCleanText(text);
    const bubbles = screen.querySelectorAll(".bubble.ai");
    const last = bubbles[bubbles.length - 1];
    if (last) {
      last.classList.remove("pending-bubble");
      last.classList.toggle("markdown-body", Boolean(options.markdown));
      const html = options.html ? sanitizeHtmlCard(options.html) : "";
      last.classList.toggle("html-card-bubble", Boolean(html));
      if (html) last.innerHTML = html;
      else last.innerHTML = options.markdown ? renderMarkdown(safeText) : escapeHtml(safeText);
      scrubVisibleMojibake(last);
      // 标签页自动初始化：检测 .tab + .tab-panel 并绑定点击切换
      this._initTabs(last);
    }
    const conversation = this.currentConversation();
    if (!conversation) return;
    const lastMessage = [...conversation.messages].reverse().find((item) => item.role === "ai");
    if (lastMessage) {
      lastMessage.content = safeText;
      lastMessage.markdown = Boolean(options.markdown);
      lastMessage.html = options.html ? sanitizeHtmlCard(options.html) : "";
      if (options.meta) lastMessage.meta = options.meta;
    }
    conversation.latestAnswer = safeText;
    conversation.status = options.error ? "答复异常" : "已答复";
    conversation.updatedAt = Date.now();
    this.persistHistory();
  }

  _initTabs(container) {
    const tabs = container.querySelectorAll(".tab");
    const panels = container.querySelectorAll(".tab-panel");
    if (!tabs.length || !panels.length) return;
    tabs.forEach((t) => t.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    tabs[0].classList.add("active");
    if (panels[0]) panels[0].classList.add("active");
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        panels.forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        if (panels[i]) panels[i].classList.add("active");
      });
    });
  }

  conversationContext(limit = 10) {
    const conversation = this.currentConversation();
    if (!conversation) return [];
    return conversation.messages
      .filter((message) => message.type !== "image" && String(message.content || "").trim())
      .slice(-limit)
      .map((message) => ({
        role: message.role === "user" ? "user" : "assistant",
        content: compactText(message.content, 300),
        at: message.at || null
      }));
  }

  rememberInput(text = "") {
    const value = String(text || "").trim();
    if (!value) return;
    this.state.inputHistory = [value, ...this.state.inputHistory.filter((item) => item !== value)].slice(0, INPUT_HISTORY_LIMIT);
    this.state.inputHistoryIndex = -1;
  }

  handleInputHistoryKey(event) {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (!this.state.inputHistory.length) return;
    event.preventDefault();
    if (event.key === "ArrowUp") {
      this.state.inputHistoryIndex = Math.min(this.state.inputHistoryIndex + 1, this.state.inputHistory.length - 1);
    } else {
      this.state.inputHistoryIndex = Math.max(this.state.inputHistoryIndex - 1, -1);
    }
    event.currentTarget.value = this.state.inputHistoryIndex >= 0 ? this.state.inputHistory[this.state.inputHistoryIndex] : "";
    event.currentTarget.focus();
  }

  resetVisibleVoiceInput({ focus = false } = {}) {
    const input = screen.querySelector("#mobileChatInput");
    const button = screen.querySelector("#mobileVoiceButton");
    this.state.recognizing = false;
    this.voiceRecognition = null;
    button?.classList.remove("listening");
    if (!this.state.sending) button?.removeAttribute("disabled");
    if (focus) input?.focus();
  }

  stopVisibleVoiceInput() {
    if (this.voiceRecognition) {
      try {
        this.voiceRecognition.stop();
      } catch {
        this.resetVisibleVoiceInput();
      }
      return;
    }
    this.resetVisibleVoiceInput();
  }

  async sendMessage(text, options = {}) {
    // Support queued items as { message, skill_key, context }
    let message;
    let sendOptions = options;
    if (text && typeof text === "object" && !Array.isArray(text)) {
      message = String(text.message || "").trim();
      sendOptions = {
        skill_key: text.skill_key,
        context: text.context || {},
      };
    } else {
      message = String(text || "").trim();
    }
    if (!message) return;
    const queuedItem = {
      message,
      skill_key: sendOptions.skill_key,
      context: sendOptions.context,
    };
    if (this.state.sending) {
      // 排队等待当前请求完成后自动发送
      this.state.pendingQueue.push(queuedItem);
      this.showToast("消息已排队，当前处理完成后自动发送");
      return;
    }
    this.state.sending = true;
    this.stopVisibleVoiceInput();
    screen.querySelector(".mobile-send-button")?.setAttribute("disabled", "disabled");
    screen.querySelector("#mobileVoiceButton")?.setAttribute("disabled", "disabled");
    this.rememberInput(message);
    this.ensureConversation();
    const conversation = this.currentConversation();
    const conversationHistory = this.conversationContext();
    const input = screen.querySelector("#mobileChatInput");
    if (input) input.value = "";
    this.state.inputHistoryIndex = -1;
    this.addBubble("user", message);
    this.addBubble("ai", "\u601d\u8003\u4e2d...", { pending: true });
    try {
      const payload = {
        message,
        conversationId: conversation?.id || "",
        conversationHistory,
        roleKey: this.auth.roleKey,
        channel: "mobile",
        userToken: this.auth.token,
        elder_id: this.auth.elderId || this.auth.elderScope || "",
        elderScope: this.auth.elderScope,
        terminal: this.auth.terminal,
        authLevel: this.auth.authLevel,
        userName: this.auth.userName,
        orgName: this.auth.orgName,
        presetKey: this.auth.presetKey,
        location: this.state.location || null,
      };
      if (sendOptions.skill_key) {
        payload.skill_key = sendOptions.skill_key;
      }
      if (sendOptions.context && typeof sendOptions.context === "object") {
        payload.context = { ...sendOptions.context };
      }
      const body = await fetchJson("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload)
      });
      this.handleRemoteResult(body);
    } catch (err) {
      if (err.status === 409) {
        // 会话繁忙，重新排队等待
        this.state.pendingQueue.unshift(queuedItem);
        this.showToast("系统处理中，消息已排队");
      } else {
        this.updateLastAiBubble(`\u8bf7\u6c42\u672a\u5b8c\u6210\uff1a${err.message}`, { error: true });
      }
    } finally {
      this.state.sending = false;
      screen.querySelector(".mobile-send-button")?.removeAttribute("disabled");
      this.resetVisibleVoiceInput();
      this.flushPendingQueue();
    }
  }

  flushPendingQueue() {
    const next = this.state.pendingQueue.shift();
    if (!next) return;
    if (typeof next === "string") {
      this.sendMessage(next);
    } else {
      this.sendMessage(next.message, {
        skill_key: next.skill_key,
        context: next.context,
      });
    }
  }

  showToast(text) {
    const toast = document.createElement("div");
    toast.className = "mobile-toast";
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  handlePhoneDial(phone, options = {}) {
    const safePhone = sanitizePhoneNumber(phone);
    if (!safePhone) {
      this.showToast(options.missingMessage || "未配置可拨打的电话号码");
      return false;
    }
    if (isLikelyDialCapableDevice()) {
      window.location.href = `tel:${safePhone}`;
      return true;
    }
    const message = options.fallbackMessage || `当前浏览器无法直接拨号，请使用手机拨打 ${safePhone}`;
    this.showToast(message);
    this.addSystemNotice(message);
    return false;
  }

  handleSosPhoneAction(action = {}) {
    const key = String(action.action_key || "");
    if (key === "sos.call_120") {
      this.handlePhoneDial("120", { fallbackMessage: "当前浏览器无法直接拨号，请使用手机拨打 120" });
      return true;
    }
    if (key === "sos.notify_family") {
      const phone = action.params?.phone || action.params?.emergency_phone || localStorage.getItem("emergency_contact_phone") || "";
      if (phone) {
        const safePhone = sanitizePhoneNumber(phone);
        this.handlePhoneDial(phone, { fallbackMessage: `当前浏览器无法直接拨号，请使用手机拨打 ${safePhone}` });
      } else {
        this.switchTab("chat");
        this.sendMessage("\u6211\u8981\u901a\u77e5\u5bb6\u5c5e");
      }
      return true;
    }
    return false;
  }

  normalizeDebugResult(body = {}) {
    const result = body?.result_type === "skill_run" && body.envelope
      ? { ...body.envelope, action_result: { ...body, envelope: undefined } }
      : body || {};
    const route = result.route || {};
    const platform = result.platform || {};
    const healthPlatform = this.state.health?.platform || {};
    const agentId = platform.agentId || platform.agent_id || result.target_agent_id || route.agent_id || route.agentId || "";
    const spaceId = platform.spaceId || platform.space_id || route.space_id || route.spaceId || healthPlatform.spaceId || healthPlatform.space_id || "";
    const baseUrl = platform.baseUrl || platform.base_url || healthPlatform.baseUrl || healthPlatform.base_url || "";
    const confidence = result.confidence ?? route.confidence;
    const templateKey = result.template_key || result.template_id || result.templateId || "";
    const answer = result.answer || result.answer_text || result.message || "";
    const actions = Array.isArray(result.actions) ? result.actions.map(localizeActionItem) : result.actions;
    const followupSuggestions = Array.isArray(result.followup_suggestions)
      ? result.followup_suggestions.map(localizeActionItem)
      : result.followup_suggestions;
    const dataFollowups = Array.isArray(result.data?.followup_suggestions)
      ? result.data.followup_suggestions.map(localizeActionItem)
      : result.data?.followup_suggestions;
    return {
      ...result,
      answer,
      actions,
      followup_suggestions: followupSuggestions,
      data: result.data ? {
        ...result.data,
        followup_suggestions: dataFollowups,
      } : result.data,
      template_key: templateKey,
      target_agent_id: result.target_agent_id || agentId,
      confidence,
      risk_level: result.risk_level || route.risk_level || result.data?.risk_level || "",
      role_context: result.role_context || {
        title: this.auth.roleKey || result.role_key || "",
        terminal: this.auth.terminal || "",
      },
      platform: {
        ...platform,
        baseUrl,
        spaceId,
        agentId,
        remote: {
          ...(platform.remote || {}),
          baseUrl: platform.remote?.baseUrl || baseUrl,
          spaceId: platform.remote?.spaceId || spaceId,
          agentId: platform.remote?.agentId || agentId,
        },
      },
      route: {
        ...route,
        agent_id: route.agent_id || agentId,
        confidence: route.confidence ?? confidence,
      },
    };
  }

  handleRemoteResult(body) {
    const normalizedBody = this.normalizeDebugResult(body);
    // ★ Agent 切换提示
    if (normalizedBody.agent_switched && normalizedBody.agent_from) {
      const agentNames = {
        meal_plan: '膳食助手', travel_route: '旅居助手', nearby_resource: '周边助手',
        find_service: '服务助手', health_risk_warning: '健康预警', dispatch_manage: '调度助手', common: '桂小养',
      };
      const fromName = agentNames[normalizedBody.agent_from] || normalizedBody.agent_from;
      const toName = agentNames[normalizedBody.agent_key] || normalizedBody.agent_key || '桂小养';
      console.log(`[SceneSwitch] 已从「${fromName}」切换到「${toName}」，之前的话题随时可以回来`);
    }
    const answer = sanitizeAssistantText(normalizedBody.answer || normalizedBody.answer_text || normalizedBody.message || normalizedBody.error || "\u670d\u52a1\u5df2\u54cd\u5e94\u3002");
    const fallbackHtml = renderSafeHtmlFallback(normalizedBody);
    const routeMeta = {
      skill_key: normalizedBody.skill_key || "",
      agent_key: normalizedBody.agent_key || normalizedBody.skill_key || "",
      template_id: normalizedBody.template_id || normalizedBody.template_key || "",
      scene_key: normalizedBody.route?.scene_key || "",
      intent: normalizedBody.intent || "",
      jtdStatus: normalizedBody.data?.jtdStatus || "",
    };
    this.state.latestResult = normalizedBody;
    this.state.latestAnswer = answer;
    this.updateLastAiBubble(answer, { markdown: !fallbackHtml, html: fallbackHtml, error: normalizedBody.ok === false, meta: routeMeta });
    this.appendAssistantActions(normalizedBody);
    this.appendCompactFollowups(normalizedBody);
    this.appendFollowupSuggestions(normalizedBody);
    this.appendAmbiguityOptions(normalizedBody);
    this.upsertTemplateTab(normalizedBody);
    this.renderTemplatePanel(normalizedBody);
    // 右侧调试卡片区域ュ已打开，则自姩刷新
    const sidePanel = document.querySelector(".mobile-debug-side-panel.open");
    if (sidePanel) this.renderDebugSidePanel();
    // ========== 寮曞按钮渲染 ==========
    // 妫€娴?chat.busy_guide.v1 鍜?chat.queue_status.v1 模板
    const templateId = normalizedBody.template_id || normalizedBody.templateId;
    if (templateId === "chat.busy_guide.v1" || templateId === "chat.queue_status.v1") {
      this.renderBusyGuideButtons(body);
    }
    
    if (this.state.autoSpeech) this.speakText(answer);
  }

  renderAssistantActions(result = {}) {
    const actions = Array.isArray(result.actions) ? result.actions.map(localizeActionItem) : [];
    return actions.filter((item) => item?.label && item.action_key && isSupportedMobileAction(item)).slice(0, 6);
  }

  appendAssistantActions(result = {}) {
    const actions = this.renderAssistantActions(result);
    if (!actions.length) return;
    const bubbles = screen.querySelectorAll(".bubble.ai");
    const last = bubbles[bubbles.length - 1];
    if (!last) return;
    const buttons = actions.map((item) => `
      <button type="button" class="mobile-action-btn" data-mobile-action="${encodeFollowup({
        ...item,
        skill_key: item.skill_key || result.skill_key || "common",
        source_template_id: item.source_template_id || result.template_id || "",
        next_template_id: item.next_template_id || result.template_id || "",
      })}">${escapeHtml(item.label || "\u6267\u884c")}</button>
    `).join("");
    last.insertAdjacentHTML("beforeend", `<div class="mobile-action-bar">${buttons}</div>`);
    last.querySelectorAll("[data-mobile-action]").forEach((button) => {
      button.addEventListener("click", () => this.handleAssistantAction(decodeFollowup(button.dataset.mobileAction), button));
    });
  }

  // 消歧选项渲染：当返回 ambiguity_options 时，渲染为大按钮选择列表
  appendAmbiguityOptions(result = {}) {
    const options = Array.isArray(result.ambiguity_options) ? result.ambiguity_options : [];
    if (!options.length) return;
    const bubbles = screen.querySelectorAll(".bubble.ai");
    const last = bubbles[bubbles.length - 1];
    if (!last) return;
    const oldBar = last.querySelector(".ambiguity-options-bar");
    if (oldBar) oldBar.remove();
    const buttonsHtml = options.map((opt) =>
      `<button type="button" class="ambiguity-option-btn" data-scene="${escapeHtml(opt.scene_key || opt.skill_key || "")}" data-label="${escapeHtml(opt.label || "")}" data-route-id="${escapeHtml(opt.route_id || "")}" ` +
      `style="display:block;width:100%;padding:14px;margin:6px 0;border:1.5px solid #e0e0e0;border-radius:12px;` +
      `background:#fff;cursor:pointer;text-align:left;font-size:15px;color:#333;transition:all 0.2s;">` +
      `<span style="font-size:20px;margin-right:8px;">${escapeHtml(opt.icon || "")}</span>` +
      `<strong>${escapeHtml(opt.label || "")}</strong>` +
      `<span style="display:block;color:#888;font-size:13px;margin-top:2px;">${escapeHtml(opt.desc || "")}</span>` +
      `</button>`
    ).join("");
    const container = document.createElement("div");
    container.className = "ambiguity-options-bar";
    container.style.cssText = "margin-top:12px;";
    container.innerHTML = buttonsHtml;
    container.querySelectorAll(".ambiguity-option-btn").forEach((btn) => {
      btn.addEventListener("mouseenter", () => {
        btn.style.borderColor = "#4CAF50";
        btn.style.background = "#f1f8e9";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.borderColor = "#e0e0e0";
        btn.style.background = "#fff";
      });
      btn.addEventListener("click", () => {
        const label = btn.getAttribute("data-label");
        const scene = btn.getAttribute("data-scene");
        const routeId = btn.getAttribute("data-route-id");
        const context = { ambiguity_pick: true, ambiguity_scene_key: scene };
        if (routeId) context.publish_route_id = routeId;
        this.sendMessage(label, {
          skill_key: scene || (routeId ? "travel_route" : ""),
          context,
        });
      });
    });
    last.appendChild(container);
  }

  async handleAssistantAction(action = {}, button = null) {
    if (!action?.action_key) return;
    action = localizeActionItem(action);
    if (isSosPhoneAction(action) && this.handleSosPhoneAction(action)) return;
    if (this.state.sending) return;
    this.state.sending = true;
    const conversation = this.currentConversation();
    const originalText = button?.textContent || action.label || "\u6267\u884c";
    const sendButton = screen.querySelector(".mobile-send-button");
    sendButton?.setAttribute("disabled", "disabled");
    try {
      if (button) {
        button.disabled = true;
        button.textContent = "\u5904\u7406\u4e2d...";
      }
      this.addBubble("user", action.label || "\u6267\u884c");
      this.addBubble("ai", "\u5904\u7406\u4e2d...", { pending: true });
      const payload = await fetchJson("/api/chat/action", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          ...action,
          user_prompt: action.user_prompt || action.label || "继续",
          execute_action: true,
          reenter_chat: false,
          conversation_id: conversation?.id || "",
          roleKey: this.auth.roleKey,
          channel: "mobile",
          userToken: this.auth.token,
          elder_id: this.auth.elderId || this.auth.elderScope || "",
          elderScope: this.auth.elderScope,
          terminal: this.auth.terminal,
          authLevel: this.auth.authLevel,
          userName: this.auth.userName,
          orgName: this.auth.orgName,
          presetKey: this.auth.presetKey,
          location: this.state.location || null,
        }),
      });

      // 预订跳转：服务端返回 redirect 类型，前端打开金跳动 H5 页面
      if (payload.result_type === 'redirect' && payload.redirect_url) {
        this.handleBookingRedirect(payload);
        return;
      }

      this.handleRemoteResult(payload);
    } catch (err) {
      this.updateLastAiBubble(`\u64cd\u4f5c\u6267\u884c\u5f02\u5e38\uff1a${err.message}`, { error: true });
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
      this.state.sending = false;
      sendButton?.removeAttribute("disabled");
      this.flushPendingQueue();
    }
  }

  handleBookingRedirect(payload) {
    const redirectUrl = payload.redirect_url || '';
    const redirectUrls = payload.redirect_urls || {};
    if (!redirectUrl) return;

    // 在聊天气泡中显示跳转提示
    const productName = payload.params?.destination || '旅居产品';
    this.updateLastAiBubble(`正在为您打开${productName}预订页面，请在新页面确认入住日期、人数和最终价格后完成下单。`);

    // 移动端：新窗口打开 H5 预订页面（移动浏览器会自动唤起 App 或打开新标签页）
    // 桌面端：新标签页打开
    window.open(redirectUrl, '_blank', 'noopener,noreferrer');

    // 在操作区域追加一个"重新打开预订页面"按钮，防止弹窗被拦截
    const actionContainer = document.querySelector('.mobile-action-row');
    if (actionContainer) {
      const reopenBtn = document.createElement('button');
      reopenBtn.className = 'mobile-action-btn mobile-action-btn-primary';
      reopenBtn.textContent = '重新打开预订页面';
      reopenBtn.addEventListener('click', () => {
        window.open(redirectUrl, '_blank', 'noopener,noreferrer');
      });
      actionContainer.appendChild(reopenBtn);
    }
  }

  renderFollowupSuggestions(result = {}) {
    const suggestions = Array.isArray(result.followup_suggestions)
      ? result.followup_suggestions
      : Array.isArray(result.data?.followup_suggestions)
      ? result.data.followup_suggestions
      : [];
    return suggestions
      .map(localizeActionItem)
      .filter((item) => item?.label && item.user_prompt)
      .slice(0, 6);
  }

  appendFollowupSuggestions(result = {}) {
    const suggestions = this.renderFollowupSuggestions(result);
    if (!suggestions.length) return;
    const bubbles = screen.querySelectorAll(".bubble.ai");
    const last = bubbles[bubbles.length - 1];
    if (!last) return;
    // 先清除旧的 followup bar，避免重复追加
    const oldBar = last.querySelector(".mobile-followup-bar");
    if (oldBar) oldBar.remove();
    const buttons = suggestions.map((item) => `
      <button type="button" class="mobile-followup-btn" data-mobile-followup="${encodeFollowup({
        ...item,
        skill_key: item.skill_key || result.skill_key || "common",
        source_template_id: item.source_template_id || result.template_id || "",
        next_template_id: item.next_template_id || result.template_id || "",
      })}">${escapeHtml(item.label || item.user_prompt || "\u7ee7\u7eed")}</button>
    `).join("");
    last.insertAdjacentHTML("beforeend", `<div class="mobile-followup-bar">${buttons}</div>`);
    last.querySelectorAll("[data-mobile-followup]").forEach((button) => {
      button.addEventListener("click", () => this.handleFollowupSuggestion(decodeFollowup(button.dataset.mobileFollowup), button));
    });
  }

  appendCompactFollowups(result = {}) {
    const items = Array.isArray(result.compact_followups)
      ? result.compact_followups
          .map((item) => ({
            ...item,
            label: visibleActionText(item?.label || item?.text || item?.title || item?.name),
            action_key: visibleActionText(item?.action_key || item?.key),
          }))
          .map(localizeActionItem)
          .filter((item) => item.label && item.action_key)
      : [];
    if (!items.length) return;
    const bubbles = screen.querySelectorAll(".bubble.ai");
    const last = bubbles[bubbles.length - 1];
    if (!last) return;
    const oldBar = last.querySelector(".mobile-compact-bar");
    if (oldBar) oldBar.remove();
    const buttons = items.map((item) => {
      const inputAttr = item.input ? ` data-input="${encodeURIComponent(JSON.stringify(item.input))}"` : "";
      const paramsAttr = item.params ? ` data-params="${encodeURIComponent(JSON.stringify(item.params))}"` : "";
      const actionAttr = item.action_key ? ` data-action-key="${item.action_key}"` : "";
      return `<button type="button" class="mobile-followup-btn mobile-compact-btn"${actionAttr}${paramsAttr}${inputAttr}>${escapeHtml(item.label || "")}</button>`;
    }).join("");
    last.insertAdjacentHTML("beforeend", `<div class="mobile-followup-bar mobile-compact-bar">${buttons}</div>`);
    last.querySelectorAll(".mobile-compact-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => this.handleCompactChipClick(e));
    });
  }

  async handleCompactChipClick(e) {
    const chip = e.currentTarget;
    const actionKey = chip.dataset.actionKey;
    if (!actionKey || this.state.sending) return;

    let inputDef = null;
    if (chip.dataset.input) {
      try { inputDef = JSON.parse(decodeURIComponent(chip.dataset.input)); } catch (e) { inputDef = null; }
    }

    if (!inputDef) {
      let baseParams = {};
      if (chip.dataset.params) { try { baseParams = JSON.parse(decodeURIComponent(chip.dataset.params)); } catch (e) {} }
      this.handleAssistantAction({ action_key: actionKey, params: baseParams, label: chip.textContent.trim() }, chip);
      return;
    }

    document.querySelectorAll(".mobile-compact-expand").forEach((el) => el.remove());

    if (inputDef.type === "text") this.expandCompactTextInput(chip, inputDef, actionKey);
    else if (inputDef.type === "select") this.expandCompactSelect(chip, inputDef, actionKey);
    else if (inputDef.type === "form") this.expandCompactForm(chip, inputDef, actionKey);
  }

  expandCompactTextInput(chip, def, actionKey) {
    const wrap = document.createElement("span");
    wrap.className = "mobile-compact-expand";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = def.placeholder || "";
    input.className = "mobile-compact-input";
    const confirm = document.createElement("button");
    confirm.textContent = "✓";
    confirm.className = "mobile-followup-btn mobile-compact-confirm";
    const submit = () => {
      const val = input.value.trim();
      if (!val) return;
      let baseParams = {};
      if (chip.dataset.params) { try { baseParams = JSON.parse(decodeURIComponent(chip.dataset.params)); } catch (e) {} }
      baseParams[def.param_key] = val;
      this.handleAssistantAction({ action_key: actionKey, params: baseParams, label: chip.textContent.trim() }, chip);
    };
    confirm.addEventListener("click", submit);
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submit(); });
    wrap.append(input, confirm);
    chip.after(wrap);
    input.focus();
  }

  expandCompactSelect(chip, def, actionKey) {
    const wrap = document.createElement("span");
    wrap.className = "mobile-compact-expand";
    const select = document.createElement("select");
    select.className = "mobile-compact-input";
    const placeholder = document.createElement("option");
    placeholder.textContent = def.placeholder || "请选择";
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
    for (const opt of def.options || []) {
      const o = document.createElement("option");
      o.value = opt.value || opt; o.textContent = opt.label || opt;
      select.appendChild(o);
    }
    const confirm = document.createElement("button");
    confirm.textContent = "✓";
    confirm.className = "mobile-followup-btn mobile-compact-confirm";
    confirm.addEventListener("click", () => {
      if (!select.value) return;
      let baseParams = {};
      if (chip.dataset.params) { try { baseParams = JSON.parse(decodeURIComponent(chip.dataset.params)); } catch (e) {} }
      baseParams[def.param_key] = select.value;
      this.handleAssistantAction({ action_key: actionKey, params: baseParams, label: chip.textContent.trim() }, chip);
    });
    wrap.append(select, confirm);
    chip.after(wrap);
  }

  expandCompactForm(chip, def, actionKey) {
    const panel = document.createElement("div");
    panel.className = "mobile-compact-expand mobile-compact-form";
    for (const field of def.fields || []) {
      const row = document.createElement("div");
      row.className = "mobile-compact-form-row";
      const label = document.createElement("label");
      label.textContent = field.label || "";
      let input;
      if (field.type === "select") {
        input = document.createElement("select");
        for (const opt of field.options || []) {
          const o = document.createElement("option");
          o.value = opt.value || opt; o.textContent = opt.label || opt;
          input.appendChild(o);
        }
      } else {
        input = document.createElement("input");
        input.type = "text";
        input.placeholder = field.placeholder || "";
      }
      input.dataset.fieldKey = field.key;
      input.className = "mobile-compact-input mobile-compact-form-field";
      row.append(label, input);
      panel.appendChild(row);
    }
    const submitBtn = document.createElement("button");
    submitBtn.textContent = "提交";
    submitBtn.className = "mobile-followup-btn mobile-compact-confirm";
    submitBtn.addEventListener("click", () => {
      let params = {};
      if (chip.dataset.params) { try { params = JSON.parse(decodeURIComponent(chip.dataset.params)); } catch (e) {} }
      panel.querySelectorAll(".mobile-compact-form-field").forEach((f) => {
        if (f.value.trim()) params[f.dataset.fieldKey] = f.value.trim();
      });
      this.handleAssistantAction({ action_key: actionKey, params, label: chip.textContent.trim() }, chip);
    });
    panel.appendChild(submitBtn);
    chip.after(panel);
  }

  async handleFollowupSuggestion(suggestion = {}, button = null) {
    const prompt = String(suggestion.user_prompt || suggestion.label || "").trim();
    if (!prompt || this.state.sending) return;
    const conversation = this.currentConversation();
    const originalText = button?.textContent || suggestion.label || prompt;
    const canExecuteAction = Boolean(suggestion.action_key && isSupportedMobileAction(suggestion));
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
        button.textContent = "\u5904\u7406\u4e2d...";
      }
      this.addBubble("user", prompt);
      this.addBubble("ai", "\u5904\u7406\u4e2d...", { pending: true });
      const conversationHistory = this.conversationContext();
      const payload = await fetchJson("/api/chat/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          ...payloadSuggestion,
          message: prompt,
          user_prompt: prompt,
          execute_action: canExecuteAction,
          reenter_chat: !canExecuteAction,
          followup_source: canExecuteAction ? "action_button" : "followup",
          conversation_id: conversation?.id || "",
          conversationHistory,
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
      this.updateLastAiBubble(`\u64cd\u4f5c\u6267\u884c\u5f02\u5e38\uff1a${err.message}`, { error: true });
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  /**
   * 渲染寮曞按钮（此时引导?排队状态€侊級
   */
  renderBusyGuideButtons(body) {
    const templateId = body.template_id || body.templateId;
    const buttons = body.buttons || body.data?.buttons || [];
    const pendingMessage = body.data?.pending_message || body.pending_message || "";
    
    if (!buttons.length) return;
    
    // 在最后一条 AI 消息后添加按钮区域。
    const log = screen.querySelector("#mobileChatLog");
    if (!log) return;
    
    // 移除时х殑寮曞按钮
    const oldGuideButtons = log.querySelector(".busy-guide-buttons");
    if (oldGuideButtons) oldGuideButtons.remove();
    
    // 创建按钮容器
    const buttonContainer = document.createElement("div");
    buttonContainer.className = "busy-guide-buttons";
    buttonContainer.innerHTML = `
      <div class="busy-guide-message">${templateId === "chat.busy_guide.v1" ? "当前有对话正在处理，请选择：" : "已加入队列，您可以："}</div>
      <div class="busy-guide-actions">
        ${buttons.map((btn, index) => `
          <button type="button" class="busy-guide-btn ${btn.style || "primary"}" data-action-key="${btn.action_key || btn.actionKey}" data-pending-message="${escapeHtml(pendingMessage)}">
            ${escapeHtml(btn.label || "操作")}
          </button>
        `).join("")}
      </div>
    `;
    
    // 绑定按钮点击事件
    buttonContainer.querySelectorAll(".busy-guide-btn").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        const actionKey = event.target.dataset.actionKey;
        const pendingMsg = event.target.dataset.pendingMessage;
        await this.executeBusyGuideAction(actionKey, pendingMsg);
        // 移除按钮容器
        buttonContainer.remove();
      });
    });
    
    // 添加到消息祦
    log.appendChild(buttonContainer);
    
    // 滚动到底部?    log.scrollTop = log.scrollHeight;
  }

  /**
   * 鎵ц寮曞按钮动作ㄤ綔
   */
  async executeBusyGuideAction(actionKey, pendingMessage) {
    const conversation = this.currentConversation();
    
    try {
      const response = await fetchJson("/api/chat/queue/action", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          action_key: actionKey,
          conversation_id: conversation?.id || "",
          message: pendingMessage,
          user: {
            user_id: this.auth.userId || "guest",
            role: this.auth.roleKey || "elder"
          }
        })
      });
      
      if (response.ok) {
        const answer = response.answer || response.answer_text || "操作成功";
        this.addBubble("ai", answer);
      } else {
        this.addBubble("ai", `操作失败：${response.error?.message || "未知错误"}`, { error: true });
      }
    } catch (err) {
      this.addBubble("ai", `操作失败：${err.message}`, { error: true });
    }
  }

  currentThinkingName() {
    return "桂小养后端调度";
  }

  upsertTemplateTab(result) {
    if (!result) return;
    const key = result.tab?.reuse_key || result.skill_key || result.page?.schema || "remote_answer";
    const title = result.tab?.title || result.skill_title || result.page?.title || result.card?.title || "杩滅模板";
    const existing = this.state.templateTabs.find((item) => item.key === key);
    if (existing) {
      existing.title = title;
      existing.result = result;
      existing.updatedAt = Date.now();
    } else {
      this.state.templateTabs.unshift({ key, title, result, updatedAt: Date.now() });
    }
    this.state.templateTabs = this.state.templateTabs.slice(0, 8);
    this.state.activeTemplateKey = key;
  }

  renderTemplatePanel(result) {
    const panel = screen.querySelector("#mobileTemplatePanel");
    if (!panel) return;
    panel.classList.toggle("production-hidden", !this.state.debugEnabled);
    if (!this.state.debugEnabled) return;
    if (!result) {
      panel.innerHTML = `<strong>椤甸潰模板</strong><p>测试环显示ず杩滅鎶€鑳姐€佹ā来。€验证€输出按钮拰瀹¤閾捐矾锛涚敓浜х环境隐藏。€?/p>`;
      return;
    }
    const active = this.state.templateTabs.find((item) => item.key === this.state.activeTemplateKey) || this.state.templateTabs[0];
    const activeResult = active?.result || result;
    panel.innerHTML = `
      <div class="mobile-template-head">
        <strong>${escapeHtml(active?.title || activeResult.skill_title || "杩滅模板")}</strong>
        <span>${escapeHtml(activeResult.platform?.mode || "remote_agent")}</span>
      </div>
      <div class="mobile-template-tabs">
        ${this.state.templateTabs.map((tab) => `<button type="button" class="${tab.key === this.state.activeTemplateKey ? "active" : ""}" data-template-tab="${escapeHtml(tab.key)}">${escapeHtml(tab.title)}</button>`).join("")}
      </div>
      <div class="template-tags">
        <span>${escapeHtml(activeResult.intent || "UNKNOWN")}</span>
        <span>${escapeHtml(activeResult.skill_key || "UNKNOWN")}</span>
        <span>${escapeHtml(activeResult.template_key || "remote_answer")}</span>
      </div>
      ${this.renderRemoteEvidence(activeResult)}
      <button type="button" class="mobile-template-detail-button" id="mobileTemplateDetail">查看模板详情</button>
      ${this.renderOutputs(activeResult)}
      <div class="mobile-action-result" id="mobileActionResult"></div>
    `;
    panel.querySelectorAll("[data-template-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        this.state.activeTemplateKey = button.dataset.templateTab;
        this.renderTemplatePanel(activeResult);
      });
    });
    panel.querySelectorAll("[data-output-id]").forEach((button) => {
      button.addEventListener("click", () => this.handlePageOutput(button.dataset.outputId, activeResult));
    });
    panel.querySelector("#mobileTemplateDetail")?.addEventListener("click", () => this.openTemplateDetail(activeResult));
  }

  renderRemoteEvidence(result = {}) {
    const components = result.remote_components || [];
    const hits = result.kb_pre_retrieve?.hits || [];
    const trace = result.audit_trace || [];
    const platform = result.platform || {};
    const role = result.role_context || {};
    return `
      <div class="mobile-evidence">
        <strong>调试执行详情</strong>
        <dl>
          <div><dt>最终意图</dt><dd>${escapeHtml(result.intent || "UNKNOWN")}</dd></div>
          <div><dt>目标技能</dt><dd>${escapeHtml(result.skill_key || "UNKNOWN")}</dd></div>
          <div><dt>输出模板</dt><dd>${escapeHtml(result.template_key || "remote_answer")}</dd></div>
          <div><dt>目标智能体</dt><dd>${escapeHtml(String(result.target_agent_id || platform.agentId || "未返回"))}</dd></div>
          <div><dt>入口智能体</dt><dd>${escapeHtml(platform.agentId ? `space=${platform.spaceId || "-"} / agent=${platform.agentId}` : "未返回")}</dd></div>
          <div><dt>用户角色</dt><dd>${escapeHtml(`${role.title || result.role_key || "UNKNOWN"} / ${role.terminal || ""}`)}</dd></div>
          <div><dt>置信度</dt><dd>${escapeHtml(result.confidence == null ? "未返回" : `${Math.round(Number(result.confidence) * 100)}%`)}</dd></div>
          <div><dt>风险等级</dt><dd>${escapeHtml(result.risk_level || "未识别")}</dd></div>
        </dl>
        <p><b>路由原因</b>${escapeHtml(result.route_reason || "后端根据当前输入和模型响应完成调度。")}</p>
        ${trace.length ? `<ol>${trace.map((step) => `<li>${escapeHtml(debugTraceLabel(step))}</li>`).join("")}</ol>` : ""}
        ${hits.length ? `<div class="mobile-evidence-list"><b>知识命中</b>${hits.slice(0, 5).map((hit, index) => `<article><span>${index + 1}</span><p>${escapeHtml(hit.title || "未返回标题")}</p><em>${escapeHtml(debugScoreLabel(hit.score))}</em></article>`).join("")}</div>` : ""}
        ${components.length ? `<div class="mobile-evidence-list"><b>组件执行</b>${components.slice(0, 6).map((item) => `<article><span>${escapeHtml(item.type || "组件")}</span><p>${escapeHtml(item.name || `target=${item.targetId || "-"}`)}</p><em>${escapeHtml(debugStatusLabel(item.status))}${item.hits == null ? "" : ` / 命中${item.hits}`}</em></article>`).join("")}</div>` : ""}
      </div>
    `;
  }

  renderCard(card = {}) {
    if (!card) return "";
    const panels = card.workflow?.panels || [];
    return `
      <article class="mobile-result-card">
        <h3>${escapeHtml(card.title || "澶勭悊缁撴灉")}</h3>
        ${card.summary ? `<div class="markdown-body">${renderMarkdown(card.summary)}</div>` : ""}
        ${panels.length ? `<div class="mobile-workflow-panels">${panels.map((panel) => `<div><strong>${escapeHtml(panel.title)}</strong>${(panel.items || []).slice(0, 4).map((item) => `<small>${escapeHtml(item)}</small>`).join("")}</div>`).join("")}</div>` : ""}
      </article>
    `;
  }

  renderStructuredPage(page = {}) {
    const sections = page.sections || [];
    return `
      <article class="mobile-structured-page">
        <h3>${escapeHtml(page.title || "椤甸潰娴忚")}</h3>
        ${page.subtitle ? `<p>${escapeHtml(page.subtitle)}</p>` : ""}
        ${sections.map((section) => this.renderPageSection(section)).join("")}
      </article>
    `;
  }

  renderPageSection(section = {}) {
    if (section.type === "description_list") {
      return `
        <section class="mobile-page-section">
          <h4>${escapeHtml(section.title || "")}</h4>
          <dl>${(section.items || []).map((item) => `<div><dt>${escapeHtml(item.label || "")}</dt><dd>${escapeHtml(item.value || "")}</dd></div>`).join("")}</dl>
        </section>
      `;
    }
    return `
      <section class="mobile-page-section">
        <h4>${escapeHtml(section.title || "")}</h4>
        <div class="markdown-body">${section.type === "markdown" ? renderMarkdown(section.text || "") : `<p>${escapeHtml(section.text || "")}</p>`}</div>
      </section>
    `;
  }

  renderOutputs(result = {}) {
    const outputs = result.page?.outputs || result.outputs || [];
    if (!outputs.length) return "";
    return `<div class="mobile-output-actions">${outputs.map((output) => `<button type="button" data-output-id="${escapeHtml(output.id)}">${escapeHtml(output.label || output.type || "杈撳嚭")}</button>`).join("")}</div>`;
  }

  openTemplateDetail(result = {}) {
    const host = screen.querySelector("#mobileModalHost");
    const content = result.page ? this.renderStructuredPage(result.page) : this.renderCard(result.card);
    const answerText = sanitizeAssistantText(
      result.answer ||
      result.remote_text ||
      result.card?.summary ||
      result.page?.sections?.find((section) => section.id === "answer")?.text ||
      result.message ||
      ""
    );
    host.innerHTML = `
      <div class="mobile-modal-backdrop">
        <section class="mobile-dialog template-detail-dialog">
          <header><div><h2>椤甸潰模板</h2><p>${escapeHtml(result.template_key || "remote_answer")} 路 ${escapeHtml(result.skill_key || "UNKNOWN")}</p></div><button type="button" id="closeTemplateDetail">${mobileIconSvg("close")}</button></header>
          <div class="mobile-template-detail-body">
            ${answerText ? `<article class="mobile-result-card"><h3>杩滅原文</h3><div class="markdown-body">${renderMarkdown(answerText)}</div></article>` : ""}
            ${content}
            ${this.renderOutputs(result)}
            <div class="mobile-action-result" id="mobileActionResult"></div>
          </div>
        </section>
      </div>
    `;
    host.querySelector("#closeTemplateDetail")?.addEventListener("click", () => host.innerHTML = "");
    host.querySelector(".mobile-modal-backdrop")?.addEventListener("click", (event) => {
      if (event.target.classList.contains("mobile-modal-backdrop")) host.innerHTML = "";
    });
    host.querySelectorAll("[data-output-id]").forEach((button) => {
      button.addEventListener("click", () => this.handlePageOutput(button.dataset.outputId, result));
    });
  }

  async handlePageOutput(outputId, result = {}) {
    const output = (result.page?.outputs || result.outputs || []).find((item) => item.id === outputId);
    const target = screen.querySelector("#mobileActionResult");
    if (!output?.endpoint || !target) return;
    target.innerHTML = `<div class="inline-status">${escapeHtml(output.label || "杈撳嚭")}...</div>`;
    try {
      const payload = await fetchJson(output.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ text: output.payload?.text, page: result.page, result })
      });
      if (payload.output?.type === "speech") {
        const text = payload.output.text || "";
        this.speakText(text);
        target.innerHTML = `<div class="execution-card"><strong>${escapeHtml(output.label || "语音播报")}</strong><p>${escapeHtml(text)}</p></div>`;
        return;
      }
      if (payload.output?.type === "page") {
        target.innerHTML = this.renderStructuredPage(payload.output.page);
      }
    } catch (err) {
      target.innerHTML = `<div class="execution-card bad"><strong>${escapeHtml(output.label || "杈撳嚭")}</strong><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  openHistoryModal() {
    const host = screen.querySelector("#mobileModalHost");
    const items = this.state.conversations.length ? this.state.conversations.map((item) => `
      <div class="mobile-history-row-wrapper">
        <button type="button" class="mobile-history-row" data-open-conversation="${escapeHtml(item.id)}">
          <strong>${item.favorite ? "鈽?" : ""}${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.status)} 路 ${new Date(item.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
          <small>闂細${escapeHtml(item.latestQuestion || "暂无提问")}</small>
          <small>答：${escapeHtml(compactText(item.latestAnswer || "暂无答复", 42))}</small>
        </button>
        <button type="button" class="mobile-history-delete-btn" data-delete-conversation="${escapeHtml(item.id)}" aria-label="删除此对话"
          ${mobileIconSvg("close")}
        </button>
      </div>
    `).join("") : `<p class="history-empty">暂无对话记录</p>`;
    host.innerHTML = `
      <div class="mobile-modal-backdrop">
        <section class="mobile-dialog">
          <header><div><h2>对话记录</h2><p>鏈€近的对话、答复状态与收藏情况</p></div><button type="button" id="closeHistory">${mobileIconSvg("close")}</button></header>
          <div class="mobile-history-list">${items}</div>
        </section>
      </div>
    `;
    host.querySelector("#closeHistory")?.addEventListener("click", () => host.innerHTML = "");
    host.querySelector(".mobile-modal-backdrop")?.addEventListener("click", (event) => {
      if (event.target.classList.contains("mobile-modal-backdrop")) host.innerHTML = "";
    });
    host.querySelectorAll("[data-open-conversation]").forEach((button) => {
      button.addEventListener("click", () => {
        this.state.currentConversationId = button.dataset.openConversation;
        host.innerHTML = "";
        this.switchTab("chat");
        this.replayConversation();
        this.updateFavoriteButton();
      });
    });
    // 删除瀵硅瘽
    host.querySelectorAll("[data-delete-conversation]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const id = button.dataset.deleteConversation;
        this.deleteConversation(id);
      });
    });
  }

  toggleHistorySearchPanel() {
    const existing = screen.querySelector("#historySearchPanel");
    if (existing) { existing.remove(); return; }

    const conversations = this.state.conversations || [];
    const filterMatcher = (conv, query, filter) => {
      if (filter === "favorite" && !conv.favorite) return false;
      if (filter === "meal_plan" && !/膳食|饮食|meal|营养/i.test(conv.title + conv.latestQuestion)) return false;
      if (filter === "travel" && !/旅居|路线|旅游|travel|康养/i.test(conv.title + conv.latestQuestion)) return false;
      if (filter === "nearby" && !/周边|附近|nearby|配套/i.test(conv.title + conv.latestQuestion)) return false;
      if (!query) return true;
      const haystack = [conv.title, conv.latestQuestion, conv.latestAnswer, ...(conv.messages || []).map((m) => m.content || m.markdown || "")].join(" ").toLowerCase();
      return haystack.includes(query.toLowerCase());
    };

    const highlightText = (text, query) => {
      if (!query || !text) return escapeHtml(text || "");
      const escaped = escapeHtml(text);
      const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
      return escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
    };

    const renderResults = (query, filter) => {
      const filtered = conversations.filter((c) => filterMatcher(c, query, filter));
      if (!filtered.length) {
        return `<p class="history-search-empty">未找到匹配的对话</p>`;
      }
      return filtered.map((conv) => {
        const msgs = conv.messages || [];
        const matchedMsgs = query ? msgs.filter((m) => {
          const text = (m.content || m.markdown || "").toLowerCase();
          return text.includes(query.toLowerCase());
        }) : [];
        const msgPreview = matchedMsgs.length
          ? matchedMsgs.slice(0, 3).map((m) => `<small class="search-msg-preview">${highlightText(compactText(m.content || m.markdown || "", 80), query)}</small>`).join("")
          : `<small class="search-msg-preview">${escapeHtml(compactText(conv.latestAnswer || "暂无回复", 80))}</small>`;
        return `
          <div class="history-search-row" data-search-conversation="${escapeHtml(conv.id)}">
            <div class="history-search-header">
              <strong>${conv.favorite ? "★ " : ""}${highlightText(conv.title || "未命名对话", query)}</strong>
              <span class="history-search-date">${new Date(conv.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <small class="search-q">问：${highlightText(compactText(conv.latestQuestion || "暂无提问", 60), query)}</small>
            ${msgPreview}
            ${matchedMsgs.length ? `<span class="search-match-count">${matchedMsgs.length} 条匹配消息</span>` : ""}
          </div>
        `;
      }).join("");
    };

    const panel = document.createElement("div");
    panel.id = "historySearchPanel";
    panel.className = "history-search-overlay";
    panel.innerHTML = `
      <div class="history-search-panel" role="dialog" aria-label="历史对话搜索">
        <header class="history-search-top">
          <div class="history-search-input-wrap">
            <span class="history-search-icon">${mobileIconSvg("search")}</span>
            <input type="text" id="historySearchInput" placeholder="搜索对话内容、关键词..." autocomplete="off" />
          </div>
          <div class="history-search-filters">
            <button type="button" class="history-filter-btn active" data-filter="all">全部</button>
            <button type="button" class="history-filter-btn" data-filter="favorite">★ 收藏</button>
            <button type="button" class="history-filter-btn" data-filter="meal_plan">膳食</button>
            <button type="button" class="history-filter-btn" data-filter="travel">旅居</button>
            <button type="button" class="history-filter-btn" data-filter="nearby">周边</button>
          </div>
          <button type="button" id="closeHistorySearch" class="history-search-close" title="关闭 Ctrl+S">${mobileIconSvg("close")}</button>
        </header>
        <div class="history-search-meta">
          <span id="historySearchCount">${conversations.length} 条对话</span>
          <span class="history-search-tip">点击对话跳转 · Ctrl+S 切换 · Esc 关闭</span>
        </div>
        <div class="history-search-results" id="historySearchResults">${renderResults("", "all")}</div>
      </div>
    `;
    screen.appendChild(panel);

    const input = panel.querySelector("#historySearchInput");
    let currentFilter = "all";

    panel.querySelectorAll(".history-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        panel.querySelectorAll(".history-filter-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter;
        const query = input.value.trim();
        const html = renderResults(query, currentFilter);
        panel.querySelector("#historySearchResults").innerHTML = html;
        const filtered = conversations.filter((c) => filterMatcher(c, query, currentFilter));
        panel.querySelector("#historySearchCount").textContent = `${filtered.length} 条对话`;
        bindRowClicks();
      });
    });

    input.addEventListener("input", () => {
      const query = input.value.trim();
      const html = renderResults(query, currentFilter);
      panel.querySelector("#historySearchResults").innerHTML = html;
      const filtered = conversations.filter((c) => filterMatcher(c, query, currentFilter));
      panel.querySelector("#historySearchCount").textContent = `${filtered.length} 条对话`;
      bindRowClicks();
    });

    const closePanel = () => panel.remove();
    panel.querySelector("#closeHistorySearch").addEventListener("click", closePanel);
    panel.addEventListener("click", (e) => { if (e.target === panel) closePanel(); });
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); closePanel(); }
    });

    const bindRowClicks = () => {
      panel.querySelectorAll("[data-search-conversation]").forEach((row) => {
        row.addEventListener("click", () => {
          const id = row.dataset.searchConversation;
          const query = input.value.trim();
          this.state.currentConversationId = id;
          closePanel();
          this.switchTab("chat");
          this.replayConversation();
          this.updateFavoriteButton();
          if (query) {
            setTimeout(() => this._highlightSearchKeyword(query), 100);
          }
        });
      });
    };

    bindRowClicks();
    setTimeout(() => input.focus(), 50);
  }

  _highlightSearchKeyword(query) {
    if (!query) return;
    const bubbles = screen.querySelectorAll(".mobile-message-bubble .mobile-bubble-content");
    if (!bubbles.length) return;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    let firstMatch = null;
    bubbles.forEach((bubble) => {
      const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, null);
      const textNodes = [];
      let node;
      while ((node = walker.nextNode())) textNodes.push(node);
      textNodes.forEach((textNode) => {
        if (regex.test(textNode.textContent)) {
          const span = document.createElement("span");
          span.innerHTML = textNode.textContent.replace(regex, '<mark class="search-highlight-inline">$1</mark>');
          textNode.replaceWith(span);
          if (!firstMatch) firstMatch = span;
        }
      });
    });
    if (firstMatch) {
      firstMatch.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        screen.querySelectorAll(".search-highlight-inline").forEach((m) => {
          m.classList.add("fading");
          setTimeout(() => m.outerHTML = m.innerHTML, 3000);
        });
      }, 100);
    }
  }

  async deleteConversation(id) {
    const conversation = this.state.conversations.find((c) => c.id === id);
    if (!conversation) return;
    const questionPreview = (conversation.latestQuestion || conversation.title || "").slice(0, 30);
    if (!window.confirm(`确定删除对话「${questionPreview}」？此操作不可恢复。`)) return;
    this.state.conversations = this.state.conversations.filter((c) => c.id !== id);
    if (this.state.currentConversationId === id) {
      this.state.currentConversationId = this.state.conversations[0]?.id || null;
      if (this.state.currentConversationId) {
        this.replayConversation();
      } else {
        this.startNewConversation({ render: true });
      }
    }
    this.persistHistory();
    // 从后端删除。
    try {
      await fetch(`/api/conversation/delete/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (e) {
      console.warn("[Mobile][ConversationHistory] 后端删除失败:", e.message);
    }
    // 同步录制
    try {
      await fetch("/api/conversation/harvest-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id }),
      });
    } catch (e) {
      console.warn("[Mobile][ConversationHistory] 录制同步失败:", e.message);
    }
    this.openHistoryModal();
  }

  toggleFavorite() {
    const conversation = this.currentConversation();
    if (!conversation) return;
    conversation.favorite = !conversation.favorite;
    conversation.updatedAt = Date.now();
    this.persistHistory();
    this.updateFavoriteButton();
  }

  updateFavoriteButton() {
    const button = screen.querySelector("#mobileFavorite");
    const conversation = this.currentConversation();
    button?.classList.toggle("active", Boolean(conversation?.favorite));
  }

  toggleAutoSpeech() {
    this.state.autoSpeech = !this.state.autoSpeech;
    localStorage.setItem(STORAGE_AUTO_SPEECH, String(this.state.autoSpeech));
    screen.querySelector("#mobileAutoSpeech")?.classList.toggle("active", this.state.autoSpeech);
  }

  speakLatestAnswer() {
    const text = this.state.latestAnswer || this.currentConversation()?.latestAnswer || "";
    if (!text) {
      this.addBubble("ai", "当前还没有可播报的答复。");
      return;
    }
    this.speakText(text, { toggle: true });
  }

  isSpeechActive() {
    const synth = window.speechSynthesis;
    return Boolean(this.currentSpeechUtterance || (synth && (synth.speaking || synth.pending)));
  }

  stopSpeech() {
    const synth = window.speechSynthesis;
    if (synth) {
      synth.cancel();
    }
    this.currentSpeechUtterance = null;
  }

  preferredSpeechVoice(lang = "zh-CN") {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    return voices.find((voice) => voice.lang === lang) ||
      voices.find((voice) => String(voice.lang || "").toLowerCase().startsWith("zh")) ||
      null;
  }

  speakText(text, { toggle = false, lang = "zh-CN" } = {}) {
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      this.addBubble("ai", "当前浏览器不支持语音播报。");
      return;
    }
    if (toggle && this.isSpeechActive()) {
      this.stopSpeech();
      return;
    }
    this.stopSpeech();
    const utterance = new SpeechSynthesisUtterance(String(text || "").replace(/\s+/g, " ").slice(0, 800));
    const voice = this.preferredSpeechVoice(lang);
    if (voice) utterance.voice = voice;
    utterance.lang = lang;
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onend = () => {
      if (this.currentSpeechUtterance === utterance) this.currentSpeechUtterance = null;
    };
    utterance.onerror = () => {
      if (this.currentSpeechUtterance === utterance) this.currentSpeechUtterance = null;
    };
    this.currentSpeechUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  async startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const input = screen.querySelector("#mobileChatInput");
    const button = screen.querySelector("#mobileVoiceButton");
    const securityMessage = voiceSecurityMessage();
    if (securityMessage) {
      this.resetVisibleVoiceInput({ focus: true });
      this.addBubble("ai", securityMessage, { error: true });
      return;
    }
    if (!SpeechRecognition || !input) {
      await this.startServerVoiceInput({ reason: "当前浏览器不支持在线语音识别" });
      return;
    }
    if (this.state.sending) {
      this.showToast("消息处理中，请稍后再使用语音");
      return;
    }
    if (this.state.recognizing) {
      this.stopVisibleVoiceInput();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = true;
    let finalTranscript = input.value.trim();
    let submitted = false;
    this.state.recognizing = true;
    this.voiceRecognition = recognition;
    button?.classList.add("listening");
    recognition.onresult = (event) => {
      let interimTranscript = "";
      let receivedFinal = false;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript || "";
        if (event.results[index].isFinal) {
          finalTranscript = `${finalTranscript} ${transcript}`.trim();
          receivedFinal = true;
        } else {
          interimTranscript += transcript;
        }
      }
      input.value = `${finalTranscript} ${interimTranscript}`.trim();
      if (this.state.sending || !receivedFinal || submitted) return;
      const parsed = parseVoiceSubmitCommand(input.value);
      if (!parsed.shouldSubmit) return;
      submitted = true;
      input.value = parsed.text;
      recognition.stop();
      if (parsed.text) window.setTimeout(() => {
        if (!this.state.sending && input.value.trim() === parsed.text) this.sendMessage(parsed.text);
      }, 120);
    };
    recognition.onerror = (event) => {
      const error = event?.error || "识别失败";
      if (error === "network") {
        this.state.speechNetworkUnavailable = true;
        this.resetVisibleVoiceInput({ focus: true });
        this.startServerVoiceInput({ reason: "浏览器在线语音识别服务连接失败" });
        return;
      }
      const message = ["not-allowed", "service-not-allowed"].includes(error)
        ? "浏览器未授予麦克风权限。请确认当前页面使用 HTTPS/localhost，并在地址栏允许麦克风。"
        : `语音输入未完成：${error}`;
      this.addBubble("ai", message, { error: true });
    };
    recognition.onend = () => {
      this.resetVisibleVoiceInput({ focus: true });
    };
    try {
      recognition.start();
    } catch {
      this.resetVisibleVoiceInput({ focus: true });
      this.addBubble("ai", "语音输入启动失败，请稍后再试。");
    }
  }

  async startServerVoiceInput({ reason = "正在使用服务器语音识别" } = {}) {
    const input = screen.querySelector("#mobileChatInput");
    if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
      this.addBubble("ai", `${reason}，但当前浏览器不支持录音上传。请直接输入文字。`, { error: true });
      return;
    }
    if (this.state.sending || this.state.recordingServerVoice) return;
    this.state.recordingServerVoice = true;
    this.addBubble("ai", `${reason}，已切换为服务器 ASR。请在 6 秒内重新说出需求，我会自动识别并提交。`);
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioBase64 = await recordWavDataUrl(stream, 6000);
      const payload = await fetchJson("/api/input/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          audioBase64,
          audioFormat: "wav",
          conversationId: this.currentConversation()?.id || "",
          conversationHistory: this.conversationContext(),
          roleKey: this.auth.roleKey,
          channel: "mobile",
          userToken: this.auth.token,
          elderScope: this.auth.elderScope,
          terminal: this.auth.terminal,
          authLevel: this.auth.authLevel,
          userName: this.auth.userName,
          orgName: this.auth.orgName,
          presetKey: this.auth.presetKey
        })
      });
      if (payload.input?.text) {
        if (input) input.value = payload.input.text;
        this.addBubble("ai", `已识别：${payload.input.text}`);
      } else if (payload.input?.voiceOk === false) {
        this.addBubble("ai", `语音暂未识别出有效文字。请靠近麦克风、说完整一句后再试，或直接输入文字。${payload.input.warning ? `（${payload.input.warning}）` : ""}`, { error: true });
      }
      if (payload.result) this.addAssistantResult(payload.result);
    } catch (err) {
      this.addBubble("ai", `服务器语音识别未完成：${err.message}。请再试一次或直接输入文字。`, { error: true });
    } finally {
      stream?.getTracks?.().forEach((track) => track.stop());
      this.state.recordingServerVoice = false;
      this.resetVisibleVoiceInput({ focus: true });
    }
  }

  async handleImageInput(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    this.ensureConversation();
    try {
      const imageBase64 = await imageFileToDataUrl(file);
      this.appendImageBubble({ fileName: file.name || "现场拍照", imageBase64, status: "图片已上传，正在 OCR 识别，请稍候" });
      this.addBubble("ai", "正在读取图片并进行 OCR 识别，请稍候...", { pending: true });
      const normalizedPayload = await fetchJson("/api/input/ocr/normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          imageBase64,
          fileName: file.name,
          roleKey: this.auth.roleKey,
          channel: "mobile",
          userToken: this.auth.token,
          elderScope: this.auth.elderScope,
          terminal: this.auth.terminal,
          authLevel: this.auth.authLevel,
          userName: this.auth.userName,
          orgName: this.auth.orgName,
          presetKey: this.auth.presetKey
        })
      });
      if (normalizedPayload.input?.ocrOk && normalizedPayload.input?.text) {
        const formattedText = normalizedPayload.input.formattedText || normalizedPayload.input.text;
        const input = screen.querySelector("#mobileChatInput");
        if (input) input.value = formattedText;
        this.updateLastImageStatus("OCR 解析完成，已整理到输入框", "done");
        this.updateLastAiBubble("OCR 解析完成，已将识别结果整理到输入框，正在提交处理。");
        await this.sendMessage(formattedText);
      } else if (normalizedPayload.input) {
        this.updateLastImageStatus("OCR 未识别出有效文字", "error");
        this.updateLastAiBubble(`图片已上传，但 OCR 在多次解析后仍未识别出有效文字。请补充说明图片内容，或重新上传更清晰的图片。已等待约 ${Math.round((normalizedPayload.input.elapsedMs || 0) / 1000)} 秒。`);
      }
    } catch (err) {
      this.updateLastImageStatus("OCR 识别失败，请重试", "error");
      this.updateLastAiBubble(`\u5efa\u8bae\u5904\u7406\u5f02\u5e38\uff1a${err.message}`, { error: true });
    } finally {
      event.target.value = "";
    }
  }

  async checkHealth() {
    try {
      const payload = await fetchJson("/api/health");
      this.state.health = payload;
    } catch (err) {
      this.state.health = null;
    }
  }
}

window.FlatTalkMobileApp = new MobileApp();

// 卡片内按钮（如行程卡「查看天气风险」）通过 postMessage 触发技能动作。
// 卡片运行在同源 iframe（srcdoc）中，可直接向父窗口发消息；此处分发到 handleAssistantAction。
window.addEventListener('message', (event) => {
  try {
    const data = event.data;
    const app = window.FlatTalkMobileApp;
    if (!data || !app) return;
    if (data.type === 'flattalk_phone_dial' && typeof app.handlePhoneDial === 'function') {
      app.handlePhoneDial(data.phone || '');
      return;
    }
    if (data.type === 'flattalk_open_map') {
      // 腾讯地图 URI API 调起：新窗口打开（移动端自动调起地图 App）
      if (data.url) window.open(data.url, '_blank');
      return;
    }
    if (data.type === 'flattalk_pick_location' && data.location) {
      // 用户在地图上选点 → 更新缓存 + 重新发送"周边资源"请求
      try {
        var loc = data.location;
        loc.ts = Date.now();
        localStorage.setItem('flattalk_location', JSON.stringify(loc));
      } catch {}
      if (app) {
        app.state.location = data.location;
        if (typeof app.sendMessage === 'function') {
          app.sendMessage('看看我选的位置周边有什么资源');
        }
      }
      return;
    }
    if (data.type !== 'flattalk_card_action') return;
    if (app && typeof app.handleAssistantAction === 'function') {
      app.handleAssistantAction({
        action_key: data.action_key || '',
        skill_key: data.skill_key || '',
        label: data.label || '',
        user_prompt: data.user_prompt || '',
        params: data.params || {},
      }, null);
    }
  } catch (e) { /* 忽略卡片消息异常 */ }
});

const mojibakeObserver = new MutationObserver(() => scrubVisibleMojibake(screen));
mojibakeObserver.observe(screen, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["placeholder", "aria-label", "title", "value"],
});
window.FlatTalkMobileApp.start();
