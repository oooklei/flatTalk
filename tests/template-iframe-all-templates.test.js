import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderCard } from '../src/template-card/index.js';
import {
  cardNeedsIframeIsolation,
  buildHtmlFallback,
} from '../src/core/render/template-card-renderer.js';

const skillsRoot = path.join(process.cwd(), 'src/skills');

function walkHtmlFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkHtmlFiles(p, out);
    else if (ent.name.endsWith('.html') && !ent.name.startsWith('_')) out.push(p);
  }
  return out;
}

/** 模板自身是否含「活地图/走线 SVG」信号（不含 card-bridge、不含外链导航 URI） */
function hasLiveMapSignals(html = '') {
  const h = String(html || '');
  return h.includes('data-map-mode')
    || h.includes('data-static-svg')
    || /data-layout=["']map["']/i.test(h)
    || /data-template=["']nearby_map/i.test(h)
    || /id=["']mapCanvas["']/i.test(h)
    || /class=["'][^"']*\bnb-map\b/i.test(h)
    || /class=["'][^"']*\broute-card\b/i.test(h)
    || /class=["'][^"']*\bsvg-map-section\b/i.test(h)
    || /id=["']svgMapContainer["']/i.test(h)
    || /<script[^>]+src=["']https?:\/\/[^"']*map/i.test(h)
    || /map\.qq\.com\/api\/gljs/i.test(h)
    || /new\s+TMap\.Map\b/.test(h);
}

function loadSampleData(htmlPath) {
  const samplePath = htmlPath.replace(/\.html$/i, '.sample.json');
  if (!fs.existsSync(samplePath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    return raw.data && typeof raw.data === 'object' ? raw.data : raw;
  } catch {
    return {};
  }
}

function listTemplates() {
  const files = [];
  for (const skill of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!skill.isDirectory()) continue;
    walkHtmlFiles(path.join(skillsRoot, skill.name, 'templates', 'html'), files);
  }
  return files;
}

test('全量：无活地图信号的模板不得因 card-bridge 误判进 iframe', () => {
  const files = listTemplates();
  assert.ok(files.length >= 50, `expected many templates, got ${files.length}`);

  const failures = [];
  let plainCount = 0;

  for (const file of files) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    const templateId = path.basename(file, '.html');
    const raw = fs.readFileSync(file, 'utf8');
    if (hasLiveMapSignals(raw)) continue;
    plainCount += 1;

    const card = renderCard(path.dirname(file), {
      template_id: templateId,
      data: loadSampleData(file),
    });
    const pageHtml = card.pages?.[0] || '';
    // renderCard 会注入 card-bridge（含 map.qq.com），判定必须仍为 false
    if (cardNeedsIframeIsolation(pageHtml)) {
      failures.push(`${rel}: needsIframe=true after renderCard (bridge false-positive)`);
      continue;
    }
    const fallback = buildHtmlFallback(pageHtml);
    if (/gxy-template-card-frame/.test(fallback)) {
      failures.push(`${rel}: fallback used iframe`);
      continue;
    }
    const visible = fallback
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (visible.length < 4) {
      failures.push(`${rel}: inline fallback has no visible text (len=${visible.length})`);
    }
  }

  assert.ok(plainCount >= 40, `expected many plain templates, got ${plainCount}`);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('全量：含活地图信号的模板应走 iframe + textarea 源码', () => {
  const files = listTemplates();
  const failures = [];
  let mapCount = 0;

  for (const file of files) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    const templateId = path.basename(file, '.html');
    const raw = fs.readFileSync(file, 'utf8');
    if (!hasLiveMapSignals(raw)) continue;
    mapCount += 1;

    const card = renderCard(path.dirname(file), {
      template_id: templateId,
      data: loadSampleData(file),
    });
    const pageHtml = card.pages?.[0] || '';
    if (!cardNeedsIframeIsolation(pageHtml)) {
      failures.push(`${rel}: needsIframe=false but raw has live map signals`);
      continue;
    }
    const fallback = buildHtmlFallback(pageHtml);
    if (!/gxy-template-card-frame/.test(fallback)) {
      failures.push(`${rel}: expected iframe fallback`);
    }
    if (!/gxy-card-html-source/.test(fallback)) {
      failures.push(`${rel}: expected textarea HTML carrier`);
    }
    if (/srcdoc\s*=/.test(fallback)) {
      failures.push(`${rel}: should not use srcdoc attribute`);
    }
  }

  assert.ok(mapCount >= 8, `expected several map templates, got ${mapCount}`);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('仅外链 apis.map.qq.com/uri 导航的周边列表卡应内联', () => {
  const file = path.join(
    process.cwd(),
    'src/skills/nearby_resource/templates/html/nearby_food_card.html',
  );
  const raw = fs.readFileSync(file, 'utf8');
  assert.match(raw, /apis\.map\.qq\.com\/uri/);
  assert.equal(hasLiveMapSignals(raw), false);
  const card = renderCard(path.dirname(file), {
    template_id: 'nearby_food_card',
    data: loadSampleData(file),
  });
  assert.equal(cardNeedsIframeIsolation(card.pages[0] || ''), false);
});
