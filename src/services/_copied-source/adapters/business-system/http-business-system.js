import { HttpJsonClient } from "../http-json-client.js";

export class HttpBusinessSystemAdapter {
  constructor({ baseUrl = "", timeoutMs = 15000, appId = "guixiaoyang-bff", token = "" } = {}) {
    this.client = new HttpJsonClient({
      baseUrl,
      timeoutMs,
      defaultHeaders: {
        "X-GXY-Caller": appId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  }

  isConfigured() {
    return this.client.isConfigured();
  }

  async currentUser(input = {}) {
    const result = await this.client.post("/api/gxy/current-user", input);
    return {
      ok: result.ok,
      source_status: result.ok ? "http" : "http_failed",
      user: result.data?.user || result.data?.data?.user || null,
      error: result.error || result.data?.error || null,
      upstream_status: result.status,
    };
  }

  async executeAction({ actionDef, params = {}, payload = {}, user = {} } = {}) {
    if (!this.isConfigured()) {
      return {
        ok: true,
        target: "business_system",
        action_key: actionDef.action_key,
        deferred: true,
        source_status: "not_configured",
        result: {
          message: "业务系统 HTTP 适配器未配置，当前仅完成 BFF 网关校验和动作接收。",
          params,
        },
      };
    }
    const pathname = actionDef.endpoint || actionDef.path || `/api/gxy/actions/${encodeURIComponent(actionDef.action_key)}`;
    const result = await this.client.post(pathname, {
      action_key: actionDef.action_key,
      skill_key: actionDef.skill_key,
      params,
      action_payload: payload,
      user,
    });
    return {
      ok: result.ok,
      target: "business_system",
      action_key: actionDef.action_key,
      source_status: result.ok ? "http" : "http_failed",
      upstream_status: result.status,
      result: result.data || null,
      error: result.error || result.data?.error || null,
    };
  }
}
