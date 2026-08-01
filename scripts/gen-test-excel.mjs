import fs from 'fs';

const data = JSON.parse(fs.readFileSync('docs/template-test-results.json', 'utf8'));

const improvements = {
  'risk_assessment_card': 'health_risk阈值过低(4)，通用健康咨询应走answer；建议阈值回到5',
  'policy_apply_guide_card': 'infer_intent将"怎么申请"识别为apply，比policy_card更精确，属合理结果',
  'service_recommend': 'infer_intent未区分单卡片vs推荐列表，需增加"一项/单个"关键词',
  'answer': '场景路由未命中或infer_intent关键词不足',
  'service_detail': '"怎么样"命中detail分支，需增加"资质"精确匹配worker',
  'diet_card': '"膳食调养"被meal_plan拦截，health_risk的dietary intent需独立路由',
  'route_card': 'infer_intent未区分"一日游"route与通用route_card',
  'nearby_map_overview': '"清单"关键词权重不够，总览默认拦截；或"附近有医院"被nearby优先',
  'nearby_stay_card': '"只看民宿"命中stay分支，应同时命中category分类视图',
  'travel_need_summary_card': '"方案确认"应命中booking/plan，需增加"方案确认"关键词',
};

const headers = ['序号','技能包','用户输入','期望模板','实际模板','实际技能包','是否命中','未命中原因','是否正常渲染','渲染问题原因','改进方案','耗时(ms)'];
const rows = data.map(r => [
  r.seq, r.skill, r.input, r.expected, r.actual_template, r.actual_skill,
  r.hit, r.miss_reason || '-',
  r.rendered, r.render_reason,
  improvements[r.actual_template] || (r.hit === '是' ? '-' : '需进一步分析路由评分'),
  r.elapsed_ms
]);

// CSV with BOM
let csv = '\uFEFF' + headers.join(',') + '\n';
for (const row of rows) {
  csv += row.map(c => {
    const s = String(c ?? '');
    return s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',') + '\n';
}
fs.writeFileSync('docs/flatTalk模板测试结果_v2.csv', csv, 'utf8');

// 统计
const stats = {};
for (const r of data) {
  if (!stats[r.skill]) stats[r.skill] = { total: 0, hit: 0, avgMs: 0 };
  stats[r.skill].total++;
  if (r.hit === '是') stats[r.skill].hit++;
  stats[r.skill].avgMs += r.elapsed_ms;
}
for (const s in stats) stats[s].avgMs = Math.round(stats[s].avgMs / stats[s].total);

let csv2 = '\uFEFF' + ['技能包','总数','命中数','命中率','平均耗时(ms)'].join(',') + '\n';
for (const s in stats) {
  csv2 += [s, stats[s].total, stats[s].hit, Math.round(stats[s].hit / stats[s].total * 100) + '%', stats[s].avgMs].join(',') + '\n';
}
const totalHit = data.filter(r => r.hit === '是').length;
csv2 += ['总计', data.length, totalHit, Math.round(totalHit / data.length * 100) + '%', Math.round(data.reduce((a, r) => a + r.elapsed_ms, 0) / data.length)].join(',');
fs.writeFileSync('docs/flatTalk模板测试统计_v2.csv', csv2, 'utf8');

console.log('CSV生成完成: ' + totalHit + '/' + data.length + ' 命中');
