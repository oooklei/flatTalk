import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5298';
const out = [];
const log = (...a) => out.push(a.join(' '));

async function j(path, opts) {
  const r = await fetch(BASE + path, opts);
  return { status: r.status, body: await r.json() };
}

// 1) 注册表 CRUD（外部服务）
const c = await j('/api/admin/registries/external-services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '测试服务', type: 'rest', base_url: 'https://x.test', owner: 'alice', status: 'draft' }) });
log('CREATE external ->', c.status, JSON.stringify(c.body).slice(0, 80));
const id = c.body.item?.id;
if (id) {
  const u = await j(`/api/admin/registries/external-services/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '测试服务改', status: 'active' }) });
  log('UPDATE external ->', u.status, u.body.item?.name, u.body.item?.status);
  const d = await j(`/api/admin/registries/external-services/${id}`, { method: 'DELETE' });
  log('DELETE external ->', d.status);
}

// 2) 校验（权限应不再误报）
const v = await j('/api/admin/validate');
log('VALIDATE ->', v.body.reports.map((r) => `${r.level}:${r.module}`).join(' | '));

// 3) 权限矩阵 GET
const p = await j('/api/admin/permissions');
log('PERMISSIONS ->', p.status, 'roles=', p.body.roles?.length);

// 4) 对话运行缺消息
const dg = await j('/api/admin/dialogue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
log('DIALOGUE(empty) ->', dg.status, dg.body.error);

// 5) UI 扫描：每模块点击，抓控制台报错与原始标签
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message));
await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await page.waitForSelector('.nav-item');
const mods = await page.$$eval('.nav-item', (els) => els.map((e) => e.dataset.mod));
for (const mod of mods) {
  await page.click(`.nav-item[data-mod="${mod}"]`);
  await page.waitForTimeout(350);
  const txt = await page.evaluate(() => document.body.innerText);
  const raw = /<span|{{/.test(txt) ? 'RAW-TAG!' : 'clean';
  log(`UI[${mod}] len=${txt.length} ${raw}`);
  // 模型治理额外验证新建弹窗能打开
  if (mod === 'models') {
    await page.click('button:has-text("新建模型")');
    await page.waitForTimeout(300);
    const open = await page.evaluate(() => !!document.querySelector('.modal-card'));
    log('  models 新建弹窗打开 =', open);
    const cancel = page.locator('#cancel');
    if (await cancel.count()) await cancel.first().click();
  }
}
log('CONSOLE ERRORS ->', errs.length ? errs.join(' || ') : '(none)');
await browser.close();

console.log(out.join('\n'));
