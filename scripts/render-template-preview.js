import fs from 'node:fs';
import path from 'node:path';

import { discoverTemplates, renderCard } from '../src/template-card/index.js';

const projectRoot = process.cwd();
const skillKey = process.argv[2] || 'meal_plan';
const skillRoot = path.join(projectRoot, 'src', 'skills', skillKey);
const htmlDir = path.join(skillRoot, 'templates', 'html');
const dataDir = path.join(skillRoot, 'templates', 'data');
const previewDir = path.join(skillRoot, 'templates', 'preview');

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function sampleDataFor(templateId) {
  const direct = path.join(dataDir, `${templateId}.sample.json`);
  if (fs.existsSync(direct)) return readJsonSafe(direct);
  return {};
}

function writePreview(template) {
  const data = sampleDataFor(template.id);
  const result = renderCard(htmlDir, {
    template_id: template.id,
    data,
  });
  const fileName = `${template.id}.preview.html`;
  fs.writeFileSync(path.join(previewDir, fileName), result.pages[0] || '', 'utf8');
  return {
    id: template.id,
    fileName,
    layout: template.layout,
    match: template.match || '',
    required: template.required || [],
  };
}

function writeIndex(items) {
  const links = items.map((item) => `
    <article>
      <h2><a href="./${escapeHtml(item.fileName)}">${escapeHtml(item.id)}</a></h2>
      <p><strong>layout:</strong> ${escapeHtml(item.layout)}</p>
      <p><strong>required:</strong> ${escapeHtml(item.required.join(', ') || '-')}</p>
      <p>${escapeHtml(item.match || 'no manifest match')}</p>
    </article>
  `).join('\n');
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(skillKey)} template previews</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:24px;background:#f6f7f9;color:#17202a}
h1{font-size:24px;margin:0 0 16px}
article{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:12px 0}
a{color:#0f766e;text-decoration:none}
p{line-height:1.6;margin:6px 0;color:#4b5563}
</style>
</head>
<body>
<h1>${escapeHtml(skillKey)} 模板预览</h1>
${links}
</body>
</html>`;
  fs.writeFileSync(path.join(previewDir, 'index.html'), html, 'utf8');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function main() {
  if (!fs.existsSync(htmlDir)) {
    throw new Error(`Template html directory not found: ${htmlDir}`);
  }

  fs.mkdirSync(previewDir, { recursive: true });
  const templates = discoverTemplates(htmlDir);
  const items = templates.map(writePreview);
  writeIndex(items);
  console.log(JSON.stringify({
    ok: true,
    skillKey,
    previewDir,
    count: items.length,
    files: items.map((item) => item.fileName),
  }, null, 2));
}

main();
