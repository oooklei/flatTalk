import fs from 'fs';
import ExcelJS from 'exceljs';

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

const wb = new ExcelJS.Workbook();

// === Sheet 1: 详细测试结果 ===
const ws = wb.addWorksheet('模板测试结果', {
  views: [{ state: 'frozen', ySplit: 1 }],
  properties: { defaultRowHeight: 20 },
});

const headers = [
  { header: '序号', key: 'seq', width: 6 },
  { header: '技能包', key: 'skill', width: 18 },
  { header: '用户输入', key: 'input', width: 22 },
  { header: '期望模板', key: 'expected', width: 26 },
  { header: '实际模板', key: 'actual', width: 26 },
  { header: '实际技能包', key: 'actualSkill', width: 18 },
  { header: '是否命中', key: 'hit', width: 8 },
  { header: '未命中原因', key: 'reason', width: 28 },
  { header: '是否正常渲染', key: 'rendered', width: 10 },
  { header: '渲染问题原因', key: 'renderReason', width: 18 },
  { header: '改进方案', key: 'improve', width: 50 },
  { header: '耗时(ms)', key: 'elapsed', width: 10 },
];

ws.columns = headers;

// 表头样式
const headerRow = ws.getRow(1);
headerRow.height = 28;
headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

// 数据行
for (const r of data) {
  const improve = improvements[r.actual_template] || (r.hit === '是' ? '-' : '需进一步分析路由评分');
  const row = ws.addRow({
    seq: r.seq,
    skill: r.skill,
    input: r.input,
    expected: r.expected,
    actual: r.actual_template,
    actualSkill: r.actual_skill,
    hit: r.hit,
    reason: r.miss_reason || '-',
    rendered: r.rendered,
    renderReason: r.render_reason,
    improve,
    elapsed: r.elapsed_ms,
  });
  row.alignment = { vertical: 'middle', wrapText: true };
  // 命中行绿色，未命中行红色
  if (r.hit === '是') {
    row.getCell('hit').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
    row.getCell('hit').font = { color: { argb: 'FF006100' } };
  } else {
    row.getCell('hit').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
    row.getCell('hit').font = { color: { argb: 'FF9C0006' } };
  }
  // 渲染列着色
  if (r.rendered === '是') {
    row.getCell('rendered').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
  } else {
    row.getCell('rendered').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
  }
}

// 边框
ws.eachRow((row) => {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    };
  });
});

// === Sheet 2: 统计摘要 ===
const ws2 = wb.addWorksheet('统计摘要');

const stats = {};
for (const r of data) {
  if (!stats[r.skill]) stats[r.skill] = { total: 0, hit: 0, avgMs: 0 };
  stats[r.skill].total++;
  if (r.hit === '是') stats[r.skill].hit++;
  stats[r.skill].avgMs += r.elapsed_ms;
}
for (const s in stats) stats[s].avgMs = Math.round(stats[s].avgMs / stats[s].total);

ws2.columns = [
  { header: '技能包', key: 'skill', width: 22 },
  { header: '总数', key: 'total', width: 8 },
  { header: '命中数', key: 'hit', width: 8 },
  { header: '命中率', key: 'rate', width: 10 },
  { header: '平均耗时(ms)', key: 'avgMs', width: 14 },
];

// 表头
const hr2 = ws2.getRow(1);
hr2.height = 28;
hr2.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
hr2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
hr2.alignment = { vertical: 'middle', horizontal: 'center' };

for (const s of Object.keys(stats)) {
  const st = stats[s];
  ws2.addRow({ skill: s, total: st.total, hit: st.hit, rate: Math.round(st.hit / st.total * 100) + '%', avgMs: st.avgMs });
}

const totalHit = data.filter(r => r.hit === '是').length;
ws2.addRow({ skill: '总计', total: data.length, hit: totalHit, rate: Math.round(totalHit / data.length * 100) + '%', avgMs: Math.round(data.reduce((a, r) => a + r.elapsed_ms, 0) / data.length) });

// 总计行加粗
const lastRow = ws2.getRow(ws2.rowCount);
lastRow.font = { bold: true };
lastRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

// 边框
ws2.eachRow((row) => {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    };
  });
});

// === Sheet 3: 优化历程 ===
const ws3 = wb.addWorksheet('优化历程');
ws3.columns = [
  { header: '轮次', key: 'round', width: 10 },
  { header: '命中数', key: 'hit', width: 10 },
  { header: '命中率', key: 'rate', width: 10 },
  { header: '主要修改', key: 'desc', width: 70 },
];
const hr3 = ws3.getRow(1);
hr3.font = { bold: true, color: { argb: 'FFFFFFFF' } };
hr3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
hr3.alignment = { vertical: 'middle', horizontal: 'center' };

const rounds = [
  { round: '修复前', hit: 14, rate: '25%', desc: '基线：elder-policy宽泛词误拦截20个 + 硬编码模板映射 + policy兜底' },
  { round: '第一轮', hit: 18, rate: '32%', desc: '新增intent-template-map.js + selectRoutedTemplateId改造 + 兜底改answer' },
  { round: '第二轮', hit: 18, rate: '32%', desc: '微调：health关键词降权 + find_service阈值 + "养老"→"养老服务"' },
  { round: '第三轮', hit: 23, rate: '41%', desc: 'find_service移除宽泛词 + travel_route infer_intent细化(11%→78%)' },
  { round: '第四轮', hit: 35, rate: '63%', desc: 'dispatch/meal/nearby/health全面扩充关键词+infer_intent+阈值调整' },
  { round: '第五轮', hit: 40, rate: '71%', desc: 'find_service子模板精确区分 + elder_policy list intent + nearby阈值微调' },
];
for (const r of rounds) ws3.addRow(r);
ws3.getRow(ws3.rowCount).font = { bold: true };
ws3.getRow(ws3.rowCount).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };

ws3.eachRow((row) => {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' },
    };
  });
});

await wb.xlsx.writeFile('docs/flatTalk模板测试结果_v2.xlsx');
console.log('Excel生成完成: 40/56 命中');
