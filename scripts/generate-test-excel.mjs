/**
 * 从 template-test-results.json 生成 Excel 文件
 * 包含：序号、技能包、期望模板、用户输入、实际模板、是否命中、未命中原因、
 *       是否渲染、渲染异常原因、改进方案、耗时
 */
import fs from 'node:fs';

const results = JSON.parse(fs.readFileSync('docs/template-test-results.json', 'utf8'));

// 根据未命中模式生成改进方案
function getImprovement(r) {
  if (r.hit === '是' && r.rendered === '是') return '✅ 正常';
  if (r.hit === '是' && r.rendered === '否') return '模板命中但HTML渲染失败，检查模板数据填充逻辑';

  // 未命中场景分析
  const actual = r.actual_template;
  const expected = r.expected;

  if (!actual && !r.actual_skill) return '模型完全未识别，需在场景路由规则中增加关键词覆盖';
  if (actual === 'answer') return `模型降级到通用回复，"${r.input}"缺少场景路由触发词，建议在scene-router规则集中增加匹配`;
  if (actual === 'policy_card') return `过度路由到政策场景，"${r.input}"被误判为政策咨询，建议增加负面词排除或降低政策场景权重`;
  if (actual === 'fallback_error') return `系统报错降级，可能是数据查询失败（如派单/工单无关联数据），建议增加空数据兜底`;
  if (actual === 'route_card' && expected.startsWith('travel_')) return `旅居场景命中但选了route_card总览卡，应在模型提示词中细化travel_route子模板的选择引导`;
  if (actual === 'nearby_map_overview' && expected !== 'nearby_map_overview') return `nearby场景总被总览卡拦截，应在nearby_resource路由规则中增加子模板分类引导`;
  if (actual === 'service_recommend' && expected.startsWith('service_')) return `服务场景命中但总落在service_recommend，应在模型提示词中细化find_service子模板的选择`;
  if (actual === 'health_warning_card' && expected.startsWith('risk_') || expected === 'dietary_regimen_card') return `健康场景命中但子模板选择不精确，应在模型提示词中增加health_risk子模板描述区分`;

  return `路由偏差：期望${expected}→实际${actual}，建议在manifest的match关键词或description中增加区分度`;
}

const rows = results.map(r => ({
  '序号': r.seq,
  '技能包': r.skill,
  '期望模板': r.expected,
  '用户输入': r.input,
  '实际模板': r.actual_template || '(空)',
  '实际技能': r.actual_skill || '(空)',
  '是否命中': r.hit,
  '未命中原因': r.miss_reason,
  '是否渲染HTML': r.rendered,
  '渲染异常原因': r.render_reason,
  'HTML大小': r.render_size,
  '改进方案': getImprovement(r),
  '耗时(ms)': r.elapsed_ms,
  'AI回复摘要': r.reply_text,
}));

// CSV 生成（Excel兼容UTF-8 BOM）
const headers = Object.keys(rows[0]);
let csv = '\ufeff' + headers.join(',') + '\n';
for (const row of rows) {
  csv += headers.map(h => {
    const val = String(row[h] || '').replace(/"/g, '""');
    return `"${val}"`;
  }).join(',') + '\n';
}
fs.writeFileSync('docs/template-test-results.csv', csv);
console.log(`✅ CSV 生成: docs/template-test-results.csv (${rows.length} 行)`);

// 统计摘要
const stats = {
  total: rows.length,
  hit: rows.filter(r => r['是否命中'] === '是').length,
  rendered: rows.filter(r => r['是否渲染HTML'] === '是').length,
  bySkill: {},
};
for (const r of rows) {
  const s = r['技能包'];
  if (!stats.bySkill[s]) stats.bySkill[s] = { total: 0, hit: 0 };
  stats.bySkill[s].total++;
  if (r['是否命中'] === '是') stats.bySkill[s].hit++;
}
console.log('\n=== 测试统计 ===');
console.log(`总计: ${stats.total} | 命中: ${stats.hit} (${(stats.hit/stats.total*100).toFixed(0)}%) | 渲染: ${stats.rendered}`);
for (const [skill, s] of Object.entries(stats.bySkill)) {
  console.log(`  ${skill}: ${s.hit}/${s.total} (${(s.hit/s.total*100).toFixed(0)}%)`);
}
