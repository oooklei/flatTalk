/**
 * 合并行政区划边界到旅居路线 SVG
 */
import fs from 'node:fs';

// 读取边界 GeoJSON
const bamaGeoJson = JSON.parse(fs.readFileSync('geographicSVG/巴马县边界.geojson', 'utf8'));
const fcgGeoJson = JSON.parse(fs.readFileSync('geographicSVG/防城港市边界.geojson', 'utf8'));

// 提取边界 polygon 坐标
function extractBoundaryPath(geoJson, center, width, height, scale) {
  const feature = geoJson.features?.[0];
  if (!feature) return [];
  
  const geom = feature.geometry;
  const paths = [];
  
  const coordsToSvg = (coords) => {
    return coords.map(([lng, lat]) => ({
      x: width/2 + (lng - center.lng) / scale,
      y: height/2 - (lat - center.lat) / scale,
    }));
  };
  
  if (geom.type === 'Polygon') {
    const points = coordsToSvg(geom.coordinates[0]);
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
    paths.push(d);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      const points = coordsToSvg(poly[0]);
      const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
      paths.push(d);
    }
  }
  
  return paths;
}

// 生成带边界的新 SVG
function generateRouteSvgWithBoundary(routeName, boundaryPaths, center, outputFile) {
  const width = 620;
  const height = 520;
  
  // 缩放参数
  const scale = routeName.includes('巴马') ? 0.012 : 0.02;
  
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 ${width} ${height + 330}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${width}px;background:linear-gradient(180deg,#F5F0E8 0%,#E8F4E8 100%);border-radius:16px;font-family:'PingFang SC','Microsoft YaHei',sans-serif">
  <defs>
    <!-- 行政区边界渐变 -->
    <linearGradient id="boundaryGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#E8F5E9" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#C8E6C9" stop-opacity="0.8"/>
    </linearGradient>
    <!-- 其他渐变 -->
    <linearGradient id="riverGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#64B5F6" stop-opacity="0.7"/><stop offset="100%" stop-color="#1976D2" stop-opacity="0.5"/></linearGradient>
    <linearGradient id="hillGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#81C784" stop-opacity="0.5"/><stop offset="100%" stop-color="#388E3C" stop-opacity="0.3"/></linearGradient>
    <linearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#FF7826"/><stop offset="100%" stop-color="#E65100"/></linearGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.15"/></filter>
    <filter id="glow"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>

  <!-- 标题栏 -->
  <rect x="0" y="0" width="${width}" height="58" rx="16" fill="url(#heroGrad)"/>
  <text x="18" y="38" fill="#fff" font-size="22" font-weight="bold">${routeName}</text>
  <text x="18" y="52" fill="rgba(255,255,255,0.75)" font-size="11">广西·世界长寿之乡</text>

  <!-- 地理底图区域 -->
  <rect x="10" y="68" width="${width-20}" height="${height-20}" rx="12" fill="#F8F8F0" stroke="#DDD" stroke-width="0.5"/>

  <!-- 行政区真实边界（从 GeoJSON 提取） -->
  <g class="district-boundary" filter="url(#shadow)">
    ${boundaryPaths.map(d => `<path d="${d}" fill="url(#boundaryGrad)" stroke="#4CAF50" stroke-width="2" stroke-linejoin="round"/>`).join('\n    ')}
  </g>

  <!-- 叠加河流等地理要素 -->
  <path d="M35,285 Q85,250 140,275 Q200,255 260,280 Q320,265 370,295" fill="none" stroke="url(#riverGrad)" stroke-width="6" stroke-linecap="round" opacity="0.5"/>
  <text x="180" y="270" fill="#1565C0" font-size="10" opacity="0.6">盘阳河</text>

  <!-- 图例 -->
  <g transform="translate(15,${height + 15})">
    <rect width="${width-20}" height="28" rx="6" fill="rgba(255,255,255,0.95)" stroke="#ddd"/>
    <circle cx="20" cy="14" r="5" fill="#4CAF50"/><text x="32" y="18" font-size="10" fill="#333">行政边界</text>
    <circle cx="110" cy="14" r="5" fill="#64B5F6"/><text x="122" y="18" font-size="10" fill="#333">河流</text>
    <text x="${width-80}" y="18" font-size="9" fill="#999">数据来源: 阿里云DataV</text>
  </g>

  <!-- 底部信息栏 -->
  <g transform="translate(10,${height + 50})">
    <rect width="${width-20}" height="70" rx="10" fill="#FFF8F0" stroke="#FFE0B2"/>
    <text x="15" y="20" fill="#E65100" font-size="12" font-weight="bold">康养特色</text>
    <text x="15" y="38" fill="#555" font-size="10">喀斯特地貌·八山一水一分田·年均温18-20℃·冬无严寒夏无酷暑</text>
    <text x="15" y="55" fill="#555" font-size="10">富硒土壤·高地磁·弱碱性水·高负氧离子·瑶医理疗</text>
  </g>
</svg>`;

  fs.writeFileSync(outputFile, svg);
  console.log('已生成:', outputFile);
}

// 巴马
const bamaPaths = extractBoundaryPath(bamaGeoJson, { lat: 24.15, lng: 107.25 }, 620, 520, 0.012);
generateRouteSvgWithBoundary('巴马5天4晚康养旅居路线', bamaPaths, { lat: 24.15, lng: 107.25 }, 'geographicSVG/巴马5天4晚康养旅居-带边界.svg');

// 防城港
const fcgPaths = extractBoundaryPath(fcgGeoJson, { lat: 21.62, lng: 108.35 }, 620, 520, 0.02);
generateRouteSvgWithBoundary('防城港京族滨海文化线', fcgPaths, { lat: 21.62, lng: 108.35 }, 'geographicSVG/防城港京族滨海文化线-带边界.svg');

console.log('\n完成！');