// 演示：模板目录 + 大模型返回的 JSON → 置换后的 HTML 卡片
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCard } from '../src/template-card/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS = path.join(__dirname, 'cards');
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

const save = (name, pages) => pages.forEach((html, i) =>
  fs.writeFileSync(path.join(OUT, `${name}${pages.length > 1 ? '_p' + (i + 1) : ''}.html`), html, 'utf8'));

const log = (label, res) => console.log(
  `[${label}] 选中=${res.templateId} 布局=${res.layout} 依据=${res.reason} 卡片数=${res.cardCount} 页数=${res.pageCount}`);

// 场景1：模型指定模板 + 单卡数据（竖向）
const r1 = renderCard(CARDS, {
  template_id: 'health_card',
  data: { title: '王女士今日健康', metrics: [
    { label: '心率', value: '68 bpm' }, { label: '血压', value: '112/74' }, { label: '睡眠', value: '8.1 h' } ],
    foot: '数据更新于 09:30' },
});
save('health_single', r1.pages); log('场景1', r1);

// 场景2：多条健康数据 → 竖向自动重复
const r2 = renderCard(CARDS, {
  items: [
    { title: '周一', metrics: [{ label: '步数', value: '8200' }] },
    { title: '周二', metrics: [{ label: '步数', value: '10400' }] },
    { title: '周三', metrics: [{ label: '步数', value: '7600' }] },
  ],
});
save('health_multi', r2.pages); log('场景2', r2);

// 场景3：路线数组 → 横向自动重复 + 分页(每页2张)
const route = (t, p, n) => ({ time: t, place: p, note: n });
const r3 = renderCard(CARDS, {
  template_id: 'route_card',
  items: [
    route('09:00', '杭州东站', '高铁出发'), route('11:20', '上海虹桥', '换乘地铁'),
    route('12:00', '外滩', '午餐'), route('15:30', '迪士尼', '游玩'), route('20:00', '返程', '高铁回杭'),
  ],
}, { pageLimit: 2 });
save('route', r3.pages); log('场景3', r3);

// 场景4：模型未指定模板 → 字段覆盖率兜底选择
const r4 = renderCard(CARDS, {
  data: { title: '李先生的指标', metrics: [{ label: '体重', value: '70kg' }] },
});
save('auto_select', r4.pages); log('场景4', r4);

console.log('\n输出已写入:', OUT);
