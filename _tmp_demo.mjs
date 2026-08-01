import { renderCard, renderPreview } from './src/template-card/index.js';

// 1) renderCard（运行时主路径）：渲染 service_recommend，检查追问按钮是否注入
const r = renderCard('./src/skills/find_service/templates/html', { template_id: 'service_recommend' });
const page = r.pages[0];
const hasFollow = page.includes('tc-followups') && page.includes('data-action=');
console.log('[renderCard] templateId=%s cardCount=%d followupsInjected=%s', r.templateId, r.cardCount, hasFollow);
const acts = [...page.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]);
console.log('[renderCard] followup actions:', JSON.stringify(acts));

// 2) renderPreview（像素级预览）：渲染 dispatch_supplier_action
const p = renderPreview('./src/skills/dispatch_manage/templates/html', 'dispatch_supplier_action');
console.log('[renderPreview] hasFollowups=%s', p.includes('tc-followups'));
const acts2 = [...p.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]);
console.log('[renderPreview] followup actions:', JSON.stringify(acts2));
