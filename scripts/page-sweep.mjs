// 页面遍历扫描：自动点击所有页面与弹窗，检测未渲染模板标签 / 泄漏的后端字段名 / 控制台报错
// 用法: node scripts/page-sweep.mjs [baseURL]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:5298';
const OUT = new URL('../examples/output/', import.meta.url).pathname;
const SHOT_DIR = OUT + 'shots/';
fs.mkdirSync(SHOT_DIR, { recursive: true });

// 后端字段名（蛇形）泄漏到 UI 的典型“原始标签”
const RAW_TOKENS = [
  'model_type', 'api_base', 'api_key', 'max_tokens', 'sort_order', 'model_id',
  'is_active', 'is_default', 'display_name', 'created_at', 'updated_at',
  'temperature', 'provider', 'purpose',
];
const TOKEN_RE = new RegExp(`\\b(${RAW_TOKENS.join('|')})\\b`, 'g');
const TPL_RE = /\{\{[\s\S]*?\}\}/g;

function scanText(text) {
  const issues = [];
  const tpl = text.match(TPL_RE);
  if (tpl) tpl.slice(0, 10).forEach((t) => issues.push({ type: 'raw_template', sample: t.slice(0, 80) }));
  const toks = text.match(TOKEN_RE);
  if (toks) [...new Set(toks)].forEach((t) => issues.push({ type: 'raw_field_name', sample: t }));
  return issues;
}

const report = { base: BASE, pages: [] };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e)));

async function snapshot(name, url, interactions = []) {
  consoleErrors.length = 0; pageErrors.length = 0;
  await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(400);
  for (const act of interactions) {
    try { await act(page); await page.waitForTimeout(300); } catch (e) { /* ignore */ }
  }
  const text = await page.evaluate(() => document.body.innerText || '').catch(() => '');
  const issues = scanText(text);
  const shotName = name.replace(/\W+/g, '_') + '.png';
  await page.screenshot({ path: SHOT_DIR + shotName, fullPage: true }).catch(() => {});
  fs.writeFileSync(OUT + name.replace(/\W+/g, '_') + '.txt', text, 'utf8');
  report.pages.push({
    name, url, shot: shotName, textLen: text.length,
    issues, consoleErrors: consoleErrors.slice(0, 5), pageErrors: pageErrors.slice(0, 5),
  });
  console.log(`[${name}] textLen=${text.length} issues=${issues.length} consoleErr=${consoleErrors.length} pageErr=${pageErrors.length}`);
}

// admin：逐个点击导航；模型治理额外打开 新建/编辑 弹窗
await page.goto(BASE + '/admin', { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForSelector('.nav-item', { timeout: 5000 }).catch(() => {});
const navMods = await page.$$eval('.nav-item', (els) => els.map((e) => e.dataset.mod)).catch(() => []);
for (const mod of navMods) {
  const interactions = [async (p) => { await p.click(`.nav-item[data-mod="${mod}"]`); }];
  if (mod === 'models') {
    interactions.push(async (p) => {
      const btn = p.locator('button:has-text("新建模型")');
      if (await btn.count()) { await btn.first().click(); await p.waitForTimeout(300); }
    });
    interactions.push(async (p) => {
      // 关闭弹窗后再开编辑
      const cancel = p.locator('#cancel');
      if (await cancel.count()) await cancel.first().click();
      await p.waitForTimeout(200);
      const edit = p.locator('button:has-text("编辑")').first();
      if (await edit.count()) { await edit.first().click(); await p.waitForTimeout(300); }
    });
  }
  await snapshot('admin-' + mod, BASE + '/admin', interactions);
}

// mobile
await snapshot('mobile', BASE + '/mobile.html', [
  async (p) => { const b = p.locator('button').first(); if (await b.count()) await b.click(); },
]);

await browser.close();
fs.writeFileSync(OUT + 'sweep.json', JSON.stringify(report, null, 2));
console.log('REPORT ->', OUT + 'sweep.json');
