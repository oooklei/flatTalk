import { spawn } from 'node:child_process';

export function createFlyaiClient({
  apiKey = process.env.FLYAI_API_KEY || '',
  timeoutMs = 120000,
  runner = null,
} = {}) {
  async function run(args) {
    if (runner) return runner(args);
    return new Promise((resolve, reject) => {
      const child = spawn('flyai', args, {
        env: { ...process.env, FLYAI_API_KEY: apiKey },
        shell: process.platform === 'win32',
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`flyai_timeout_${timeoutMs}`));
      }, timeoutMs);
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    });
  }

  function parseStdout(stdout) {
    const cut = stdout.search(/\nAssertion failed/);
    const t = (cut >= 0 ? stdout.slice(0, cut) : stdout).trim();
    if (!t.startsWith('{')) return { ok: false, error: 'not_json', raw: t.slice(0, 500) };
    try {
      return { ok: true, data: JSON.parse(t) };
    } catch (e) {
      return { ok: false, error: e.message, raw: t.slice(0, 500) };
    }
  }

  return {
    async keywordSearch(query) {
      const r = await run(['keyword-search', '--query', String(query)]);
      const p = parseStdout(r.stdout);
      return p.ok ? { ok: true, data: p.data.data ?? p.data, raw: p.data } : p;
    },
    async aiSearch(query) {
      const r = await run(['ai-search', '--query', String(query)]);
      const p = parseStdout(r.stdout);
      return p.ok ? { ok: true, data: p.data.data ?? p.data, raw: p.data } : p;
    },
    async searchPoi({ keyword, cityName }) {
      const args = ['search-poi', '--keyword', String(keyword)];
      if (cityName) args.push('--city-name', String(cityName));
      const r = await run(args);
      const p = parseStdout(r.stdout);
      return p.ok ? { ok: true, data: p.data.data ?? p.data, raw: p.data } : p;
    },
  };
}
