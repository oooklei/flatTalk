// 轻量 Mustache 子集渲染器（无第三方依赖）
// 支持：{{var}} 转义、{{{var}}}/{{&var}} 不转义、{{#s}}...{{/s}} 区间(对象/数组/真值)、
//       {{^s}}...{{/s}} 反区间、{{! 注释}}。变量支持点路径(.a.b)与当前项(.)。

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 解析 {{var|...}} 的兜底部分：
//  - 普通兜底：  "🌴"                  → { type:'const', value }
//  - 字段映射：  "map:field:k1=v1,k2=v2,=vDef"  → 按 field 当前值选图标，未命中用 vDef
function parseDefault(raw) {
  if (raw.startsWith('map:')) {
    const rest = raw.slice(4);
    const ci = rest.indexOf(':');
    const field = rest.slice(0, ci);
    const mapStr = rest.slice(ci + 1);
    const entries = {};
    let fallback = '';
    for (const pair of mapStr.split(',')) {
      const ei = pair.indexOf('=');
      if (ei === -1) continue;
      const k = pair.slice(0, ei);
      const v = pair.slice(ei + 1);
      if (k === '') fallback = v; else entries[k] = v;
    }
    return { type: 'map', field, entries, fallback };
  }
  return { type: 'const', value: raw };
}

// 把模板拆成 token 列表（文本 + 标签）
function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const open = input.indexOf('{{', i);
    if (open === -1) { tokens.push({ t: 'text', v: input.slice(i) }); break; }
    if (open > i) tokens.push({ t: 'text', v: input.slice(i, open) });

    const triple = input.startsWith('{{{', open);
    const closeSeq = triple ? '}}}' : '}}';
    const close = input.indexOf(closeSeq, open + (triple ? 3 : 2));
    if (close === -1) { tokens.push({ t: 'text', v: input.slice(open) }); break; }

    let inner = input.slice(open + (triple ? 3 : 2), close).trim();
    let sigil = '';
    if ('#^/&>'.includes(inner[0])) { sigil = inner[0]; inner = inner.slice(1).trim(); }
    if (triple && !sigil) sigil = '&'; // 三重花括号 = 不转义
    tokens.push({ t: 'tag', sigil, name: inner, end: close + (triple ? 3 : 2) });
    i = close + (triple ? 3 : 2);
  }
  return tokens;
}

// 把 token 列表构建成带区间节点的树
function build(tokens) {
  const root = [];
  const stack = [root];
  for (const tk of tokens) {
    if (tk.t === 'text') { stack[stack.length - 1].push(tk); continue; }
    if (tk.sigil === '#' || tk.sigil === '^') {
      const node = { t: 'section', sigil: tk.sigil, name: tk.name, body: [] };
      stack[stack.length - 1].push(node);
      stack.push(node.body);
    } else if (tk.sigil === '/') {
      if (stack.length > 1) stack.pop();
    } else if (tk.sigil === '>') {
      // 局部(partial)暂不支持，跳过
    } else {
      // 支持 {{var|default}} 兜底：普通值或 map:field:k=v 字段映射
      const bar = tk.name.indexOf('|');
      const name = bar === -1 ? tk.name : tk.name.slice(0, bar);
      const def = bar === -1 ? undefined : parseDefault(tk.name.slice(bar + 1));
      stack[stack.length - 1].push({ t: 'var', raw: tk.sigil === '&', name, def });
    }
  }
  return root;
}

function lookup(ctxStack, name) {
  if (name === '.' || name === 'this') return ctxStack[ctxStack.length - 1];
  const parts = name.split('.');
  for (let i = ctxStack.length - 1; i >= 0; i--) {
    let val = ctxStack[i];
    let ok = true;
    for (const p of parts) {
      if (val == null) { ok = false; break; }
      val = val[p];
    }
    if (ok && val !== undefined) return val;
  }
  return undefined;
}

function renderNodes(nodes, ctxStack) {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') { out += n.v; continue; }
    if (n.t === 'var') {
      const v = lookup(ctxStack, n.name);
      if (v == null || v === '') {
        if (n.def == null) {
          out += '';
        } else if (n.def.type === 'const') {
          out += n.raw ? n.def.value : escapeHtml(n.def.value);
        } else { // map: 按另一个字段的当前值选图标
          const keyVal = lookup(ctxStack, n.def.field);
          const mapped = keyVal != null && keyVal in n.def.entries
            ? n.def.entries[keyVal] : n.def.fallback;
          out += (mapped != null && mapped !== '') ? (n.raw ? mapped : escapeHtml(mapped)) : '';
        }
      } else {
        // 处理对象类型：云诊 analysis_table 等为 {detected,standard}，
        // 切勿 String(obj) → "[object Object]"
        let stringValue;
        if (v && typeof v === 'object') {
          stringValue = v.text ?? v.value ?? v.name ?? v.label
            ?? v.detected ?? v.current ?? v.standard ?? v.summary ?? v.desc ?? v.meaning ?? '';
          if (stringValue && typeof stringValue === 'object') {
            stringValue = stringValue.text ?? stringValue.value ?? stringValue.detected ?? '';
          }
          stringValue = stringValue == null ? '' : String(stringValue);
        } else {
          stringValue = String(v);
        }
        if (stringValue === '[object Object]') stringValue = '';
        out += n.raw ? stringValue : escapeHtml(stringValue);
      }
      continue;
    }
    if (n.t === 'section') {
      const v = lookup(ctxStack, n.name);
      if (n.sigil === '#') {
        if (Array.isArray(v)) {
          for (const item of v) out += renderNodes(n.body, [...ctxStack, item]);
        } else if (v && typeof v === 'object') {
          out += renderNodes(n.body, [...ctxStack, v]);
        } else if (typeof v === 'function') {
          out += v.call(ctxStack[ctxStack.length - 1], (t) => renderNodes(n.body, [...ctxStack, t]));
        } else if (v) {
          out += renderNodes(n.body, ctxStack);
        }
      } else { // 反区间 ^
        const empty = v == null || v === false ||
          (Array.isArray(v) && v.length === 0) ||
          (v && typeof v === 'object' && Object.keys(v).length === 0);
        if (empty) out += renderNodes(n.body, ctxStack);
      }
    }
  }
  return out;
}

export function renderTemplate(template, data) {
  const tree = build(tokenize(template));
  return renderNodes(tree, [data]);
}

// 收集模板中引用到的所有变量名（用于选型打分）
export function collectNames(template) {
  const names = new Set();
  const tokens = tokenize(template);
  for (const tk of tokens) {
    if (tk.t === 'tag' && tk.sigil !== '/' && tk.sigil !== '>') {
      names.add(tk.name.split('|')[0]); // 去掉 |default 兜底后缀
    }
  }
  return [...names];
}

// 收集模板「顶层」（不在任何 {{#section}}/{{^section}} 段落内）引用的变量名。
// 段落内部字段由迭代数据（数组元素 / 子对象）提供，不应要求其在顶层 defaultData 中给出默认值；
// 只校验顶层字段，可避免对循环渲染型模板产生「字段未提供默认值」的误报。
export function collectTopLevelNames(template) {
  const names = new Set();
  let depth = 0;
  for (const tk of tokenize(template)) {
    if (tk.t !== 'tag') continue;
    if (tk.sigil === '#' || tk.sigil === '^') { depth++; continue; }
    if (tk.sigil === '/') { if (depth > 0) depth--; continue; }
    if (tk.sigil === '>') continue; // 局部部分跳过
    if (depth === 0) names.add(tk.name.split('|')[0]); // 去掉 |default 兜底后缀
  }
  return [...names];
}

export { escapeHtml };
