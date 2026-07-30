// 将「原型 HTML → 模板卡」的制作流程沉淀为可复用函数，供 admin「制作模板」接口与 CLI 脚本调用。
// 产出物 = 同名 .html（内联 <style> + {{占位符}} + 内嵌示例 <script type="application/json">）
//         + 同名 .manifest.json（id / layout / match / required）。
import fs from 'node:fs';
import path from 'node:path';
import { collectTopLevelNames } from './render.js';

const LAYOUTS = ['card', 'vertical', 'horizontal', 'grid'];

// 由文件名推导模板 id（snake_case，保留中文）
export function toTemplateId(filename) {
  const base = path.basename(filename, path.extname(filename));
  return base
    .replace(/[^\w一-龥.-]+/g, '_')
    .replace(/[.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function extractStyle(html) {
  const styles = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html))) styles.push(m[1].trim());
  return styles.join('\n');
}

function extractBody(html) {
  const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (m) return m[1].trim();
  // 无 <body>：去掉 <style> 后整段作为正文
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').trim();
}

// 扫描模板中的占位符，记录「顶层」（不在 {{#section}} 段落内）变量名及其默认表达式
function scanFields(html) {
  const fields = [];
  const re = /\{\{\{\s*([^}]+?)\s*\}\}\}|\{\{\s*([#^/!&>]?)\s*([^}]+?)\s*\}\}/g;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    const triple = !!m[1];
    const sigil = triple ? '' : m[2];
    const expr = (triple ? m[1] : m[3]).trim();
    if (triple) {
      if (depth === 0) fields.push({ name: expr.split(/\s*\|\s*/)[0].trim(), expr });
    } else if (sigil === '#' || sigil === '^') {
      depth++;
    } else if (sigil === '/') {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      fields.push({ name: expr.split(/\s*\|\s*/)[0].trim(), expr });
    }
  }
  return fields;
}

function parseDefault(expr) {
  // 支持 `name|默认` 与 `name || "默认"`
  let def = '';
  if (expr.includes('||')) def = expr.split('||').slice(1).join('||').trim();
  else if (expr.includes('|')) def = expr.split('|').slice(1).join('|').trim();
  return def.replace(/^["']|["']$/g, '').trim();
}

// 由原型 HTML 生成模板卡（.html 字符串 + .manifest.json 对象）
export function makeTemplateFromHtml(html, { id, layout = 'card', description = '' } = {}) {
  const fields = scanFields(html);
  const topNames = fields.map((f) => f.name);
  const sample = {};
  for (const f of fields) sample[f.name] = parseDefault(f.expr);
  const sampleJson = JSON.stringify(Object.keys(sample).length ? sample : {}, null, 2);
  const finalLayout = LAYOUTS.includes(layout) ? layout : 'card';
  const outHtml = ensureEmbeddedSampleJson(html, sampleJson);
  const humanized = description || id.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const manifest = {
    id,
    layout: finalLayout,
    match: `${humanized}。字段：${topNames.join(', ') || '(无占位符，静态原型)'}`,
    required: topNames,
  };
  return { html: outHtml, manifest, fields: topNames };
}

function ensureEmbeddedSampleJson(html, sampleJson) {
  if (/<script\b[^>]*type=["']application\/json["'][^>]*>/i.test(html)) return html;
  const script = `\n<script type="application/json">\n${sampleJson}\n</script>\n`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${script}</body>`);
  return `${html.trimEnd()}${script}`;
}

// ---- 极简 multipart/form-data 解析（仅依赖 Node 内置，支持多文件 / 文件夹上传）----
export function parseMultipart(req, maxBytes = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        const err = new Error('payload_too_large');
        err.code = 'payload_too_large';
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(parseMultipartBuffer(Buffer.concat(chunks), req.headers['content-type'] || ''));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function parseMultipartBuffer(buf, contentType) {
  const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const fields = {};
  const files = [];
  if (!bm) return { fields, files };
  const boundary = '--' + (bm[1] || bm[2]).trim();
  const sep = Buffer.from('\r\n' + boundary);
  let idx = buf.indexOf(Buffer.from(boundary));
  if (idx === -1) return { fields, files };
  idx += boundary.length;
  while (idx < buf.length) {
    if (buf[idx] === 0x2d && buf[idx + 1] === 0x2d) break; // 结束边界 --
    if (buf[idx] === 0x0d && buf[idx + 1] === 0x0a) idx += 2;
    const next = buf.indexOf(sep, idx);
    if (next === -1) break;
    const part = buf.subarray(idx, next);
    const hb = part.indexOf(Buffer.from('\r\n\r\n'));
    if (hb === -1) { idx = next + sep.length; continue; }
    const headerStr = part.subarray(0, hb).toString('utf8');
    const bodyBuf = part.subarray(hb + 4);
    const headers = {};
    for (const line of headerStr.split('\r\n')) {
      const ci = line.indexOf(':');
      if (ci > -1) headers[line.slice(0, ci).trim().toLowerCase()] = line.slice(ci + 1).trim();
    }
    const disp = /name="([^"]*)"(?:;\s*filename="([^"]*)")?/i.exec(headers['content-disposition'] || '');
    const name = disp && disp[1];
    const filename = disp && disp[2];
    if (filename) {
      files.push({ name, filename, contentType: headers['content-type'] || 'application/octet-stream', content: Buffer.from(bodyBuf) });
    } else if (name) {
      fields[name] = bodyBuf.toString('utf8');
    }
    idx = next + sep.length;
  }
  return { fields, files };
}
