/**
 * 独立模板渲染测试 — 旅居路线 + 周边资源
 * 直接用模板自带默认数据渲染每个模板（不经过对话路由/场景识别），
 * 精确测试模板本身的图片化/SVG化/地图/字段填充/显示质量。
 *
 * 输出：src/public/template-render-test.html（独立测试页面，含iframe预览）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCard, renderPreview, discoverTemplates } from '../src/template-card/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const GROUPS = [
  {
    name: '旅居路线',
    skill: 'travel_route',
    dir: path.join(ROOT, 'src', 'skills', 'travel_route', 'templates', 'html'),
    color: '#FF7826',
  },
  {
    name: '周边资源',
    skill: 'find_service',
    dir: path.join(ROOT, 'src', 'skills', 'find_service', 'templates', 'html'),
    color: '#1FA97E',
  },
];

const DEPRECATED = new Set(['sojourn_route']); // 已废弃模板
const NO_FILL = new Set([]); // 已全部补齐 fill 分支（含 service_card/intent/thinking）

// 周边资源中无 HTML 文件但 manifest 存在的"幽灵模板"
const GHOST_TEMPLATES = {
  find_service: ['worker_profile', 'org_profile', 'order_status', 'order_preview'],
};

function detectFeatures(html) {
  return {
    hasSvg: /<svg[\s>]|viewBox|static_svg|data:image\/svg/i.test(html),
    hasImg: /<img[\s>]|data-spot-img|background-image|url\(["']?\/|url\(["']?data:/i.test(html),
    hasMap: /TMap|map\.qq\.com|tencent|腾讯地图/i.test(html),
    hasEmoji: /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{27BF}]|[\u{2190}-\u{21FF}]/u.test(html),
    hasGradient: /linear-gradient|radial-gradient/i.test(html),
    size: Buffer.byteLength(html, 'utf8'),
    unresolvedVars: (html.match(/\{\{[^}]+\}\}/g) || []).length, // 未渲染的 Mustache 占位符
  };
}

function checkFields(html, required, defaultData) {
  const results = {};
  for (const f of required) {
    const hasPlaceholder = html.includes(`{{${f}}}`) || html.includes(`{{{${f}}}}`);
    const hasDefault = defaultData && defaultData[f] !== undefined && defaultData[f] !== '' &&
      !(Array.isArray(defaultData[f]) && defaultData[f].length === 0);
    results[f] = {
      filled: !hasPlaceholder,        // 占位符已被替换 = 已填充
      hasDefault: hasDefault,          // defaultData 中有值
    };
  }
  return results;
}

function renderOne(group, template) {
  // 旅居路线模板多为自包含完整页（内联CSS+JS），用 renderPreview 保留原页结构
  // 周边资源模板多为 Mustache 片段（外链CSS），用 renderCard 内联CSS+填充占位符
  const usePreview = group.skill === 'travel_route';

  try {
    if (usePreview) {
      const html = renderPreview(group.dir, template.id);
      return { html, method: 'preview', reason: '原页渲染' };
    }
    const result = renderCard(group.dir, { template_id: template.id, data: template.defaultData });
    return { html: result.pages[0] || '', method: 'renderCard', reason: result.reason, matchedId: result.templateId };
  } catch (e) {
    return { html: '', method: usePreview ? 'preview' : 'renderCard', error: e.message };
  }
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function run() {
  const all = [];

  for (const group of GROUPS) {
    console.log(`\n=== ${group.name} (${group.skill}) ===`);
    let templates = [];
    try {
      templates = discoverTemplates(group.dir);
    } catch (e) {
      console.error(`  发现模板失败: ${e.message}`);
      continue;
    }

    for (const t of templates) {
      const deprecated = DEPRECATED.has(t.id);
      const noFill = NO_FILL.has(t.id);
      const { html, method, reason, error, matchedId } = renderOne(group, t);

      const features = detectFeatures(html);
      const fieldCheck = checkFields(html, t.required, t.defaultData);
      const filledCount = Object.values(fieldCheck).filter((f) => f.filled).length;

      let status = 'PASS';
      if (error) status = 'ERROR';
      else if (html.length < 300) status = 'WARN';
      else if (features.unresolvedVars > 3) status = 'WARN';
      else if (t.required.length > 0 && filledCount < t.required.length * 0.5) status = 'WARN';

      const item = {
        group: group.name,
        skill: group.skill,
        color: group.color,
        id: t.id,
        file: t.file,
        deprecated,
        noFill,
        status,
        method,
        reason,
        matchedId: matchedId || t.id,
        error,
        features,
        required: t.required,
        fieldCheck,
        filledCount,
        html,
        defaultDataKeys: Object.keys(t.defaultData || {}),
      };
      all.push(item);

      const tag = deprecated ? '🗑' : noFill ? '⚠️' : '';
      console.log(
        `  ${status.padEnd(5)} ${t.id.padEnd(28)} ${tag}`.padEnd(40) +
        ` html=${String(features.size).padStart(6)}B svg=${features.hasSvg ? '✓' : '✗'} img=${features.hasImg ? '✓' : '✗'} map=${features.hasMap ? '✓' : '✗'} emoji=${features.hasEmoji ? '✓' : '✗'} vars=${features.unresolvedVars} fields=${filledCount}/${t.required.length}` +
        (error ? ` ERR=${error}` : '') +
        (matchedId && matchedId !== t.id ? ` → matched:${matchedId}` : ''),
      );
    }

    // 标注幽灵模板（有 manifest 无 HTML）
    const ghosts = GHOST_TEMPLATES[group.skill] || [];
    for (const gid of ghosts) {
      if (!templates.find((t) => t.id === gid)) {
        all.push({
          group: group.name,
          skill: group.skill,
          color: group.color,
          id: gid,
          file: '(无HTML)',
          deprecated: false,
          noFill: false,
          status: 'GHOST',
          method: '-',
          reason: 'manifest存在但无HTML文件',
          matchedId: gid,
          error: '缺少HTML模板文件',
          features: { hasSvg: false, hasImg: false, hasMap: false, hasEmoji: false, hasGradient: false, size: 0, unresolvedVars: 0 },
          required: [],
          fieldCheck: {},
          filledCount: 0,
          html: '',
          defaultDataKeys: [],
        });
        console.log(`  GHOST ${gid.padEnd(28)} 缺少HTML文件`);
      }
    }
  }

  // 把每个模板的渲染结果保存为独立文件（iframe 用 src 引用，避免 srcdoc 转义问题）
  const outDir = path.join(ROOT, 'src', 'public');
  const frameDir = path.join(outDir, '_test_frames');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(frameDir)) fs.mkdirSync(frameDir, { recursive: true });
  for (const r of all) {
    if (r.html) {
      fs.writeFileSync(path.join(frameDir, `${r.skill}__${r.id}.html`), r.html, 'utf8');
    }
  }

  // 生成测试页面
  const report = generateReport(all);
  const outPath = path.join(outDir, 'template-render-test.html');
  fs.writeFileSync(outPath, report, 'utf8');

  const passN = all.filter((r) => r.status === 'PASS').length;
  const warnN = all.filter((r) => r.status === 'WARN').length;
  const errN = all.filter((r) => r.status === 'ERROR').length;
  const ghostN = all.filter((r) => r.status === 'GHOST').length;
  console.log(`\n=== 汇总 ===`);
  console.log(`总计 ${all.length} 个模板: PASS=${passN} WARN=${warnN} ERROR=${errN} GHOST=${ghostN}`);
  console.log(`测试页面: ${outPath}`);
}

function generateReport(results) {
  const passN = results.filter((r) => r.status === 'PASS').length;
  const warnN = results.filter((r) => r.status === 'WARN').length;
  const errN = results.filter((r) => r.status === 'ERROR').length;
  const ghostN = results.filter((r) => r.status === 'GHOST').length;
  const groups = [...new Set(results.map((r) => r.group))];
  const now = new Date().toLocaleString('zh-CN');

  let body = '';
  for (const group of groups) {
    const items = results.filter((r) => r.group === group);
    const color = items[0]?.color || '#333';
    body += `<h2 style="border-color:${color}"><span class="dot" style="background:${color}"></span>${group} <small>(${items.length}个模板)</small></h2>`;
    body += `<div class="card-grid">`;

    for (const r of items) {
      const cls = r.status.toLowerCase();
      const tags = [];
      if (r.deprecated) tags.push('<span class="tag tag-dep">已废弃</span>');
      if (r.noFill) tags.push('<span class="tag tag-nofill">无fill分支</span>');
      if (r.status === 'GHOST') tags.push('<span class="tag tag-ghost">缺HTML</span>');
      if (r.matchedId !== r.id) tags.push(`<span class="tag tag-mismatch">路由→${escapeAttr(r.matchedId)}</span>`);

      const f = r.features;
      const featIcons = [
        f.hasSvg ? '<span class="feat" title="含SVG">🔷</span>' : '<span class="feat off" title="无SVG">⬜</span>',
        f.hasImg ? '<span class="feat" title="含图片">🖼</span>' : '<span class="feat off" title="无图片">⬜</span>',
        f.hasMap ? '<span class="feat" title="含地图">🗺</span>' : '<span class="feat off" title="无地图">⬜</span>',
        f.hasEmoji ? '<span class="feat" title="含图标">✨</span>' : '<span class="feat off" title="无图标">⬜</span>',
        f.hasGradient ? '<span class="feat" title="含渐变">🎨</span>' : '<span class="feat off" title="无渐变">⬜</span>',
      ].join('');

      const fieldBadges = Object.entries(r.fieldCheck).map(([k, v]) =>
        `<span class="key ${v.filled ? 'ok' : 'miss'}" title="默认值:${v.hasDefault ? '有' : '无'}">${k}</span>`,
      ).join(' ');

      const previewBtn = r.html
        ? `<button class="preview-btn" onclick="showPreview('${r.skill}__${r.id}')" style="background:${color}">预览渲染</button>`
        : '<span class="no-preview">无法渲染</span>';

      const meta = r.error
        ? `<div class="meta-error">❌ ${escapeAttr(r.error)}</div>`
        : `<div class="meta-line">${featIcons} <span class="size">${f.size > 0 ? (f.size / 1024).toFixed(1) + 'KB' : '0'}</span> ${f.unresolvedVars > 0 ? `<span class="warn-text">${f.unresolvedVars}个未填充变量</span>` : ''} <span class="reason">${escapeAttr(r.reason)}</span></div>`;

      body += `<div class="tpl-card ${cls}">
        <div class="tpl-head">
          <span class="tpl-id">${r.id}</span>
          <span class="tpl-tags">${tags.join('')}</span>
        </div>
        ${meta}
        ${r.required.length > 0 ? `<div class="fields">${fieldBadges}</div>` : '<div class="fields"><span class="none">无必填字段</span></div>'}
        <div class="tpl-foot">${previewBtn}</div>
      </div>`;

      if (r.html) {
        body += `<div id="pv_${r.skill}__${r.id}" class="modal" style="display:none">
          <div class="modal-bg" onclick="this.parentElement.style.display='none'"></div>
          <div class="modal-box">
            <div class="modal-bar"><b>${r.id}</b> 渲染预览 <button class="modal-x" onclick="this.closest('.modal').style.display='none'">✕</button></div>
            <iframe src="_test_frames/${r.skill}__${r.id}.html"></iframe>
          </div>
        </div>`;
      }
    }
    body += `</div>`;
  }

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>模板渲染独立测试报告</title>
<style>
*{box-sizing:border-box;}
body{margin:0;padding:24px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;background:#f5f6f8;color:#333;line-height:1.5;}
h1{font-size:22px;margin:0 0 4px;}
h2{font-size:17px;margin:28px 0 12px;padding-bottom:6px;border-bottom:3px solid #ddd;display:flex;align-items:center;gap:8px;}
.dot{display:inline-block;width:14px;height:14px;border-radius:50%;flex-shrink:0;}
h2 small{font-weight:400;color:#999;font-size:13px;}
.summary{display:flex;gap:12px;margin:16px 0 8px;flex-wrap:wrap;}
.stat{padding:10px 20px;border-radius:10px;color:#fff;font-size:15px;font-weight:700;}
.stat.total{background:#2196F3}.stat.pass{background:#4CAF50}.stat.warn{background:#FF9800}.stat.error{background:#f44336}.stat.ghost{background:#9E9E9E}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px;}
.tpl-card{background:#fff;border-radius:12px;padding:14px;border:1px solid #e8e8e8;box-shadow:0 1px 4px rgba(0,0,0,.06);display:flex;flex-direction:column;gap:8px;}
.tpl-card.pass{border-left:4px solid #4CAF50;}
.tpl-card.warn{border-left:4px solid #FF9800;background:#fffdf5;}
.tpl-card.error,.tpl-card.ghost{border-left:4px solid #f44336;background:#fef5f5;}
.tpl-head{display:flex;justify-content:space-between;align-items:flex-start;gap:6px;flex-wrap:wrap;}
.tpl-id{font-weight:700;font-size:14px;font-family:monospace;}
.tpl-tags{display:flex;gap:4px;flex-wrap:wrap;}
.tag{font-size:10px;padding:2px 6px;border-radius:4px;font-weight:600;}
.tag-dep{background:#eee;color:#888;}.tag-nofill{background:#fff3e0;color:#e65100;}.tag-ghost{background:#ffebee;color:#c62828;}.tag-mismatch{background:#e3f2fd;color:#1565c0;}
.meta-line{font-size:12px;color:#666;display:flex;align-items:center;gap:4px;flex-wrap:wrap;}
.meta-error{font-size:12px;color:#c62828;background:#ffebee;padding:4px 8px;border-radius:4px;}
.feat{font-size:14px;}.feat.off{opacity:.25;}
.size{font-weight:600;color:#555;}
.warn-text{color:#e65100;font-weight:600;}
.reason{color:#aaa;font-size:11px;}
.fields{display:flex;flex-wrap:wrap;gap:3px;}
.key{font-size:10px;padding:2px 6px;border-radius:3px;font-family:monospace;}
.key.ok{background:#c8e6c9;color:#2e7d32;}
.key.miss{background:#ffcdd2;color:#c62828;text-decoration:line-through;}
.none{font-size:11px;color:#bbb;}
.tpl-foot{margin-top:auto;padding-top:6px;}
.preview-btn{border:0;border-radius:6px;color:#fff;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer;}
.preview-btn:hover{opacity:.85;}
.no-preview{font-size:12px;color:#ccc;}
.modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;}
.modal-bg{position:absolute;inset:0;background:rgba(0,0,0,.6);}
.modal-box{position:relative;background:#fff;border-radius:12px;width:92%;max-width:440px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.25);}
.modal-bar{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#f5f5f5;font-size:14px;}
.modal-x{border:0;background:#f44336;color:#fff;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:14px;}
.modal-box iframe{width:100%;height:560px;border:0;display:block;}
.info-box{background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:12px 16px;margin:12px 0;font-size:13px;color:#795000;}
</style></head><body>
<h1>模板渲染独立测试报告</h1>
<p style="color:#888;font-size:13px;margin:0 0 8px">生成时间: ${now} · 直接用模板自带默认数据渲染，不经过对话路由/场景识别</p>
<div class="summary">
  <div class="stat total">总计 ${results.length}</div>
  <div class="stat pass">PASS ${passN}</div>
  <div class="stat warn">WARN ${warnN}</div>
  <div class="stat error">ERROR ${errN}</div>
  ${ghostN > 0 ? `<div class="stat ghost">GHOST ${ghostN}</div>` : ''}
</div>
<div class="info-box">
  🔷=SVG &nbsp; 🖼=图片 &nbsp; 🗺=地图 &nbsp; ✨=图标 &nbsp; 🎨=渐变<br>
  <b>PASS</b>: 正常渲染 &nbsp; <b>WARN</b>: 渲染异常（HTML过小/未填充变量过多/必填字段缺失） &nbsp; <b>ERROR</b>: 渲染失败 &nbsp; <b>GHOST</b>: 有manifest无HTML
</div>
${body}
<script>
function showPreview(id){document.getElementById('pv_'+id).style.display='flex';}
</script>
</body></html>`;
}

run();
