/**
 * Mermaid 渲染器
 * 用 Chromium 加载本地 mermaid.js 渲染图表，等价于 mermaid.live 的导出流程。
 * 产出：SVG（矢量存档）+ 高分辨率 PNG（供 docx 嵌入，用浏览器截图以正确处理 foreignObject）
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT_DIR = 'd:\\GuiCare\\flatTalk\\docs\\diagrams';
const MERMAID_JS = path.join(process.cwd(), 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');

const MERMAID_CONFIG = {
  startOnLoad: false,
  theme: 'default',
  fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
  flowchart: { curve: 'basis', useMaxWidth: false, htmlLabels: true, nodeSpacing: 45, rankSpacing: 55 },
  sequence: { useMaxWidth: false, actorMargin: 42, wrap: false },
  themeVariables: { fontSize: '15px' },
};

export async function renderMermaid(charts) {
  if (!fs.existsSync(MERMAID_JS)) {
    throw new Error(`未找到 mermaid.min.js: ${MERMAID_JS}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const results = [];

  for (const chart of charts) {
    const scale = chart.scale ?? 2.4;
    const page = await browser.newPage({
      viewport: { width: 1800, height: 1200 },
      deviceScaleFactor: scale,
    });

    await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:#fff}
  #host{display:inline-block;padding:12px}
  #host svg{display:block}
</style></head>
<body><div id="host"></div></body></html>`);

    await page.addScriptTag({ path: MERMAID_JS });
    await page.evaluate((cfg) => window.mermaid.initialize(cfg), MERMAID_CONFIG);

    const res = await page.evaluate(async ({ code, id }) => {
      try {
        const { svg } = await window.mermaid.render(id, code);
        document.getElementById('host').innerHTML = svg;
        const el = document.querySelector('#host svg');
        // 固化尺寸，避免 100% 宽度导致截图留白
        const bb = el.getBBox();
        const w = Math.ceil(bb.width + bb.x * 2) || Math.ceil(bb.width);
        const h = Math.ceil(bb.height + bb.y * 2) || Math.ceil(bb.height);
        el.setAttribute('width', w);
        el.setAttribute('height', h);
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        return { ok: true, svg: el.outerHTML, w, h };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }, { code: chart.code, id: `g_${chart.name.replace(/\W/g, '')}` });

    if (!res.ok) {
      console.error(`  [失败] ${chart.name}: ${res.error}`);
      results.push({ name: chart.name, ok: false, error: res.error });
      await page.close();
      continue;
    }

    // 存 SVG（矢量存档，可直接在 mermaid.live 复现）
    const svgPath = path.join(OUT_DIR, `${chart.name}.svg`);
    fs.writeFileSync(svgPath, res.svg, 'utf8');

    // 浏览器截图导出 PNG（正确渲染 foreignObject 中的 HTML 标签）
    const pngPath = path.join(OUT_DIR, `${chart.name}.png`);
    const host = await page.$('#host');
    await host.screenshot({ path: pngPath, omitBackground: false });

    const stat = fs.statSync(pngPath);
    results.push({
      name: chart.name,
      title: chart.title,
      ok: true,
      svgPath,
      pngPath,
      width: Math.round(res.w * scale),
      height: Math.round(res.h * scale),
      cssWidth: res.w,
      cssHeight: res.h,
    });
    console.log(`  [完成] ${chart.name}  ${Math.round(res.w * scale)}x${Math.round(res.h * scale)}px  ${(stat.size / 1024).toFixed(0)}KB`);

    await page.close();
  }

  await browser.close();
  return results;
}
