export class HttpClient {
  constructor({ baseUrl = '', timeoutMs = 15000, defaultHeaders = {} } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.timeoutMs = Number(timeoutMs || 15000);
    this.defaultHeaders = defaultHeaders;
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  async get(pathname, headers = {}) {
    if (!this.baseUrl) {
      return { ok: false, skipped: true, status: 0, error: 'http_base_url_not_configured' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`, {
        method: 'GET',
        headers: {
          ...this.defaultHeaders,
          ...headers,
        },
        signal: controller.signal,
      });
      const text = await response.text();
      return { ok: response.ok, status: response.status, data: parseJson(text) };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: error.name === 'AbortError' ? 'request_timeout' : error.message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async post(pathname, body = {}, headers = {}) {
    if (!this.baseUrl) {
      return { ok: false, skipped: true, status: 0, error: 'http_base_url_not_configured' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...this.defaultHeaders,
          ...headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      return { ok: response.ok, status: response.status, data: parseJson(text) };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: error.name === 'AbortError' ? 'request_timeout' : error.message,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}
