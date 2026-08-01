/**
 * CSV → XLSX 转换
 */
import fs from 'node:fs';
import { utils, writeFile } from 'xlsx';

const csv = fs.readFileSync('docs/template-test-results.csv', 'utf8').replace(/^\ufeff/, '');
const lines = csv.split('\n').filter(l => l.trim());
const headers = parseCsvLine(lines[0]);
const rows = lines.slice(1).map(parseCsvLine);

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else { current += ch; }
  }
  result.push(current);
  return result;
}

const aoa = [headers, ...rows];
const ws = utils.aoa_to_sheet(aoa);

// 设置列宽
ws['!cols'] = headers.map((h, i) => {
  const widths = { '序号': 6, '技能包': 16, '期望模板': 22, '用户输入': 20, '实际模板': 22, '实际技能': 16,
    '是否命中': 8, '未命中原因': 30, '是否渲染HTML': 10, '渲染异常原因': 24, 'HTML大小': 10,
    '改进方案': 45, '耗时(ms)': 10, 'AI回复摘要': 40 };
  return { wch: widths[h] || 15 };
});

// 条件格式：命中列红色/绿色
const hitsCol = headers.indexOf('是否命中');
for (let r = 1; r <= rows.length; r++) {
  const cellAddr = utils.encode_cell({ r, c: hitsCol });
  if (ws[cellAddr]) {
    ws[cellAddr].s = ws[cellAddr].v === '是'
      ? { font: { color: { rgb: '008000' }, bold: true } }
      : { font: { color: { rgb: 'FF0000' } } };
  }
}

const wb = utils.book_new();
utils.book_append_sheet(wb, ws, '模板测试结果');

// 第二页：统计摘要
const statsData = [
  ['技能包', '总数', '命中', '命中率'],
  ['common', 5, 2, '40%'],
  ['find_service', 13, 4, '31%'],
  ['dispatch_manage', 7, 2, '29%'],
  ['health_risk_warning', 5, 0, '0%'],
  ['meal_plan', 5, 2, '40%'],
  ['nearby_resource', 12, 3, '25%'],
  ['travel_route', 9, 1, '11%'],
  ['总计', 56, 14, '25%'],
];
const ws2 = utils.aoa_to_sheet(statsData);
ws2['!cols'] = [{ wch: 22 }, { wch: 8 }, { wch: 8 }, { wch: 10 }];
utils.book_append_sheet(wb, ws2, '统计摘要');

writeFile(wb, 'docs/flatTalk模板测试结果.xlsx');
console.log('✅ XLSX 生成: docs/flatTalk模板测试结果.xlsx');
