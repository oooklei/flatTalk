/**
 * 桂小养总调度 · 打包技能（package_skill）
 *
 * 能力：将平台中的某个技能打包成 zip（调用 /api/skill/export/{id}），
 * 返回可供下载的 zip 文件（base64 + 元信息）。
 *
 * 被 nuwaX 代码插件运行时调用；输入 params，输出 result。
 * params:
 *   - skillKey  技能 key（如 entity_profile），二选一
 *   - skillName 技能中文/英文名称，二选一
 *   - skillId   技能 id，二选一（优先级最高）
 * loginContext: 平台注入的当前用户上下文（可能含 nuwaX 鉴权信息）
 */

const BASE = process.env.NUWAX_BASE_URL || "http://43.138.143.130:9015";

function extractAuthHeader(loginContext = {}) {
  if (!loginContext || typeof loginContext !== "object") return "";
  // 常见注入形态，逐一尝试
  const candidates = [
    loginContext.token,
    loginContext.accessToken,
    loginContext.authorization,
    loginContext.Authorization,
    loginContext.cookie,
    loginContext.Cookie,
    loginContext.jwt,
    loginContext.sessionToken
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  // 也可能是 { headers: { authorization } }
  const h = loginContext.headers;
  if (h && typeof h === "object") {
    const a = h.authorization || h.Authorization || h.cookie || h.Cookie;
    if (typeof a === "string" && a.trim()) return a.trim();
  }
  return "";
}

async function serviceLogin(base) {
  const acc = process.env.NUWAX_ACCOUNT;
  const pwd = process.env.NUWAX_PASSWORD;
  if (!acc || !pwd) return "";
  try {
    const r = await fetch(base + "/api/user/passwordLogin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneOrEmail: acc, password: pwd })
    });
    const setCookie = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    const jar = setCookie.map((c) => c.split(";")[0]).join("; ");
    return jar || "";
  } catch {
    return "";
  }
}

async function fetchJson(base, path, auth) {
  const headers = { "Content-Type": "application/json" };
  if (auth) headers.Cookie = auth;
  const r = await fetch(base + path, { method: "GET", headers });
  if (!r.ok) throw new Error("HTTP " + r.status + " @ " + path);
  return r.json();
}

async function resolveSkill(base, params, auth) {
  const list = await fetchJson(base, "/api/skill/list?spaceId=" + (process.env.NUWAX_SPACE_ID || "") + "&pageNo=1&pageSize=200", auth);
  const recs = list.data || [];
  if (params.skillId) return recs.find((s) => String(s.id) === String(params.skillId)) || null;
  const key = String(params.skillKey || "").trim().toLowerCase();
  const name = String(params.skillName || "").trim();
  if (key) {
    const hit = recs.find((s) => String(s.key || "").toLowerCase() === key || String(s.skillKey || "").toLowerCase() === key);
    if (hit) return hit;
  }
  if (name) {
    const hit = recs.find((s) => (s.name || "").includes(name) || name.includes(s.name || ""));
    if (hit) return hit;
  }
  return null;
}

export async function packageSkill(params = {}, loginContext = {}) {
  const result = {
    ok: false,
    action: "package_skill",
    skillId: null,
    skillName: null,
    fileName: null,
    fileSize: 0,
    contentType: "application/zip",
    contentBase64: "",
    message: "",
    debug: {}
  };

  const auth0 = extractAuthHeader(loginContext);
  result.debug.loginContextKeys = Object.keys(loginContext || {});
  let auth = auth0;
  if (!auth) {
    const svc = await serviceLogin(BASE);
    if (svc) auth = svc;
  }

  let skill;
  try {
    skill = await resolveSkill(BASE, params, auth);
  } catch (e) {
    result.message = "技能列表获取失败：" + e.message;
    return result;
  }
  if (!skill) {
    result.message = "未找到技能，请确认 skillKey/skillName/skillId（如 entity_profile）。";
    return result;
  }
  result.skillId = skill.id;
  result.skillName = skill.name;

  try {
    const headers = {};
    if (auth) headers.Cookie = auth;
    const ex = await fetch(BASE + "/api/skill/export/" + skill.id, { method: "GET", headers });
    const ct = ex.headers.get("content-type") || "";
    const buf = Buffer.from(await ex.arrayBuffer());
    if (!ex.ok || !ct.toLowerCase().includes("zip")) {
      result.message = "导出失败：HTTP " + ex.status + "，content-type=" + ct;
      result.debug.head = buf.slice(0, 200).toString("latin1");
      return result;
    }
    result.ok = true;
    result.fileSize = buf.length;
    result.fileName = (skill.key || skill.name || "skill") + ".zip";
    result.contentBase64 = buf.toString("base64");
    result.message = `已成功打包技能「${skill.name}」，zip 大小 ${buf.length} 字节。`;
  } catch (e) {
    result.message = "导出调用异常：" + e.message;
  }
  return result;
}

export default packageSkill;
