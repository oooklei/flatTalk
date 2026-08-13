/**
 * 全量模板健康核查：
 * - 活地图 vs 纯展示分类
 * - iframe 误判 / 漏判
 * - 内联可见文本
 * - 相对 stylesheet（手机 srcdoc/blob+base 易 404）
 * - 脚本中的 Mustache {{{ 风险
 * - manifest / sample 齐全度
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderCard } from '../src/template-card/index.js';
import {
  cardNeedsIframeIsolation,
  buildHtmlFallback,
} from '../src/core/render/template-card-renderer.js';

const skillsRoot = path.join(process.cwd(), 'src/skills');
const outDir = path.join(process.cwd(), 'scripts/test-output');
fs.mkdirSync(outDir, { recursive: true });

function walkHtmlFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkHtmlFiles(p, out);
    else if (ent.name.endsWith('.html') && !ent.name.startsWith('_')) out.push(p);
  }
  return out;
}

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

function hasRelativeStylesheet(html = '') {
  const tags = String(html || '').match(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi) || [];
  return tags.some((tag) => {
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1] || '';
    return href && !/^(https?:|data:|\/\/|\/)/i.test(href);
  });
}

function hasDangerousMustacheInScript(html = '') {
  // 合法：{{{markers_json}}} / {{{static_svg}}} 等未转义插值
  // 危险：脚本用字符串字面量探测 '{{{'（会被 Mustache 截断）
  const scripts = String(html || '').match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  return scripts.some((block) => {
    const body = block
      .replace(/^<script\b[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    return /indexOf\(\s*['"`]\{\{\{/.test(body)
      || /['"`]\{\{\{['"`]/.test(body)
      || /includes\(\s*['"`]\{\{\{/.test(body);
  });
}

function loadSampleData(htmlPath) {
  const samplePath = htmlPath.replace(/\.html$/i, '.sample.json');
  if (!fs.existsSync(samplePath)) return { data: {}, hasSample: false };
  try {
    const raw = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    return {
      data: raw.data && typeof raw.data === 'object' ? raw.data : raw,
      hasSample: true,
    };
  } catch (err) {
    return { data: {}, hasSample: true, sampleError: String(err.message || err) };
  }
}

function visibleTextFromFallback(fallback = '') {
  return String(fallback || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<textarea[\s\S]*?<\/textarea>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textareaSourceLen(fallback = '') {
  const m = String(fallback || '').match(/<textarea[^>]*class=["'][^"']*gxy-card-html-source[^"']*["'][^>]*>([\s\S]*?)<\/textarea>/i)
    || String(fallback || '').match(/<textarea[^>]*class=["']gxy-card-html-source["'][^>]*>([\s\S]*?)<\/textarea>/i)
    || String(fallback || '').match(/<textarea class="gxy-card-html-source"[^>]*>([\s\S]*?)<\/textarea>/i);
  return m ? m[1].length : 0;
}

const files = [];
for (const skill of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
  if (!skill.isDirectory()) continue;
  walkHtmlFiles(path.join(skillsRoot, skill.name, 'templates', 'html'), files);
}

const report = [];
const issues = [];

for (const file of files) {
  const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
  const skill = rel.split('/')[2];
  const templateId = path.basename(file, '.html');
  const raw = fs.readFileSync(file, 'utf8');
  const liveMap = hasLiveMapSignals(raw);
  const relativeCssRaw = hasRelativeStylesheet(raw);
  const mustacheDanger = hasDangerousMustacheInScript(raw);
  const manifestPath = file.replace(/\.html$/i, '.manifest.json');
  const hasManifest = fs.existsSync(manifestPath);
  const sample = loadSampleData(file);

  const row = {
    skill,
    templateId,
    rel,
    kind: liveMap ? 'live_map' : 'plain',
    hasManifest,
    hasSample: sample.hasSample,
    relativeCssRaw,
    mustacheDanger,
    expectIframe: liveMap,
  };

  try {
    const card = renderCard(path.dirname(file), {
      template_id: templateId,
      data: sample.data,
    });
    const pageHtml = card.pages?.[0] || '';
    const needs = cardNeedsIframeIsolation(pageHtml);
    const fallback = buildHtmlFallback(pageHtml);
    const usedIframe = /gxy-template-card-frame/.test(fallback);
    const usedTextarea = /gxy-card-html-source/.test(fallback);
    const usedSrcdoc = /srcdoc\s*=/.test(fallback);
    const visible = visibleTextFromFallback(fallback);
    const srcLen = usedTextarea ? textareaSourceLen(fallback) : 0;

    Object.assign(row, {
      renderReason: card.reason,
      matchedTemplateId: card.templateId,
      needsIframe: needs,
      usedIframe,
      usedTextarea,
      usedSrcdoc,
      visibleLen: visible.length,
      textareaSrcLen: srcLen,
      relativeCssAfterRender: hasRelativeStylesheet(pageHtml) || hasRelativeStylesheet(fallback),
      ok: true,
    });

    if (!liveMap && needs) {
      row.issue = 'FALSE_POSITIVE_IFRAME';
      issues.push({ ...row, detail: 'plain template classified as iframe after renderCard/bridge' });
    } else if (liveMap && !needs) {
      row.issue = 'FALSE_NEGATIVE_INLINE';
      issues.push({ ...row, detail: 'live-map template classified as inline' });
    } else if (!liveMap && usedIframe) {
      row.issue = 'PLAIN_USED_IFRAME';
      issues.push({ ...row, detail: 'plain template fallback used iframe' });
    } else if (liveMap && !usedIframe) {
      row.issue = 'MAP_USED_INLINE';
      issues.push({ ...row, detail: 'live-map template fallback did not use iframe' });
    } else if (liveMap && usedSrcdoc) {
      row.issue = 'MAP_USES_SRCDOC';
      issues.push({ ...row, detail: 'live-map iframe still uses srcdoc attribute' });
    } else if (liveMap && !usedTextarea) {
      row.issue = 'MAP_MISSING_TEXTAREA';
      issues.push({ ...row, detail: 'live-map iframe missing textarea carrier' });
    } else if (!liveMap && visible.length < 4) {
      row.issue = 'PLAIN_BLANK';
      issues.push({ ...row, detail: `plain inline fallback nearly blank (visibleLen=${visible.length})` });
    } else if (liveMap && srcLen < 200) {
      row.issue = 'MAP_EMPTY_SOURCE';
      issues.push({ ...row, detail: `map textarea source too short (len=${srcLen})` });
    } else if (row.relativeCssAfterRender) {
      row.issue = 'RELATIVE_CSS_AFTER_RENDER';
      issues.push({ ...row, detail: 'relative stylesheet still present after collectCss/strip' });
    } else if (mustacheDanger) {
      row.issue = 'DANGEROUS_MUSTACHE_IN_SCRIPT';
      issues.push({ ...row, detail: "script probes string literal '{{{' which Mustache may corrupt" });
    } else if (!hasManifest) {
      row.issue = 'NO_MANIFEST';
      issues.push({ ...row, detail: 'missing .manifest.json', severity: 'warn' });
    } else if (!sample.hasSample) {
      row.issue = 'NO_SAMPLE';
      issues.push({ ...row, detail: 'missing .sample.json', severity: 'warn' });
    } else if (sample.sampleError) {
      row.issue = 'BAD_SAMPLE';
      issues.push({ ...row, detail: sample.sampleError, severity: 'warn' });
    } else if (relativeCssRaw) {
      // 源码有相对 CSS，但渲染后已内联 —— 仅信息提示
      row.issue = 'RELATIVE_CSS_INLINED';
      issues.push({
        ...row,
        detail: 'raw has relative <link>, already inlined by collectCss at render',
        severity: 'info',
      });
    }
  } catch (err) {
    row.ok = false;
    row.issue = 'RENDER_ERROR';
    row.error = String(err?.message || err);
    issues.push({ ...row, detail: row.error });
  }

  report.push(row);
}

const errors = issues.filter((i) => !i.severity || i.severity === 'error');
const warns = issues.filter((i) => i.severity === 'warn');
const infos = issues.filter((i) => i.severity === 'info');
const plain = report.filter((r) => r.kind === 'plain');
const maps = report.filter((r) => r.kind === 'live_map');

const summary = {
  total: report.length,
  plain: plain.length,
  live_map: maps.length,
  plain_inline_ok: plain.filter((r) => r.usedIframe === false && (r.visibleLen || 0) >= 4).length,
  map_iframe_ok: maps.filter((r) => r.usedIframe && r.usedTextarea && !r.usedSrcdoc && (r.textareaSrcLen || 0) >= 200).length,
  errors: errors.length,
  warns: warns.length,
  infos: infos.length,
};

const outJson = path.join(outDir, 'template-full-audit.json');
const outMd = path.join(outDir, 'template-full-audit.md');
fs.writeFileSync(outJson, JSON.stringify({ summary, errors, warns, infos, report }, null, 2), 'utf8');

const lines = [];
lines.push('# 模板全量核查报告');
lines.push('');
lines.push(`生成时间：${new Date().toISOString()}`);
lines.push('');
lines.push('## 汇总');
lines.push('');
lines.push(`| 项 | 数量 |`);
lines.push(`|---|---:|`);
lines.push(`| 模板总数 | ${summary.total} |`);
lines.push(`| 纯展示（无活地图） | ${summary.plain} |`);
lines.push(`| 活地图 / 走线 SVG | ${summary.live_map} |`);
lines.push(`| 纯展示内联正常 | ${summary.plain_inline_ok} |`);
lines.push(`| 地图 iframe+textarea 正常 | ${summary.map_iframe_ok} |`);
lines.push(`| 错误 | ${summary.errors} |`);
lines.push(`| 警告 | ${summary.warns} |`);
lines.push(`| 信息（源码相对CSS已内联） | ${summary.infos} |`);
lines.push('');

if (errors.length) {
  lines.push('## 错误');
  lines.push('');
  for (const e of errors) {
    lines.push(`- **${e.issue}** \`${e.rel}\` — ${e.detail}`);
  }
  lines.push('');
} else {
  lines.push('## 错误');
  lines.push('');
  lines.push('无');
  lines.push('');
}

if (warns.length) {
  lines.push('## 警告');
  lines.push('');
  for (const w of warns) {
    lines.push(`- **${w.issue}** \`${w.rel}\` — ${w.detail}`);
  }
  lines.push('');
}

lines.push('## 纯展示模板（应内联）');
lines.push('');
for (const r of plain) {
  const mark = r.usedIframe === false && (r.visibleLen || 0) >= 4 ? 'OK' : (r.issue || 'CHECK');
  lines.push(`- [${mark}] \`${r.rel}\` visible=${r.visibleLen ?? '-'}`);
}
lines.push('');
lines.push('## 活地图模板（应 iframe + textarea）');
lines.push('');
for (const r of maps) {
  const mark = r.usedIframe && r.usedTextarea && !r.usedSrcdoc ? 'OK' : (r.issue || 'CHECK');
  lines.push(`- [${mark}] \`${r.rel}\` textareaSrc=${r.textareaSrcLen ?? '-'}`);
}
lines.push('');

fs.writeFileSync(outMd, lines.join('\n'), 'utf8');

console.log(JSON.stringify({ summary, errorCount: errors.length, warnCount: warns.length, infoCount: infos.length, outJson, outMd }, null, 2));
if (errors.length) {
  console.log('\nERRORS:');
  for (const e of errors) console.log(`- ${e.issue} ${e.rel} :: ${e.detail}`);
  process.exitCode = 1;
} else {
  console.log('\nAll critical checks passed.');
  if (warns.length) {
    console.log(`Warnings: ${warns.length}`);
    for (const w of warns.slice(0, 30)) console.log(`- ${w.issue} ${w.rel}`);
  }
}
