// 生成巴马5天4晚康养旅居 HTML 并打开预览
import { generateRouteHtml } from '../src/core/route-svg-generator.js';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const outFile = path.join(ROOT, 'geographicSVG', 'preview-bama-5d4n.html');

const waypoints = [
  { name: '巴马县城', lat: 24.12, lng: 107.25, type: 'arrival', day: 'Day1', plan: '抵达巴马，入住康养基地',
    spot_desc: '巴马瑶族自治县县城，世界长寿之乡核心区。海拔600-800米，地磁强度适中，空气负氧离子高达2-7万个/cm³，盘阳河穿城而过，是康养旅居的集散中心。' },
  { name: '百魔洞', lat: 24.15, lng: 107.05, type: 'spot', day: 'Day2', plan: '天下第一洞·负氧离子磁疗',
    spot_images: ['https://dimg04.c-ctrip.com/images/1mf2h12000be4fpbd5CEC_W_640_0_Q90.jpg'],
    spot_desc: '百魔洞是巴马最著名的溶洞景点，洞内钟乳石千姿百态，洞内富含负氧离子和地磁，被誉为天然氧吧和磁场养生圣地。' },
  { name: '长寿村', lat: 24.10, lng: 107.15, type: 'wellness', day: 'Day3', plan: '探访百岁老人·养生文化',
    spot_images: ['https://www.gxlvyouwang.com/uploads/allimg/20250806/1-250P6000045507.jpg'],
    spot_desc: '长寿村即巴盘屯，是世界著名的长寿之乡。村内百岁老人众多，被誉为世界长寿之乡的典型代表。' },
  { name: '命河', lat: 24.12, lng: 107.10, type: 'spot', day: 'Day3', plan: '命字河道奇观',
    spot_images: ['https://imgs.tom.com/travel/202203/1552028316/CONTENTe016426849834b0b.jpg'],
    spot_desc: '命河是盘阳河的一段，因河道蜿蜒曲折形似命字而得名，河水清澈见底，两岸青山翠绿。' },
  { name: '百鸟岩', lat: 24.18, lng: 107.00, type: 'spot', day: 'Day4', plan: '乘船穿越三天三夜',
    spot_images: ['https://dimg04.c-ctrip.com/images/1mf6o12000be4fnjz1ADB_W_640_0_Q90.jpg'],
    spot_desc: '百鸟岩是巴马第二大溶洞景观，洞内钟乳石洁白晶莹，似鸟似兽，惟妙惟肖。' },
  { name: '水晶宫', lat: 24.30, lng: 106.95, type: 'spot', day: 'Day4', plan: '溶洞天花板·鹅管群',
    spot_images: ['https://www.365135.com/upimg/userup/2509/0210525224Q.jpg'],
    spot_desc: '水晶宫以晶莹剔透的钟乳石闻名，洞内石笋、石幔、石花遍布，宛如水晶宫殿，被誉为地下艺术宫殿。' },
  { name: '赐福湖', lat: 24.08, lng: 107.30, type: 'wellness', day: 'Day5', plan: '百岛长湖·游船疗养',
    spot_images: ['https://static.gxrb.com.cn/image/uploadpic/20250711/e4f615339c84ec5c514998b9ba95d6b4.jpg'],
    spot_desc: '赐福湖是巴马最大的人工湖，湖水清澈，四周青山环抱，湖畔有长寿岛等景点，是康养度假的理想之地。' },
  { name: '返程', lat: 24.12, lng: 107.25, type: 'departure', day: 'Day5', plan: '盘阳河漂流·返程',
    spot_desc: '结束愉快康养之旅，沿盘阳河畔返程。盘阳河是巴马母亲河，沿岸风光旖旎，负氧离子含量极高。' },
];

const result = await generateRouteHtml(
  '巴马5天4晚康养旅居',
  '世界长寿之乡5天4晚深度康养，涵盖百魔洞磁疗、长寿村文化、命河奇观、百鸟岩水晶宫溶洞、赐福湖疗养。',
  {
    waypoints,
    destination: '巴马',
    season: '四季皆宜',
    budgetLevel: '经济舒适',
    priceLabel: '¥2980起',
    suitable: '60—75周岁无重大基础病活力长者',
    highlights: ['百魔洞负氧离子2-7万/cm³', '长寿村7位百岁老人', '命河"命"字河道奇观', '水晶宫全球最大卷曲石花', '赐福湖百岛长湖疗养'],
    healthNotice: '巴马海拔600-800米，昼夜温差较大，建议携带保暖衣物。百魔洞内湿滑，请穿防滑鞋。',
  }
);

fs.writeFileSync(outFile, result.html, 'utf8');
console.log('HTML 已生成:', outFile);
console.log('文件大小:', (result.html.length / 1024).toFixed(1) + 'KB');
console.log('SVG 大小:', (result.svg.length / 1024).toFixed(1) + 'KB');
if (result.warnings.length) console.log('warnings:', result.warnings.join('; '));

// 自动打开浏览器
const cmd = process.platform === 'win32' ? `start "" "${outFile}"` : `open "${outFile}"`;
exec(cmd, () => console.log('浏览器已打开'));
