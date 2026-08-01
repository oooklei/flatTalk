// MD → DOCX 转换脚本
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, AlignmentType } from 'docx';
import fs from 'fs';

const md = fs.readFileSync('docs/flatTalk模板配置语义手册_v1.0.md', 'utf8');
const lines = md.split('\n');
const elements = [];

let inTable = false;
let tableRows = [];

function flushTable() {
  if (tableRows.length === 0) return;
  // 跳过分隔行 |---|---|
  const dataRows = tableRows.filter(r => !r.match(/^\|[\s-:|]+\|$/));
  if (dataRows.length === 0) { tableRows = []; inTable = false; return; }

  const rows = dataRows.map(rowStr => {
    const cells = rowStr.split('|').filter((_, i, a) => i > 0 && i < a.length - 1);
    return new TableRow({
      children: cells.map(c => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: c.trim(), size: 18, font: '微软雅黑' })] })],
        width: { size: Math.floor(100 / cells.length), type: WidthType.PERCENTAGE },
      })),
    });
  });

  elements.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
  elements.push(new Paragraph({ text: '' })); // 表后空行
  tableRows = [];
  inTable = false;
}

for (const line of lines) {
  if (line.startsWith('| ') || line.match(/^\|[-:\s|]+\|$/)) {
    inTable = true;
    tableRows.push(line);
    continue;
  }
  if (inTable) flushTable();

  if (line.startsWith('# ')) {
    elements.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
  } else if (line.startsWith('## ')) {
    elements.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
  } else if (line.startsWith('### ')) {
    elements.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } }));
  } else if (line.startsWith('---')) {
    elements.push(new Paragraph({ text: '', border: { bottom: { color: 'CCCCCC', style: 'single', size: 6 } } }));
  } else if (line.startsWith('> ')) {
    elements.push(new Paragraph({ children: [new TextRun({ text: line.slice(2), italics: true, color: '666666', size: 18 })] }));
  } else if (line.trim()) {
    elements.push(new Paragraph({ children: [new TextRun({ text: line, size: 20, font: '微软雅黑' })] }));
  } else {
    elements.push(new Paragraph({ text: '' }));
  }
}
if (inTable) flushTable();

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: '微软雅黑', size: 20 } },
    },
  },
  sections: [{ children: elements }],
});

const buf = await Packer.toBuffer(doc);
fs.writeFileSync('docs/flatTalk模板配置语义手册_v1.0.docx', buf);
console.log('✅ docx 生成成功', buf.length, 'bytes');
