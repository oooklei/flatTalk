export class HttpJsonClient {
  constructor({ baseUrl = "", timeoutMs = 15000, defaultHeaders = {} } = {}) {
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.timeoutMs = Number(timeoutMs || 15000);
    this.defaultHeaders = defaultHeaders;
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  async post(pathname, body = {}, headers = {}) {
    if (!this.baseUrl) {
      return {
        ok: false,
        status: 0,
        skipped: true,
        error: "http_base_url_not_configured",
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...this.defaultHeaders,
          ...headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      return {
        ok: response.ok,
        status: response.status,
        data,
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        error: err.name === "AbortError" ? "request_timeout" : err.message,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
