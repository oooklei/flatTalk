/**
 * 把共享旅居产品主题写入 route_* / sojourn_route 模板
 * Run: node scripts/apply-route-product-theme.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlDir = path.join(__dirname, '../src/skills/travel_route/templates/html');
const css = fs.readFileSync(path.join(htmlDir, '_route_product.css'), 'utf8');

const THEME_BY_FILE = {
  'route_svg.html': 'wellness',
  'route_wellness.html': 'wellness',
  'route_coastal.html': 'coastal',
  'route_culture.html': 'culture',
  'route_ecology.html': 'ecology',
  'sojourn_route.html': 'wellness',
};

function applyTheme(file, theme) {
  const p = path.join(htmlDir, file);
  let html = fs.readFileSync(p, 'utf8');
  const styleBlock = `<style>\n${css}\n  </style>`;
  if (!/<style>[\s\S]*?<\/style>/i.test(html)) {
    throw new Error(`no style block in ${file}`);
  }
  html = html.replace(/<style>[\s\S]*?<\/style>/i, styleBlock);
  html = html.replace(
    /<article class="route-card"[^>]*>/,
    `<article class="route-card" data-theme="${theme}">`
  );
  if (!html.includes('data-theme=')) {
    html = html.replace(
      '<article class="route-card">',
      `<article class="route-card" data-theme="${theme}">`
    );
  }
  fs.writeFileSync(p, html, 'utf8');
  console.log('[ok]', file, theme);
}

for (const [file, theme] of Object.entries(THEME_BY_FILE)) {
  applyTheme(file, theme);
}
