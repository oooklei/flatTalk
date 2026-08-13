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

function detectRawSignals(html) {
  return {
    data_map_mode: /data-map-mode/i.test(html),
    data_static_svg: /data-static-svg/i.test(html),
    data_layout_map: /data-layout=["']map["']/i.test(html),
    nearby_map: /data-template=["']nearby_map/i.test(html),
    mapCanvas: /id=["']mapCanvas["']/i.test(html),
    nb_map: /class=["'][^"']*\bnb-map\b/i.test(html),
    route_card: /class=["'][^"']*\broute-card\b/i.test(html),
    svg_map_section: /class=["'][^"']*\bsvg-map-section\b/i.test(html),
    svgMapContainer: /id=["']svgMapContainer["']/i.test(html),
    script_src_map: /<script[^>]+src=["']https?:\/\/[^"']*map/i.test(html),
    map_qq_gljs: /map\.qq\.com\/api\/gljs/i.test(html),
    new_TMap: /new\s+TMap\.Map\b/.test(html),
    TMap_any: /TMap\./.test(html),
    map_qq_any: /map\.qq\.com/.test(html),
    static_svg_mustache: /\{\{\{?\s*static_svg/.test(html),
  };
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

const files = [];
for (const skill of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
  if (!skill.isDirectory()) continue;
  walkHtmlFiles(path.join(skillsRoot, skill.name, 'templates', 'html'), files);
}

const report = [];
for (const file of files) {
  const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
  const skill = rel.split('/')[2];
  const templateId = path.basename(file, '.html');
  const rawHtml = fs.readFileSync(file, 'utf8');
  const rawSignals = detectRawSignals(rawHtml);
  const rawHits = Object.entries(rawSignals).filter(([, v]) => v).map(([k]) => k);
  const rawLikelyMap = rawHits.length > 0;

  let pageHtml = '';
  let renderError = '';
  let afterRenderNeeds = null;
  let fallbackIframe = null;
  let fallbackTextarea = null;
  let fallbackHasVisibleText = null;
  try {
    const card = renderCard(path.dirname(file), {
      template_id: templateId,
      data: loadSampleData(file),
    });
    pageHtml = card.pages?.[0] || '';
    afterRenderNeeds = cardNeedsIframeIsolation(pageHtml);
    const fallback = buildHtmlFallback(pageHtml);
    fallbackIframe = /gxy-template-card-frame/.test(fallback);
    fallbackTextarea = /gxy-card-html-source/.test(fallback);
    const visible = fallback
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<textarea[\s\S]*?<\/textarea>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    fallbackHasVisibleText = visible.length >= 8;
  } catch (err) {
    renderError = String(err?.message || err);
  }

  // Expectation: raw map-ish templates should iframe; plain should NOT
  const expectIframe = rawLikelyMap;
  const mismatch = afterRenderNeeds !== null && afterRenderNeeds !== expectIframe
    ? (afterRenderNeeds && !expectIframe ? 'FALSE_POSITIVE_IFRAME' : 'FALSE_NEGATIVE_INLINE')
    : null;

  report.push({
    skill,
    templateId,
    rel,
    rawHits,
    rawLikelyMap,
    afterRenderNeeds,
    fallbackIframe,
    fallbackTextarea,
    fallbackHasVisibleText,
    mismatch,
    renderError: renderError || undefined,
  });
}

const falsePositives = report.filter((r) => r.mismatch === 'FALSE_POSITIVE_IFRAME');
const falseNegatives = report.filter((r) => r.mismatch === 'FALSE_NEGATIVE_INLINE');
const plainBlank = report.filter((r) => !r.rawLikelyMap && r.fallbackIframe === false && r.fallbackHasVisibleText === false && !r.renderError);
const mapBlank = report.filter((r) => r.rawLikelyMap && r.fallbackIframe === true && r.fallbackHasVisibleText === false && !r.renderError);
const renderFails = report.filter((r) => r.renderError);

console.log(JSON.stringify({
  summary: {
    total: report.length,
    rawMapish: report.filter((r) => r.rawLikelyMap).length,
    rawPlain: report.filter((r) => !r.rawLikelyMap).length,
    falsePositives: falsePositives.length,
    falseNegatives: falseNegatives.length,
    plainBlank: plainBlank.length,
    mapBlankSuspect: mapBlank.length,
    renderFails: renderFails.length,
  },
  falsePositives,
  falseNegatives,
  plainBlank,
  mapBlankSuspect: mapBlank.slice(0, 20),
  renderFails,
  plainStillIframe: report.filter((r) => !r.rawLikelyMap && r.fallbackIframe === true),
  mapStillInline: report.filter((r) => r.rawLikelyMap && r.fallbackIframe === false),
}, null, 2));

fs.writeFileSync(
  path.join(process.cwd(), 'scripts/test-output/template-iframe-audit.json'),
  JSON.stringify({ summary: {
    total: report.length,
    rawMapish: report.filter((r) => r.rawLikelyMap).length,
    rawPlain: report.filter((r) => !r.rawLikelyMap).length,
    falsePositives: falsePositives.length,
    falseNegatives: falseNegatives.length,
  }, report }, null, 2),
  'utf8',
);
console.log('\\nWrote scripts/test-output/template-iframe-audit.json');
