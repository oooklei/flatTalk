const screen = document.querySelector(".phone-screen");
const params = new URLSearchParams(location.search);
if (params.get("frame") === "1") document.body.classList.add("frame-preview");

const AUTH_KEYS = ["token", "userToken", "roleKey", "elderScope", "terminal", "authLevel", "userName", "orgName", "presetKey"];
const STORAGE_AUTH = "gxy_mobile_auth";
const STORAGE_HISTORY = "gxy_mobile_conversations";
const STORAGE_AUTO_SPEECH = "gxy_mobile_auto_speech";
const STORAGE_DEBUG_MODE = "gxy_debug_mode";
const STORAGE_FLOATING_SPEAK = "gxy_mobile_floating_speak_position";
const MAX_HISTORY = 30;
const INPUT_HISTORY_LIMIT = 40;
const VOICE_SUBMIT_COMMANDS = [
  "发送",
  "请发送",
  "请提交",
  "帮我发送",
  "帮我提交",
  "确认发送",
  "确认提交",
  "确定",
  "确定了",
  "发送一下",
  "提交一下",
  "发送吧",
  "提交吧",
  "提交",
  "结束输入",
  "结束了",
  "结束",
  "说完了",
  "我说完了",
  "好了",
  "好啦",
  "可以了",
  "得了",
  "就这样",
  "行了",
  "开始",
  "OK",
  "O了"
].sort((a, b) => b.length - a.length);
function isLocalSecureException(hostname = location.hostname) {
  // localhost 和回环地址
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return true;
  // 局域网 IP 地址（开发环境允许）
  const isPrivateIP = /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/.test(hostname);
  if (isPrivateIP) return true;
  return false;
}

function voiceSecurityMessage() {
  if (window.isSecureContext || isLocalSecureException()) return "";
  const httpsPort = location.port === "5177" ? "5443" : location.port;
  const httpsHost = `${location.hostname}${httpsPort ? `:${httpsPort}` : ""}`;
  const httpsUrl = `https://${httpsHost}${location.pathname}${location.search}`;
  return `当前是 ${location.origin}，浏览器只允许在 HTTPS 或 localhost 中持续使用麦克风。请运行 npm run start:https 后改用 ${httpsUrl} 访问，首次打开时信任本机证书后再点击语音输入。`;
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
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
  "travel_route.replan": "重新规划路线",
  "travel_route.fill_preferences": "补充出行偏好",
  "travel_route.view_detail": "查看行程详情",
  "travel_route.check_availability": "检查可订状态",
  "travel_route.booking_handoff": "提交预订交接",
  "travel_route.open_workbench": "打开路线工作台",
  "travel_route.compare_destinations": "对比目的地",
  "travel_route.view_base_profile": "查看基地详情",
  "travel_route.check_health_safety": "检查健康安全",
  "travel_route.check_weather_risk": "检查天气风险",
  "travel_route.calculate_budget": "测算旅居预算",
  "travel_route.plan_transport": "规划交通接驳",
  "travel_route.adjust_pace": "调整行程节奏",
  "travel_route.generate_packing_list": "生成行李清单",
  "travel_route.view_product_detail": "查看产品详情",
  "travel_route.preview_order": "预览预订订单",
  "travel_route.submit_payment": "提交付款确认",
  "travel_route.cancel_or_change": "取消或改期",
  "travel_route.notify_family": "通知家属",
  "travel_route.export_family_brief": "生成家属简报",
  "travel_route.contact_base": "联系康养基地",
  "travel_route.check_policy_subsidy": "查询政策补贴",
  "travel_route.find_nearby_medical": "查找附近医疗资源",
  "travel_route.check_accessibility": "检查无障碍条件",
  "travel_route.recommend_season": "推荐适宜季节",
  "travel_route.fallback_status": "查看路线兜底状态",
  "travel_route.collect_feedback": "收集旅居反馈",
  "travel_route.view_status": "查看路线状态",
  "travel_route.request_manual_review": "请求人工复核",
  "health_risk.call_120": "拨打 120",
  "health_risk.contact_family": "联系家属",
  "health_risk.dispatch_emergency": "派发紧急工单",
  "health_risk.mark_safe": "标记已安全",
  "health_risk.request_doctor_review": "请求医生复核",
  "health_risk.open_monitoring": "查看健康监测",
};

function localizeActionItem(item = {}) {
  const label = ACTION_LABELS_ZH[item.action_key || item.actionKey || ""];
  return label ? { ...item, label } : item;
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

function initials(name = "桂") {
  return String(name || "桂").slice(0, 1);
}

function compactText(text = "", max = 54) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function sanitizeAssistantText(text = "") {
  return String(text || "")
    // 清除安全边界标记
    .replace(/\[SECURITY_BOUNDARY_START\][\s\S]*?\[SECURITY_BOUNDARY_END\]/gi, "")
    // 清除 IMPORTANT 等提示
    .replace(/IMPORTANT:\s*Content from tool outputs[\s\S]*?(?=\n{2,}|$)/gi, "")
    .replace(/Tool Use Formatting[\s\S]*?Final Output Rules/gi, "")
    .replace(/Technical tags are prohibited from being displayed to users\./gi, "")
    // 清除工具标签
    .replace(/<\/?(?:tool|tools|name|description|arguments|tool_use)>/gi, "")
    // 清除 JSON 代码块中的 actions
    .replace(/```(?:json)?\s*{\s*"actions"\s*:\s*[\s\S]*?}\s*```/gi, "")
    // 清除执行动作提示
    .replace(/(?:^|\n)\s*(?:即将执行动作|执行动作)\s*[:：]?\s*[\s\S]*?(?=\n{2,}|$)/g, "")
    .replace(/(?:^|\n)\s*(?:---\s*)?(?:\*\*)?后续(?:您)?可以继续(?:追问|询问)(?:\*\*)?\s*[:：]?\s*[\s\S]*?(?=\n{2,}(?!\s*(?:\d+\.|[-*]\s))|$)/g, "")
    .replace(/^\s*(?:即将执行动作|执行动作)\s*[:：]?.*$/gmi, "")
    .replace(/(?:^|\n)\s*(?:---\s*)?(?:\*\*)?后续(?:您)?可以继续(?:追问|询问)(?:\*\*)?\s*[:：]?[\s\S]*$/g, "")
    .replace(/^\s*→?\s*action_key\s*[:：]\s*[a-zA-Z0-9_.-]+\s*$/gmi, "")
    // ========== 新增：清除 task-result 和相关标签 ==========
    // 清除 <task-result> 标签及其内容
    .replace(/<task-result>[\s\S]*?<\/task-result>/gi, "")
    // 清除 <file> 标签
    .replace(/<file>[\s\S]*?<\/file>/gi, "")
    // 清除 <markdown-custom-process> 标签
    .replace(/<markdown-custom-process[^>]*>[\s\S]*?<\/markdown-custom-process>/gi, "")
    // 清除独立的 task-result 关键词
    .replace(/\btask-result\b/gi, "")
    // 清除技能名称泄露（如 meal_plan）
    .replace(/^\s*(?:Skill|Intent|Template|Agent|Confidence)\s*\n/gim, "")
    // 清除调测信息行
    .replace(/^\s*Skill\s*[a-zA-Z0-9_\-]+\s*$/gim, "")
    .replace(/^\s*Intent\s*[A-Z_]+\s*$/gim, "")
    .replace(/^\s*Template\s*[a-zA-Z0-9_.\-]+\s*$/gim, "")
    .replace(/^\s*Agent\s*\d+\s*$/gim, "")
    .replace(/^\s*Confidence\s*[\d.]+\s*$/gim, "")
    // 清除多余空行
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function roleTitle(user = {}, auth = {}) {
  return user.role_name || auth.roleName || auth.roleKey || "老人/家属";
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
  if (!html.includes("gxy-html-fallback") || !html.includes("data-renderer=")) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
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
    tab_focus: "页签聚焦",
    kb_pre_retrieve: "知识预检索",
    yz365_check_detail: "云诊数据查询",
    health_runtime_injection: "健康数据注入"
  };
  return labels[step] || step || "未知步骤";
}

function parseVoiceSubmitCommand(text = "") {
  const normalized = String(text || "").replace(/[，。！？,.!?；;]/g, " ").replace(/\s+/g, " ").trim();
  for (const command of VOICE_SUBMIT_COMMANDS) {
    const lower = command.toLowerCase();
    const current = normalized.toLowerCase();
    if (current === lower) return { shouldSubmit: true, text: "" };
    if (current.endsWith(` ${lower}`) || current.endsWith(lower)) {
      const index = current.lastIndexOf(lower);
      const before = normalized.slice(0, index).trim();
      return { shouldSubmit: before.length > 0, text: before };
    }
  }
  return { shouldSubmit: false, text: normalized };
}

async function fetchJson(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    const reason = err?.message || "network_error";
    throw new Error(`BFF接口不可达或请求被中断：${reason}`);
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
  if (!res.ok && !body?.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  return body || {};
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function audioBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("语音读取失败"));
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
  if (rms < 0.001) throw new Error("未检测到明显语音，请靠近麦克风后再试");
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
      conversations: safeJson(localStorage.getItem(STORAGE_HISTORY), []),
      currentConversationId: null,
      latestResult: null,
      latestAnswer: "",
      recognizing: false,
      sending: false,
      inputHistory: [],
      inputHistoryIndex: -1,
      templateTabs: [],
      activeTemplateKey: "",
      health: null,
      autoSpeech: localStorage.getItem(STORAGE_AUTO_SPEECH) === "true",
      debugEnabled: localStorage.getItem(STORAGE_DEBUG_MODE) === "true"
    };
    this.currentSpeechUtterance = null;
  }

  async start() {
    this.state.config = await fetchJson("/api/client-config").catch(() => this.state.config);
    if (localStorage.getItem(STORAGE_DEBUG_MODE) == null) {
      this.state.debugEnabled = this.state.config.production !== true && this.state.config.showTemplatePanel !== false;
    }
    if (!this.auth.token && !this.auth.roleKey) {
      this.renderLogin();
      return;
    }
    await this.loadBootstrap();
    // 如果本地无对话历史，从后端加载
    if (this.state.conversations.length === 0) {
      await this._loadConversationsFromBackend();
    }
    this.renderShell();
    this.checkHealth();
    // 退出/关闭时同步
    window.addEventListener("beforeunload", () => this._syncToBackend(true));
    window.addEventListener("pagehide", () => this._syncToBackend(true));
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
        if (loaded.length > 0) this.state.conversations = loaded;
      }
    } catch (e) {
      console.warn("[Mobile][ConversationHistory] 后端加载失败:", e.message);
    }
  }

  renderLogin() {
    const presets = this.state.config.devSsoPresets || [];
    // 随机选中一个非管理员预设
    const nonAdmin = presets.filter((p) => p.roleKey !== "system_admin" && p.role_key !== "system_admin");
    const randomPreset = nonAdmin.length > 0 ? nonAdmin[Math.floor(Math.random() * nonAdmin.length)] : presets[0];
    const selectedKey = randomPreset?.key || "";
    const buttons = presets.map((preset) => {
      const isActive = preset.key === selectedKey;
      return `
      <button type="button" class="preset-button ${isActive ? "selected" : ""}" data-preset-key="${escapeHtml(preset.key)}">
        <strong>${escapeHtml(preset.userName || preset.label)}</strong>
        <span>${escapeHtml(preset.label)} · ${escapeHtml(preset.orgName || "")}</span>
      </button>`;
    }).join("");
    screen.classList.remove("mobile-app");
    screen.innerHTML = `
      <section class="login-page">
        <div class="login-card">
          <h1>桂小养移动端</h1>
          <p>请选择联调身份进入。生产环境由业务系统 SSO 注入身份与 token。</p>
          ${buttons || `<p class="muted">未读取到联调身份，请从 PC 端带入 SSO 参数打开。</p>`}
          <form class="mobile-login-form" id="manualLoginForm">
            <input id="manualToken" placeholder="业务系统 SSO token" />
            <input id="manualRoleKey" placeholder="roleKey，如 elder_family" value="elder_family" />
            <input id="manualElderScope" placeholder="elderScope" value="elder_huang_xiuying" />
            <button type="submit">使用 SSO 参数进入</button>
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

  authFromLogin(body) {
    return {
      token: body.userToken,
      userToken: body.userToken,
      roleKey: body.roleKey,
      elderScope: body.elderScope,
      terminal: body.terminal,
      authLevel: body.authLevel,
      userName: body.userName,
      orgName: body.orgName,
      presetKey: body.presetKey
    };
  }

  query() {
    return new URLSearchParams({
      token: this.auth.token || this.auth.userToken || "",
      roleKey: this.auth.roleKey || "",
      elderScope: this.auth.elderScope || "",
      terminal: this.auth.terminal || "",
      authLevel: this.auth.authLevel || "",
      userName: this.auth.userName || "",
      orgName: this.auth.orgName || "",
      presetKey: this.auth.presetKey || ""
    }).toString();
  }

  async loadBootstrap() {
    this.state.bootstrap = await fetchJson(`/api/mobile-bootstrap?${this.query()}`);
    const profile = this.state.bootstrap.profile;
    this.auth = {
      ...this.auth,
      token: profile.user.token,
      userToken: profile.user.token,
      roleKey: profile.user.role_key,
      elderScope: profile.user.elder_scope,
      terminal: profile.user.terminal,
      authLevel: profile.user.auth_level,
      userName: profile.user.real_name,
      orgName: profile.user.org_name
    };
    saveAuth(this.auth);
  }

  _getGreeting() {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return "早上好";
    if (hour >= 12 && hour < 14) return "中午好";
    if (hour >= 14 && hour < 18) return "下午好";
    return "晚上好";
  }

  renderShell() {
    const { profile } = this.state.bootstrap;
    const userName = profile.user.real_name || "用户";
    const greeting = this._getGreeting();
    const weatherText = "今日天气晴 26°C 适合散步";
    screen.classList.add("mobile-app");
    screen.innerHTML = `
      <header class="mobile-header">
        <div class="header-top">
          <span class="user-name">桂小养</span>
        </div>
        <div class="greeting-text">${greeting}，${escapeHtml(userName)}</div>
        <div class="weather-info">${weatherText}</div>
      </header>
      <main class="page-stack">
        <section class="page active" data-page="home"></section>
        <section class="page" data-page="chat"></section>
        <section class="page" data-page="service"></section>
        <section class="page" data-page="profile"></section>
      </main>
      <button type="button" id="floatingSpeakButton" class="floating-speak-button" aria-label="语音播报">${mobileIconSvg("speaker")}</button>
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
    // ★ Ctrl+Z 弹出登录用户列表（所有页面统一）
    // ★ Ctrl+X 切换生产/调测开关（右侧调测卡片）
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        this.toggleDevDrawer();
      } else if (e.ctrlKey && (e.key === "x" || e.key === "X")) {
        e.preventDefault();
        this.toggleDebugSidePanel();
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
    // ★ 双击重置位置：清除 localStorage 保存的位置，回到默认左下角
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
    const emojiIcons = { home: "🏠", service: "📦", profile: "👤" };
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

  // ★ Ctrl+X 切换调测信息浮窗（可拖拽，不覆盖对话区）
  async toggleDebugSidePanel() {
    const existing = document.querySelector(".mobile-debug-side-panel");
    if (existing && existing.classList.contains("open")) {
      this.closeDebugSidePanel();
      return;
    }
    // 先确保 health 信息存在（含 baseUrl / model / agentId 等）
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

  // ★ 浮窗拖拽逻辑（头部 .debug-side-head 作为手柄）
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
      // 点击关闭按钮不触发拖拽
      if (event.target.closest(".debug-side-close")) return;
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

  // ★ 渲染右侧调测信息卡片（对比 PC 版字段，TOP 区显示远端端口/模型/agentId/skill_id）
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

    // TOP 区：BFF 地址 / 远端地址（IP:端口）/ 当前模型 / agentId / skill_id
    const bffInfo = health.bff || {};
    const bffEndpoint = bffInfo.endpoint || (bffInfo.host && bffInfo.port ? `${bffInfo.host}:${bffInfo.port}` : "-");
    const baseUrl = platform.baseUrl || resultPlatform.baseUrl || "";
    const remoteEndpoint = baseUrl ? baseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "-";
    const modelInfo = platform.model || {};
    const modelName = modelInfo.name || modelInfo.model || "-";
    const modelId = modelInfo.model || "-";
    const agentId = resultPlatform.agentId || result.target_agent_id || "-";
    const skillId = result.skill_key || "-";

    // 路由信息（对比 PC 版）
    const routeItems = [
      ["最终意图", result.intent || "UNKNOWN"],
      ["目标技能", result.skill_key || "UNKNOWN"],
      ["输出模板", result.template_key || "remote_answer"],
      ["目标智能体", result.target_agent_id || resultPlatform.agentId || "未返回"],
      ["用户角色", `${role.title || result.role_key || "UNKNOWN"} / ${role.terminal || ""}`],
      ["置信度", result.confidence == null ? "未返回" : `${Math.round(Number(result.confidence) * 100)}%`],
      ["风险等级", result.risk_level || "未识别"],
      ["入口智能体", resultPlatform.agentId ? `space=${resultPlatform.spaceId || "-"} · agent=${resultPlatform.agentId}` : "未返回"]
    ];

    const trace = result.audit_trace || [];
    const kbHits = result.kb_pre_retrieve?.hits || [];
    const components = result.remote_components || [];
    const warnings = result.warnings || [];
    const requestId = result.request_id || "无请求号";

    panel.innerHTML = `
      <div class="debug-side-head">
        <strong>调测信息</strong>
        <button type="button" class="debug-side-close" title="关闭（Ctrl+X）">${mobileIconSvg("close")}</button>
      </div>
      <div class="debug-side-body">
        <div class="debug-side-request">请求号：${escapeHtml(requestId)}</div>
        <div class="debug-side-top">
          <div class="debug-side-top-item">
            <span class="label">BFF 地址</span>
            <span class="value" title="${escapeHtml(bffEndpoint)}">${escapeHtml(bffEndpoint)}</span>
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
          <p class="debug-side-reason">${escapeHtml(result.route_reason || "后端根据当前输入和远端响应完成调度。")}</p>
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
                  <div><span>${escapeHtml(hit.kb_type || "知识库")}</span><p>${escapeHtml(hit.title || "未返回标题")}</p></div>
                  <em>${escapeHtml(debugScoreLabel(hit.score))}</em>
                </article>
              `).join("")}
            </div>
          </div>
        ` : ""}
        ${components.length ? `
          <div class="debug-side-section">
            <div class="debug-side-section-title">远端组件执行（${Math.min(8, components.length)}/${components.length}）</div>
            <div class="debug-side-list">
              ${components.slice(0, 8).map((item) => `
                <article>
                  <span>${escapeHtml(item.type || "Component")}</span>
                  <p>${escapeHtml(item.name || `target=${item.targetId || "-"}`)}</p>
                  <em>${escapeHtml(debugStatusLabel(item.status))}${item.hits == null ? "" : ` · 命中${item.hits}`}</em>
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
          <div class="debug-side-empty">尚无调测数据，发起一次对话后再按 Ctrl+X 查看。</div>
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
        <p>点击用户切换身份（Ctrl+Z 开关 · Ctrl+X 调测信息）</p>
      </div>
      <div class="dev-drawer-body">
        <div class="dev-drawer-section-title">预制用户列表</div>
        ${presets.map((p) => `
          <div class="dev-preset-item ${p.key === currentPreset ? "active" : ""}" data-preset-key="${p.key}">
            <div class="dev-preset-badge terminal-${p.terminal || "C"}">${(p.userName || "?").slice(0, 1)}</div>
            <div class="dev-preset-info">
              <div class="name">${escapeHtml(p.userName || "")}</div>
              <div class="meta">${escapeHtml(p.label || "")} · ${terminalLabel[p.terminal] || p.terminal || ""}</div>
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
          <span class="card-icon">❤️</span>
          <span class="card-label">健康监测</span>
        </button>
        <button type="button" class="func-card card-meal" data-func="diet">
          <span class="card-icon">🍲</span>
          <span class="card-label">膳食推荐</span>
        </button>
      </div>
      <div class="home-section-title">常用服务</div>
      <div class="quick-actions">
        <button type="button" class="quick-btn" data-func="search"><span class="quick-btn-icon">🔍</span><span class="quick-btn-text">找服务</span></button>
        <button type="button" class="quick-btn" data-func="policy"><span class="quick-btn-icon">📋</span><span class="quick-btn-text">查政策</span></button>
        <button type="button" class="quick-btn" data-func="travel"><span class="quick-btn-icon">✈️</span><span class="quick-btn-text">旅居规划</span></button>
      </div>
      <div class="ai-entry-bar" id="mobileAiEntry">
        <div class="ai-avatar-sm">🤖</div>
        <div class="ai-entry-placeholder">有什么想说的，直接说...</div>
        <div class="ai-entry-mic">🎤</div>
      </div>
    `;
    // 功能卡片点击
    page.querySelectorAll("[data-func]").forEach((card) => {
      card.addEventListener("click", () => {
        const func = card.dataset.func;
        if (func === "health") { this.switchTab("chat"); this.sendMessage("查看健康监测数据"); }
        else if (func === "diet") { this.switchTab("chat"); this.sendMessage("推荐今日膳食"); }
        else if (func === "search") { this.switchTab("chat"); this.sendMessage("找服务"); }
        else if (func === "policy") { this.switchTab("chat"); this.sendMessage("查政策"); }
        else if (func === "travel") { this.switchTab("chat"); this.sendMessage("帮我规划旅居路线"); }
      });
    });
    // AI入口条点击进入对话
    page.querySelector("#mobileAiEntry")?.addEventListener("click", () => {
      this.switchTab("chat");
    });
  }

  renderService() {
    const page = screen.querySelector('[data-page="service"]');
    const data = this.state.bootstrap;
    page.innerHTML = `
      <div class="section-heading-row">
        <h2 class="section-title">服务</h2>
        <button type="button" class="small-icon-button" id="refreshMessages">${mobileIconSvg("refresh")}<span>刷新</span></button>
      </div>
      <div class="summary-row two">
        <div class="summary-card"><strong>${data.messages.filter((item) => item.read_status === "unread").length}</strong><span>未读</span></div>
        <div class="summary-card"><strong>${data.todos.length}</strong><span>待办</span></div>
      </div>
      ${this.renderList(data.messages, "暂无消息", "message")}
      <h2 class="section-title">订单与工单</h2>
      ${this.renderList([...data.orders, ...data.workOrders], "暂无订单工单", "order")}
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
    const { profile } = this.state.bootstrap;
    const page = screen.querySelector('[data-page="profile"]');
    page.innerHTML = `
      <h2 class="section-title">服务档案</h2>
      ${this.renderArchive(profile)}
      <h2 class="section-title">授权老人</h2>
      ${this.renderList(profile.elders, "暂无授权老人", "elder")}
      <button type="button" class="quick-card logout-card" id="logoutMobile"><strong>退出当前身份</strong><span>返回联调登录</span></button>
    `;
    page.querySelector("#logoutMobile")?.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_AUTH);
      this.auth = {};
      this.renderLogin();
    });
  }

  renderArchive(profile) {
    const user = profile.user;
    const privateFields = user.terminal === "B"
      ? [["管理机构", user.org_name], ["服务床位", "128 张，当前入住 91 人"], ["今日工单", "待派 6 单，处理中 14 单"], ["风险提醒", "2 条待复核"]]
      : [["管辖区域", user.org_name], ["重点老人", "80 岁以上 326 人，失能 47 人"], ["待办事项", "补贴复核 12 件，能力评估 8 件"], ["数据权限", user.elder_scope]];
    return `
      <article class="archive-mobile-card">
        <div class="archive-head">
          <span>${escapeHtml(initials(user.real_name))}</span>
          <div><strong>${escapeHtml(user.real_name)}</strong><small>${escapeHtml(roleTitle(user, this.auth))} · ${escapeHtml(user.terminal)}端</small></div>
        </div>
        <dl>
          <div><dt>所属组织</dt><dd>${escapeHtml(user.org_name)}</dd></div>
          <div><dt>登录授权</dt><dd>${escapeHtml(user.auth_level)}</dd></div>
          <div><dt>授权范围</dt><dd>${escapeHtml(user.elder_scope)}</dd></div>
          <div><dt>联系方式</dt><dd>${escapeHtml(user.phone_masked || "未提供")}</dd></div>
        </dl>
        ${canShowPrivate(profile) ? `<dl class="business-profile">${privateFields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : `<p class="privacy-note">C 端仅展示当前登录人的 IT 账号档案，不展示居住情况、能力评估、经济情况等个人私密数据。</p>`}
      </article>
    `;
  }

  renderList(items = [], emptyText = "", type = "item") {
    if (!items.length) return `<article class="list-card"><p>${escapeHtml(emptyText)}</p></article>`;
    return items.map((item, index) => {
      const title = item.title || item.elder_name || item.service_type || item.work_order_id || item.order_id || "协同事项";
      const content = item.content || item.address_label || item.status || item.care_level || "";
      return `
        <article class="list-card" data-list-type="${type}" data-list-index="${index}">
          <strong>${escapeHtml(title)}</strong>
          <p>${escapeHtml(content)}</p>
          <div class="list-meta">
            <span>${escapeHtml(item.priority || item.status || item.role_name || item.read_status || "")}</span>
            <span>${escapeHtml(item.created_at || item.due_at || "")}</span>
          </div>
          ${type !== "elder" ? `<div class="list-actions"><button type="button" data-list-action="detail">查看</button><button type="button" data-list-action="handle">处理</button></div>` : ""}
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
        const action = button.dataset.listAction === "handle" ? "处理" : "查看";
        const prompt = `${action}${item.title || item.service_type || item.work_order_id || item.order_id || "协同事项"}：${item.content || item.status || ""}`;
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
          <button type="button" class="chat-back-btn" id="chatBackBtn">←</button>
          <span class="chat-header-title">AI养老助手</span>
        </div>
        <div class="chat-log" id="mobileChatLog"></div>
        <form class="mobile-chat-form" id="mobileChatForm">
          <button type="button" class="mobile-input-icon" id="mobileVoiceButton" aria-label="语音输入">${mobileIconSvg("mic")}</button>
          <textarea id="mobileChatInput" rows="2" placeholder="说点什么..."></textarea>
          <button type="button" class="mobile-input-icon" id="mobileImageButton" aria-label="更多">${mobileIconSvg("plus")}</button>
          <button type="submit" class="mobile-send-button" aria-label="发送">${mobileIconSvg("send")}<span>发送</span></button>
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
    // 发送按钮显示/隐藏：有文字时显示发送按钮，隐藏+按钮
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
      title: "新对话",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "已开启",
      favorite: false,
      latestQuestion: "",
      latestAnswer: "",
      messages: [
        { role: "ai", content: "您好，我是桂小养。可以帮您查政策、找服务、看待办、联动机构与护理人员。", at: Date.now() }
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
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(this.state.conversations));
    // 触发后端同步（节流）
    this._scheduleBackendSync();
  }

  // 后端同步调度（节流 5 秒）
  _scheduleBackendSync() {
    if (this._syncTimeout) clearTimeout(this._syncTimeout);
    this._syncTimeout = setTimeout(() => {
      this._syncToBackend(false);
    }, 5000);
  }

  // 同步到后端
  async _syncToBackend(immediate = false) {
    if (this._syncTimeout) {
      clearTimeout(this._syncTimeout);
      this._syncTimeout = null;
    }
    const conversations = this.state.conversations.slice(0, MAX_HISTORY);
    try {
      const res = await fetch("/api/conversation/sync-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversations: conversations.map((c) => ({
            id: c.id,
            title: c.title,
            messages: c.messages,
            status: c.status,
            favorite: c.favorite,
            latestQuestion: c.latestQuestion,
            latestAnswer: c.latestAnswer,
            created: c.created,
            roleKey: this.auth?.roleKey || "",
            userToken: this.auth?.userToken || "",
            presetKey: this.auth?.presetKey || "",
          })),
        }),
        keepalive: immediate,
      });
      if (!res.ok) throw new Error(`sync failed: ${res.status}`);
    } catch (e) {
      console.warn("[Mobile][ConversationHistory] 同步失败:", e.message);
    }
  }

  replayConversation() {
    const log = screen.querySelector("#mobileChatLog");
    if (!log) return;
    const conversation = this.ensureConversation();
    log.innerHTML = "";
    for (const message of conversation.messages) {
      if (message.type === "image") this.appendImageBubble(message, { record: false });
      else this.appendBubble(message.role, message.content, { record: false, markdown: message.markdown });
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
    const body = options.markdown ? renderMarkdown(text) : escapeHtml(text);
    log.insertAdjacentHTML("beforeend", `<div class="bubble ${role} ${options.markdown ? "markdown-body" : ""}">${body}</div>`);
    log.scrollTop = log.scrollHeight;
  }

  addBubble(kind, text, options = {}) {
    this.appendBubble(kind, text, options);
    if (options.record === false) return;
    const conversation = this.currentConversation();
    if (!conversation) return;
    conversation.messages.push({ role: kind, content: text, markdown: Boolean(options.markdown), at: Date.now() });
    conversation.updatedAt = Date.now();
    if (kind === "user") {
      conversation.latestQuestion = text;
      conversation.title = compactText(text, 18);
      conversation.status = "等待答复";
    } else {
      conversation.latestAnswer = text;
      conversation.status = options.error ? "答复异常" : "已答复";
    }
    this.persistHistory();
  }

  updateLastAiBubble(text, options = {}) {
    const bubbles = screen.querySelectorAll(".bubble.ai");
    const last = bubbles[bubbles.length - 1];
    if (last) {
      last.classList.toggle("markdown-body", Boolean(options.markdown));
      if (options.html) last.innerHTML = options.html;
      else last.innerHTML = options.markdown ? renderMarkdown(text) : escapeHtml(text);
    }
    const conversation = this.currentConversation();
    if (!conversation) return;
    const lastMessage = [...conversation.messages].reverse().find((item) => item.role === "ai");
    if (lastMessage) {
      lastMessage.content = text;
      lastMessage.markdown = Boolean(options.markdown);
    }
    conversation.latestAnswer = text;
    conversation.status = options.error ? "答复异常" : "已答复";
    conversation.updatedAt = Date.now();
    this.persistHistory();
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

  async sendMessage(text) {
    const message = String(text || "").trim();
    if (!message || this.state.sending) return;
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
    this.addBubble("ai", "桂小养正在请求后端调度，请稍候......");
    try {
      const body = await fetchJson("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          message,
          conversationId: conversation?.id || "",
          conversationHistory,
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
      this.handleRemoteResult(body);
    } catch (err) {
      this.updateLastAiBubble(`请求未完成：${err.message}`, { error: true });
    } finally {
      this.state.sending = false;
      screen.querySelector(".mobile-send-button")?.removeAttribute("disabled");
      this.resetVisibleVoiceInput();
    }
  }

  normalizeDebugResult(body = {}) {
    const result = body || {};
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
    const answer = sanitizeAssistantText(normalizedBody.answer || normalizedBody.answer_text || normalizedBody.message || normalizedBody.error || "远端已响应。");
    const fallbackHtml = renderSafeHtmlFallback(normalizedBody);
    this.state.latestResult = normalizedBody;
    this.state.latestAnswer = answer;
    this.updateLastAiBubble(answer, { markdown: !fallbackHtml, html: fallbackHtml, error: normalizedBody.ok === false });
    this.appendAssistantActions(normalizedBody);
    this.appendFollowupSuggestions(normalizedBody);
    this.upsertTemplateTab(normalizedBody);
    this.renderTemplatePanel(normalizedBody);
    // 右侧调测卡片若已打开，则自动刷新
    const sidePanel = document.querySelector(".mobile-debug-side-panel.open");
    if (sidePanel) this.renderDebugSidePanel();
    // ========== 引导按钮渲染 ==========
    // 检测 chat.busy_guide.v1 和 chat.queue_status.v1 模板
    const templateId = normalizedBody.template_id || normalizedBody.templateId;
    if (templateId === "chat.busy_guide.v1" || templateId === "chat.queue_status.v1") {
      this.renderBusyGuideButtons(body);
    }
    
    if (this.state.autoSpeech) this.speakText(answer);
  }

  renderAssistantActions(result = {}) {
    const actions = Array.isArray(result.actions) ? result.actions : [];
    return actions.filter((item) => item?.label && item.action_key).slice(0, 6);
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
        skill_key: item.skill_key || result.skill_key || "guixiaoyang_dispatch",
        source_template_id: item.source_template_id || result.template_id || "",
        next_template_id: item.next_template_id || result.template_id || "",
      })}">${escapeHtml(item.label || item.action_key || "执行")}</button>
    `).join("");
    last.insertAdjacentHTML("beforeend", `<div class="mobile-action-bar">${buttons}</div>`);
    last.querySelectorAll("[data-mobile-action]").forEach((button) => {
      button.addEventListener("click", () => this.handleAssistantAction(decodeFollowup(button.dataset.mobileAction), button));
    });
  }

  async handleAssistantAction(action = {}, button = null) {
    if (!action?.action_key || this.state.sending) return;
    const conversation = this.currentConversation();
    const originalText = button?.textContent || action.label || action.action_key;
    try {
      if (button) {
        button.disabled = true;
        button.textContent = "执行中...";
      }
      this.addBubble("user", action.label || action.action_key);
      this.addBubble("ai", "正在执行操作...");
      const payload = await fetchJson("/api/chat/followup", {
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
      this.updateLastAiBubble(`操作执行异常：${err.message}`, { error: true });
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  renderFollowupSuggestions(result = {}) {
    const suggestions = Array.isArray(result.followup_suggestions)
      ? result.followup_suggestions
      : Array.isArray(result.data?.followup_suggestions)
      ? result.data.followup_suggestions
      : [];
    return suggestions.filter((item) => item?.label && (item.user_prompt || item.action_key)).slice(0, 6);
  }

  appendFollowupSuggestions(result = {}) {
    const suggestions = this.renderFollowupSuggestions(result);
    if (!suggestions.length) return;
    const bubbles = screen.querySelectorAll(".bubble.ai");
    const last = bubbles[bubbles.length - 1];
    if (!last) return;
    const buttons = suggestions.map((item) => `
      <button type="button" class="mobile-followup-btn" data-mobile-followup="${encodeFollowup({
        ...item,
        skill_key: item.skill_key || result.skill_key || "guixiaoyang_dispatch",
        source_template_id: item.source_template_id || result.template_id || "",
        next_template_id: item.next_template_id || result.template_id || "",
      })}">${escapeHtml(item.label || item.user_prompt || "继续")}</button>
    `).join("");
    last.insertAdjacentHTML("beforeend", `<div class="mobile-followup-bar">${buttons}</div>`);
    last.querySelectorAll("[data-mobile-followup]").forEach((button) => {
      button.addEventListener("click", () => this.handleFollowupSuggestion(decodeFollowup(button.dataset.mobileFollowup), button));
    });
  }

  async handleFollowupSuggestion(suggestion = {}, button = null) {
    const prompt = String(suggestion.user_prompt || suggestion.label || "").trim();
    if (!prompt || this.state.sending) return;
    const conversation = this.currentConversation();
    const originalText = button?.textContent || suggestion.label || prompt;
    try {
      if (button) {
        button.disabled = true;
        button.textContent = "处理中...";
      }
      this.addBubble("user", suggestion.label || prompt);
      this.addBubble("ai", "正在处理建议提案...");
      const payload = await fetchJson("/api/chat/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          ...suggestion,
          user_prompt: prompt,
          execute_action: suggestion.action_key ? true : false,
          reenter_chat: suggestion.action_key ? false : true,
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
      this.updateLastAiBubble(`建议提案处理异常：${err.message}`, { error: true });
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  /**
   * 渲染引导按钮（忙时引导/排队状态）
   */
  renderBusyGuideButtons(body) {
    const templateId = body.template_id || body.templateId;
    const buttons = body.buttons || body.data?.buttons || [];
    const pendingMessage = body.data?.pending_message || body.pending_message || "";
    
    if (!buttons.length) return;
    
    // 在最后一条 AI 消息后添加按钮区域
    const log = screen.querySelector("#mobileChatLog");
    if (!log) return;
    
    // 移除旧的引导按钮
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
    
    // 添加到消息流
    log.appendChild(buttonContainer);
    
    // 滚动到底部
    log.scrollTop = log.scrollHeight;
  }

  /**
   * 执行引导按钮动作
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
        // 显示结果
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
    const title = result.tab?.title || result.skill_title || result.page?.title || result.card?.title || "远端模板";
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
      panel.innerHTML = `<strong>页面模板</strong><p>测试环境显示远端技能、模板、证据、输出按钮和审计链路；生产环境隐藏。</p>`;
      return;
    }
    const active = this.state.templateTabs.find((item) => item.key === this.state.activeTemplateKey) || this.state.templateTabs[0];
    const activeResult = active?.result || result;
    panel.innerHTML = `
      <div class="mobile-template-head">
        <strong>${escapeHtml(active?.title || activeResult.skill_title || "远端模板")}</strong>
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
        <strong>调测执行详情</strong>
        <dl>
          <div><dt>最终意图</dt><dd>${escapeHtml(result.intent || "UNKNOWN")}</dd></div>
          <div><dt>目标技能</dt><dd>${escapeHtml(result.skill_key || "UNKNOWN")}</dd></div>
          <div><dt>输出模板</dt><dd>${escapeHtml(result.template_key || "remote_answer")}</dd></div>
          <div><dt>目标智能体</dt><dd>${escapeHtml(String(result.target_agent_id || platform.agentId || "未返回"))}</dd></div>
          <div><dt>入口智能体</dt><dd>${escapeHtml(platform.agentId ? `space=${platform.spaceId || "-"} · agent=${platform.agentId}` : "未返回")}</dd></div>
          <div><dt>用户角色</dt><dd>${escapeHtml(`${role.title || result.role_key || "UNKNOWN"} / ${role.terminal || ""}`)}</dd></div>
          <div><dt>置信度</dt><dd>${escapeHtml(result.confidence == null ? "未返回" : `${Math.round(Number(result.confidence) * 100)}%`)}</dd></div>
          <div><dt>风险等级</dt><dd>${escapeHtml(result.risk_level || "未识别")}</dd></div>
        </dl>
        <p><b>路由原因</b>${escapeHtml(result.route_reason || "后端根据当前输入和远端响应完成调度。")}</p>
        ${trace.length ? `<ol>${trace.map((step) => `<li>${escapeHtml(debugTraceLabel(step))}</li>`).join("")}</ol>` : ""}
        ${hits.length ? `<div class="mobile-evidence-list"><b>知识命中</b>${hits.slice(0, 5).map((hit, index) => `<article><span>${index + 1}</span><p>${escapeHtml(hit.title || "未返回标题")}</p><em>${escapeHtml(debugScoreLabel(hit.score))}</em></article>`).join("")}</div>` : ""}
        ${components.length ? `<div class="mobile-evidence-list"><b>组件执行</b>${components.slice(0, 6).map((item) => `<article><span>${escapeHtml(item.type || "组件")}</span><p>${escapeHtml(item.name || `target=${item.targetId || "-"}`)}</p><em>${escapeHtml(debugStatusLabel(item.status))}${item.hits == null ? "" : ` · 命中${item.hits}`}</em></article>`).join("")}</div>` : ""}
      </div>
    `;
  }

  renderCard(card = {}) {
    if (!card) return "";
    const panels = card.workflow?.panels || [];
    return `
      <article class="mobile-result-card">
        <h3>${escapeHtml(card.title || "处理结果")}</h3>
        ${card.summary ? `<div class="markdown-body">${renderMarkdown(card.summary)}</div>` : ""}
        ${panels.length ? `<div class="mobile-workflow-panels">${panels.map((panel) => `<div><strong>${escapeHtml(panel.title)}</strong>${(panel.items || []).slice(0, 4).map((item) => `<small>${escapeHtml(item)}</small>`).join("")}</div>`).join("")}</div>` : ""}
      </article>
    `;
  }

  renderStructuredPage(page = {}) {
    const sections = page.sections || [];
    return `
      <article class="mobile-structured-page">
        <h3>${escapeHtml(page.title || "页面浏览")}</h3>
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
    return `<div class="mobile-output-actions">${outputs.map((output) => `<button type="button" data-output-id="${escapeHtml(output.id)}">${escapeHtml(output.label || output.type || "输出")}</button>`).join("")}</div>`;
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
          <header><div><h2>页面模板</h2><p>${escapeHtml(result.template_key || "remote_answer")} · ${escapeHtml(result.skill_key || "UNKNOWN")}</p></div><button type="button" id="closeTemplateDetail">${mobileIconSvg("close")}</button></header>
          <div class="mobile-template-detail-body">
            ${answerText ? `<article class="mobile-result-card"><h3>远端原文</h3><div class="markdown-body">${renderMarkdown(answerText)}</div></article>` : ""}
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
    target.innerHTML = `<div class="inline-status">${escapeHtml(output.label || "输出")}...</div>`;
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
      target.innerHTML = `<div class="execution-card bad"><strong>${escapeHtml(output.label || "输出")}</strong><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  openHistoryModal() {
    const host = screen.querySelector("#mobileModalHost");
    const items = this.state.conversations.length ? this.state.conversations.map((item) => `
      <div class="mobile-history-row-wrapper">
        <button type="button" class="mobile-history-row" data-open-conversation="${escapeHtml(item.id)}">
          <strong>${item.favorite ? "★ " : ""}${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.status)} · ${new Date(item.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
          <small>问：${escapeHtml(item.latestQuestion || "暂无提问")}</small>
          <small>答：${escapeHtml(compactText(item.latestAnswer || "暂无答复", 42))}</small>
        </button>
        <button type="button" class="mobile-history-delete-btn" data-delete-conversation="${escapeHtml(item.id)}" aria-label="删除此对话">
          ${mobileIconSvg("close")}
        </button>
      </div>
    `).join("") : `<p class="history-empty">暂无对话记录</p>`;
    host.innerHTML = `
      <div class="mobile-modal-backdrop">
        <section class="mobile-dialog">
          <header><div><h2>对话记录</h2><p>最近的对话、答复状态与收藏情况</p></div><button type="button" id="closeHistory">${mobileIconSvg("close")}</button></header>
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
    // 删除对话
    host.querySelectorAll("[data-delete-conversation]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const id = button.dataset.deleteConversation;
        this.deleteConversation(id);
      });
    });
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
    // 从后端删除
    try {
      await fetch(`/api/conversation/delete/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (e) {
      console.warn("[Mobile][ConversationHistory] 后端删除失败:", e.message);
    }
    // 同步收割
    try {
      await fetch("/api/conversation/harvest-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id }),
      });
    } catch (e) {
      console.warn("[Mobile][ConversationHistory] 收割同步失败:", e.message);
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
    if (this.state.sending) return;
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
      this.addBubble("ai", "正在读取图片并进行 OCR 识别，请稍候...");
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
        this.updateLastAiBubble(`OCR 解析完成，已将识别结果整理到输入框，正在提交女娲平台处理。`);
        await this.sendMessage(formattedText);
      } else if (normalizedPayload.input) {
        this.updateLastImageStatus("OCR 未识别出有效文字", "error");
        this.updateLastAiBubble(`图片已上传，但 OCR 在多次解析后仍未识别出有效文字。请补充说明图片内容，或重新上传更清晰的图片。已等待约 ${Math.round((normalizedPayload.input.elapsedMs || 0) / 1000)} 秒。`);
      }
    } catch (err) {
      this.updateLastImageStatus("OCR 识别失败，请重试", "error");
      this.updateLastAiBubble(`图片输入未完成：${err.message}`, { error: true });
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

window.GuiXiaoYangMobileApp = new MobileApp();
window.GuiXiaoYangMobileApp.start();
