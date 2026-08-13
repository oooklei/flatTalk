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
    return this.request('GET', pathname, { headers });
  }

  async post(pathname, body = {}, headers = {}) {
    return this.request('POST', pathname, { body, headers });
  }

  async put(pathname, body = {}, headers = {}) {
    return this.request('PUT', pathname, { body, headers });
  }

  async delete(pathname, headers = {}) {
    return this.request('DELETE', pathname, { headers });
  }

  async request(method, pathname, { body, headers = {} } = {}) {
    if (!this.baseUrl) {
      return { ok: false, skipped: true, status: 0, error: 'http_base_url_not_configured' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const init = {
        method,
        headers: {
          ...this.defaultHeaders,
          ...headers,
        },
        signal: controller.signal,
      };
      if (body !== undefined) {
        init.headers = {
          'Content-Type': 'application/json; charset=utf-8',
          ...init.headers,
        };
        init.body = JSON.stringify(body);
      }
      const response = await fetch(`${this.baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`, init);
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
