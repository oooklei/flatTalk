/**
 * 使用腾讯地图 API 获取行政区划边界，生成带真实轮廓的 SVG 地图
 */
import 'dotenv/config';
import { TencentMapAdapter } from '../src/services/map/tencent-map-adapter.js';
import fs from 'node:fs';
import path from 'node:path';

const adapter = new TencentMapAdapter();

// 巴马瑶族自治县中心坐标
const BAMA_CENTER = { lat: 24.15, lng: 107.25 };
// 防城港市中心坐标
const FCG_CENTER = { lat: 21.62, lng: 108.35 };

/**
 * 将经纬度坐标转换为 SVG 坐标
 * @param {Array<{lat: number, lng: number}>} points - 经纬度坐标数组
 * @param {{lat: number, lng: number}} center - 中心点
 * @param {number} width - SVG 宽度
 * @param {number} height - SVG 高度
 * @param {number} scale - 缩放比例（度数/像素）
 */
function coordsToSvg(points, center, width, height, scale = 0.008) {
  const halfW = width / 2;
  const halfH = height / 2;
  return points.map(p => ({
    x: halfW + (p.lng - center.lng) / scale,
    y: halfH - (p.lat - center.lat) / scale, // Y 轴翻转
  }));
}

/**
 * 生成 SVG path 的 d 属性
 */
function pointsToPath(points) {
  if (!points.length) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
}

async function fetchBoundaryAndGenerateSvg(keyword, center, outputFile, options = {}) {
  console.log(`正在获取【${keyword}】行政区划边界...`);

  const boundary = await adapter.getDistrictBoundary(keyword);
  if (!boundary.ok) {
    console.error('获取边界失败:', boundary.message);
    return null;
  }

  console.log(`成功获取【${boundary.name}】边界，adcode: ${boundary.adcode}，polygon 数量: ${boundary.polygons.length}`);

  // 保存边界数据
  const boundaryFile = outputFile.replace('.svg', '-boundary.json');
  fs.writeFileSync(boundaryFile, JSON.stringify(boundary, null, 2));
  console.log('边界数据已保存到:', boundaryFile);

  // 生成 SVG
  const { width = 620, height = 520 } = options;
  const svgPaths = boundary.polygons.map(poly => {
    const svgPoints = coordsToSvg(poly, center, width, height);
    return pointsToPath(svgPoints);
  });

  // 简单 SVG 模板（仅包含轮廓）
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${width}px;background:#f5f5f5;border-radius:12px;font-family:'PingFang SC','Microsoft YaHei',sans-serif">
  <defs>
    <linearGradient id="boundaryGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#E8F5E9" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#C8E6C9" stop-opacity="0.7"/>
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.1"/>
    </filter>
  </defs>

  <!-- 行政区轮廓 -->
  <g class="district-boundary" filter="url(#shadow)">
    ${svgPaths.map(d => `<path d="${d}" fill="url(#boundaryGrad)" stroke="#4CAF50" stroke-width="2" stroke-linejoin="round"/>`).join('\n    ')}
  </g>

  <!-- 中心标记 -->
  <circle cx="${width/2}" cy="${height/2}" r="8" fill="#FF7826" stroke="#fff" stroke-width="2"/>
  <text x="${width/2}" y="${height/2 + 25}" text-anchor="middle" font-size="14" fill="#333" font-weight="bold">${boundary.name}</text>
</svg>`;

  fs.writeFileSync(outputFile, svg);
  console.log('SVG 已保存到:', outputFile);
  return { boundary, svgPaths };
}

async function main() {
  const outputDir = 'geographicSVG';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 巴马县边界
  await fetchBoundaryAndGenerateSvg(
    '巴马瑶族自治县',
    BAMA_CENTER,
    path.join(outputDir, '巴马县边界.svg')
  );

  // 防城港市边界
  await fetchBoundaryAndGenerateSvg(
    '防城港市',
    FCG_CENTER,
    path.join(outputDir, '防城港市边界.svg')
  );

  console.log('\n完成！接下来可以基于这些边界数据生成完整路线图。');
}

main().catch(console.error);