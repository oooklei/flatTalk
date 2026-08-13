// ============================================================
// 测试 generateRouteHtml：用巴马/防城港/北海三条线路测试
// 输出 HTML 文件到 geographicSVG/preview-{routeId}.html 可浏览器打开
// ============================================================
import { generateRouteHtml } from '../src/core/route-svg-generator.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const outDir = path.join(ROOT, 'geographicSVG');
let totalPass = 0, totalFail = 0;

// ------------------------------------------------------------
// 测试线路1：巴马5天4晚（含完整 waypoints + 真实图片描述）
// ------------------------------------------------------------
const bamaWaypoints = [
  { name: '巴马县城', lat: 24.12, lng: 107.25, type: 'arrival', day: 'Day1', plan: '抵达巴马，入住康养基地',
    spot_desc: '巴马瑶族自治县县城，世界长寿之乡核心区。海拔600-800米，地磁强度适中，空气负氧离子高达2-7万个/cm³。' },
  { name: '百魔洞', lat: 24.15, lng: 107.05, type: 'spot', day: 'Day2', plan: '天下第一洞·负氧离子磁疗',
    spot_images: ['https://dimg04.c-ctrip.com/images/1mf2h12000be4fpbd5CEC_W_640_0_Q90.jpg'],
    spot_desc: '百魔洞是巴马最著名的溶洞景点，洞内富含负氧离子和地磁，被誉为天然氧吧和磁场养生圣地。' },
  { name: '长寿村', lat: 24.10, lng: 107.15, type: 'wellness', day: 'Day3', plan: '探访百岁老人·养生文化',
    spot_images: ['https://www.gxlvyouwang.com/uploads/allimg/20250806/1-250P6000045507.jpg'],
    spot_desc: '长寿村即巴盘屯，是世界著名的长寿之乡。村内百岁老人众多，是养生康居的理想之地。' },
  { name: '水晶宫', lat: 24.30, lng: 106.95, type: 'spot', day: 'Day4', plan: '溶洞天花板·鹅管群',
    spot_images: ['https://www.365135.com/upimg/userup/2509/0210525224Q.jpg'],
    spot_desc: '水晶宫以其晶莹剔透的钟乳石闻名，洞内石笋、石幔遍布，宛如水晶宫殿。' },
  { name: '赐福湖', lat: 24.08, lng: 107.30, type: 'wellness', day: 'Day5', plan: '百岛长湖·游船疗养',
    spot_images: ['https://static.gxrb.com.cn/image/uploadpic/20250711/e4f615339c84ec5c514998b9ba95d6b4.jpg'],
    spot_desc: '赐福湖是巴马最大的人工湖，四周青山环抱，是康养度假的理想之地。' },
  { name: '返程', lat: 24.12, lng: 107.25, type: 'departure', day: 'Day5', plan: '盘阳河畔·返程' },
];

// ------------------------------------------------------------
// 测试线路2：防城港京族滨海文化3天2晚（含 waypoints）
// ------------------------------------------------------------
const fcgWaypoints = [
  { name: '防城港市区', lat: 21.69, lng: 108.35, type: 'arrival', day: 'Day1', plan: '抵达防城港，入住海滨酒店',
    spot_desc: '防城港是广西北部湾畔的滨海城市，拥有京族海洋文化和优美海岸线。' },
  { name: '白浪滩', lat: 21.55, lng: 108.22, type: 'spot', day: 'Day1', plan: '金色沙滩漫步',
    spot_images: ['https://dimg04.c-ctrip.com/images/300m1200000rxn2g8C7AE_W_640_0_Q90.jpg'],
    spot_desc: '白浪滩是防城港最著名的海滩，沙滩宽阔平缓，沙质细腻，是滨海休闲的绝佳去处。' },
  { name: '京族三岛', lat: 21.54, lng: 107.97, type: 'spot', day: 'Day2', plan: '京族哈节文化体验',
    spot_images: ['https://dimg04.c-ctrip.com/images/300j1200000rpj7D8C2C2_W_640_0_Q90.jpg'],
    spot_desc: '京族三岛（万尾、巫头、山心）是中国唯一海洋民族京族的聚居地，有独特的踩高跷捕鱼、哈节文化。' },
  { name: '东兴口岸', lat: 21.54, lng: 107.97, type: 'spot', day: 'Day3', plan: '中越边境口岸观光',
    spot_desc: '东兴口岸是中国与越南的重要边境口岸，可远眺越南芒街，体验跨国边境风情。' },
  { name: '返程', lat: 21.69, lng: 108.35, type: 'departure', day: 'Day3', plan: '返回防城港' },
];

// ------------------------------------------------------------
// 测试线路3：北海银滩康养4天3晚（纯文本描述，测试自动解析）
// ------------------------------------------------------------
const beihaiDescription = `北海银滩康养4天3晚线路。
亮点：银滩白沙滩、涠洲岛火山地质、老街历史文化、海洋康养。
Day1 北海银滩(21.45,109.12) 抵达北海，银滩漫步
Day2 涠洲岛(21.03,109.15) 火山岛观光，珊瑚礁潜水
Day3 北海老街(21.49,109.12) 百年骑楼老街，品尝海鲜
Day4 返程(21.48,109.12) 整理行装，结束旅程`;

// ============================================================
// 执行测试
// ============================================================
const tests = [
  {
    name: '巴马5天4晚康养旅居',
    desc: '世界长寿之乡，负氧离子天堂，地磁康养圣地。亮点：百魔洞地磁养生、长寿村探访百岁老人、水晶宫地下艺术宫殿。',
    opts: {
      waypoints: bamaWaypoints,
      destination: '巴马',
      season: '四季皆宜',
      budgetLevel: '经济舒适',
      priceLabel: '¥2980起',
      suitable: '60-75周岁活力长者',
      highlights: ['百魔洞地磁养生', '长寿村百岁老人', '水晶宫地下宫殿', '赐福湖湖畔康养'],
      healthNotice: '巴马海拔较高，昼夜温差大，建议携带保暖衣物。',
    },
  },
  {
    name: '防城港京族滨海文化3天2晚',
    desc: '北部湾滨海康养，京族海洋文化体验。亮点：白浪滩金色沙滩、京族三岛踩高跷捕鱼、东兴中越口岸。',
    opts: {
      waypoints: fcgWaypoints,
      destination: '防城港',
      season: '秋冬适宜',
      budgetLevel: '经济舒适',
      priceLabel: '¥1980起',
      suitable: '全年龄段滨海度假',
      highlights: ['白浪滩金色沙滩', '京族三岛海洋文化', '东兴中越口岸', '北部湾海鲜'],
      healthNotice: '海边紫外线强，注意防晒；游泳需在指定区域。',
    },
  },
  {
    name: '北海银滩康养4天3晚',
    desc: beihaiDescription,
    opts: {
      destination: '北海',
      season: '四季皆宜',
      budgetLevel: '经济型',
      suitable: '家庭度假、银发康养',
      highlights: ['银滩白沙滩', '涠洲岛火山地质', '老街历史文化'],
      healthNotice: '涠洲岛船程约1小时，晕船者请提前服药。',
    },
  },
];

console.log('='.repeat(60));
console.log('generateRouteHtml 多线路测试');
console.log('='.repeat(60));

for (const t of tests) {
  console.log(`\n--- 测试: ${t.name} ---`);
  try {
    const result = await generateRouteHtml(t.name, t.desc, t.opts);

    // 验证结果
    const checks = {
      'html 非空': !!result.html && result.html.length > 100,
      'svg 非空': !!result.svg && result.svg.includes('<svg'),
      'html 含 route-card': result.html.includes('route-card'),
      'html 含 staticSvgData': result.html.includes('staticSvgData') || result.html.includes('static_svg'),
      'svg 含 district-boundary': result.svg.includes('district-boundary'),
      'svg 含 route-marker': result.svg.includes('route-marker'),
      'svg 含 data-spot-desc': result.svg.includes('data-spot-desc'),
      'svg 无 Tavily 字样': !result.svg.toLowerCase().includes('tavily'),
      'svg 无"数据来源"': !result.svg.includes('数据来源'),
      'warnings 可接受': result.warnings.length === 0 || !result.warnings.some((w) => w.includes('模板渲染失败')),
    };

    let pass = 0, fail = 0;
    for (const [name, ok] of Object.entries(checks)) {
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
      if (ok) pass++; else fail++;
    }
    totalPass += pass;
    totalFail += fail;

    if (result.warnings.length > 0) {
      console.log('  warnings:', result.warnings.join('; '));
    }

    // 保存预览 HTML
    const routeId = result.routeData.route_id;
    const outPath = path.join(outDir, `preview-${routeId}.html`);
    fs.writeFileSync(outPath, result.html, 'utf8');
    console.log(`  HTML: ${(result.html.length / 1024).toFixed(1)}KB, SVG: ${(result.svg.length / 1024).toFixed(1)}KB → ${outPath}`);

  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    totalFail++;
  }
}

console.log('\n' + '='.repeat(60));
console.log(`总计: ${totalPass} PASS, ${totalFail} FAIL`);
console.log('='.repeat(60));
process.exit(totalFail > 0 ? 1 : 0);
