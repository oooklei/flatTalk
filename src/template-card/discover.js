// 扫描模板目录：读取所有 .html 原型，抽取样式/卡片主体/默认数据，并识别布局方向。
import fs from 'node:fs';
import path from 'node:path';

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function detectLayout(html) {
  const m = html.match(/data-layout=["'](horizontal|vertical)["']/i);
  if (m) return m[1].toLowerCase();
  if (/flex-direction\s*:\s*row|class=["'][^"']*\b(horizontal|h-?scroll|hscroll|row)\b/i.test(html)) return 'horizontal';
  if (/flex-direction\s*:\s*column/i.test(html)) return 'vertical';
  return 'vertical';
}

// 抽取内联 <style> 与外部 <link rel=stylesheet> 的 CSS 文本
function collectCss(html, dir) {
  let css = '';
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css += m[1] + '\n';
  for (const m of html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)) {
    const href = (m[0].match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    if (/^(https?:|data:|\/\/)/.test(href)) { css += `/* 外链跳过: ${href} */\n`; continue; }
    const file = readFileSafe(path.resolve(dir, href));
    css += file != null ? file + '\n' : `/* 未找到样式文件: ${href} */\n`;
  }
  return css;
}

// 抽取 <body> 内部作为卡片主体；去掉原型自带的 application/json 示例脚本，避免泄漏进输出
function extractBody(html) {
  const stripJson = (s) => s.replace(/<script\b[^>]*type=["']application\/json["'][^>]*>[\s\S]*?<\/script>/gi, '');
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return body ? stripJson(body[1]) : stripJson(html);
}

// 抽取原型里自带的示例数据（<script type="application/json">）
function extractDefaultData(html) {
  const m = html.match(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return {};
  try { return JSON.parse(m[1]); } catch { return {}; }
}

// 读取与 html 同名的 .manifest.json —— 用于覆盖布局 / 必填字段 / 描述。
//
// manifest 不是"可选装饰"：intent_id、required、match 都靠它，
// 缺失或损坏会让模板以裸 base 名进入库，required 为空、match 为空，
// 于是"能渲染但字段全空"，问题被推迟到用户面前才暴露。
// 因此这里显式抛错，而不是静默返回 {}。
//
// 允许通过 TEMPLATE_MANIFEST_STRICT=0 关闭（仅用于临时排查），
// 默认严格。
const MANIFEST_STRICT = process.env.TEMPLATE_MANIFEST_STRICT !== '0';

function readManifest(dir, base) {
  const p = path.join(dir, `${base}.manifest.json`);
  const file = readFileSafe(p);
  if (!file) {
    // preview 目录与 *.preview.html 是渲染产物，不是可投放模板，
    // 它们本就没有 manifest（实测 17 个全在 templates/preview/ 下），
    // 对其报错属误报。
    const isPreview =
      base.endsWith('.preview')
      || base === 'index'
      || /[\\/]preview$/.test(dir);
    if (MANIFEST_STRICT && !isPreview) {
      throw new Error(
        `模板缺少 manifest: ${p}\n`
        + '  每个可投放模板必须有同名 .manifest.json（含 id/name/intent_id/required）。\n'
        + '  临时排查可设 TEMPLATE_MANIFEST_STRICT=0。',
      );
    }
    return {};
  }
  try {
    return JSON.parse(file);
  } catch (e) {
    // JSON 损坏比缺失更危险：静默 {} 会让模板看起来正常注册
    throw new Error(`模板 manifest 解析失败: ${p}\n  ${e.message}`);
  }
}

export function discoverTemplates(dir) {
  if (!fs.existsSync(dir)) throw new Error(`模板目录不存在: ${dir}`);
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.html'));
  const templates = files.map((file) => {
    const abs = path.join(dir, file);
    const html = fs.readFileSync(abs, 'utf8');
    const base = path.basename(file, '.html');
    const manifest = readManifest(dir, base);
    return {
      id: manifest.id || base,
      file,
      abs,
      html,                                  // 原始完整 html
      body: extractBody(html),               // 卡片主体（用于渲染）
      css: collectCss(html, dir),            // 内联 + 外部样式（已内联）
      defaultData: extractDefaultData(html), // 原型自带示例数据，作为字段缺省值
      layout: (manifest.layout || detectLayout(html)).toLowerCase(),
      required: manifest.required || [],     // 必填字段（用于兜底打分）
      followupActions: Array.isArray(manifest.followup_actions) ? manifest.followup_actions : [], // 配套追问按钮
      match: manifest.match || '',           // 适用场景描述（可回传模型）
      description: manifest.description || manifest.match || '',
    };
  });
  return templates;
}

// 供模型选择的模板清单（prompt 用）
export function describeLibrary(templates) {
  return templates.map((t) => ({ id: t.id, layout: t.layout, match: t.match || t.description }));
}
