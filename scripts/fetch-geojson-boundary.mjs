/**
 * 从阿里云 DataV 获取行政区划 GeoJSON 边界数据
 * 免费、无需 API key
 */
import https from 'node:https';
import fs from 'node:fs';

const GEO_JSON_BASE = 'https://geo.datav.aliyun.com/areas_v3/bound';

/**
 * 获取区县 GeoJSON 数据
 * @param {string} adcode - 行政区划代码（如巴马县：451227）
 */
function fetchGeoJSON(adcode) {
  return new Promise((resolve, reject) => {
    // 不带 _full 后缀
    const url = `${GEO_JSON_BASE}/${adcode}.json`;
    console.log('Fetching:', url);
    
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * GeoJSON 坐标转 SVG path
 * GeoJSON 格式：[lng, lat]
 */
function geoJsonToSvgPath(coordinates, center, width, height, scale = 0.01) {
  const paths = [];
  
  // 处理 MultiPolygon（多个多边形）
  if (coordinates[0]?.[0]?.[0]?.length === 2) {
    // MultiPolygon: [[[[lng,lat],...]]]
    for (const polygon of coordinates) {
      const outerRing = polygon[0]; // 外环
      const points = outerRing.map(([lng, lat]) => ({
        x: width/2 + (lng - center.lng) / scale,
        y: height/2 - (lat - center.lat) / scale,
      }));
      const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
      paths.push(d);
    }
  } else if (coordinates[0]?.[0]?.length === 2) {
    // Polygon: [[[lng,lat],...]]
    const outerRing = coordinates[0];
    const points = outerRing.map(([lng, lat]) => ({
      x: width/2 + (lng - center.lng) / scale,
      y: height/2 - (lat - center.lat) / scale,
    }));
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
    paths.push(d);
  }
  
  return paths;
}

async function generateBoundarySvg(adcode, name, center, outputFile, scale = 0.01) {
  console.log(`\n=== 生成【${name}】边界 SVG ===`);
  
  const geoJson = await fetchGeoJSON(adcode);
  console.log('GeoJSON features:', geoJson.features?.length || 0);
  
  // 保存 GeoJSON
  const geoJsonFile = outputFile.replace('.svg', '.geojson');
  fs.writeFileSync(geoJsonFile, JSON.stringify(geoJson, null, 2));
  console.log('GeoJSON 已保存:', geoJsonFile);
  
  const width = 620;
  const height = 520;
  
  // 提取所有 polygon
  const allPaths = [];
  for (const feature of geoJson.features || []) {
    const geom = feature.geometry;
    if (geom.type === 'Polygon') {
      allPaths.push(...geoJsonToSvgPath(geom.coordinates, center, width, height, scale));
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        allPaths.push(...geoJsonToSvgPath([poly], center, width, height, scale));
      }
    }
  }
  
  console.log('SVG paths:', allPaths.length);
  
  // 生成 SVG
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${width}px;background:#f8f8f8;border-radius:12px;font-family:'PingFang SC','Microsoft YaHei',sans-serif">
  <defs>
    <linearGradient id="boundaryGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#E8F5E9" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#C8E6C9" stop-opacity="0.8"/>
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.08"/>
    </filter>
  </defs>

  <!-- 行政区轮廓 -->
  <g class="district-boundary" filter="url(#shadow)">
    ${allPaths.map(d => `<path d="${d}" fill="url(#boundaryGrad)" stroke="#4CAF50" stroke-width="1.5" stroke-linejoin="round"/>`).join('\n    ')}
  </g>

  <!-- 中心标记 -->
  <circle cx="${width/2}" cy="${height/2}" r="6" fill="#FF7826" stroke="#fff" stroke-width="2"/>
  <text x="${width/2}" y="${height/2 + 22}" text-anchor="middle" font-size="13" fill="#333" font-weight="bold">${name}</text>

  <!-- 数据来源 -->
  <text x="${width-10}" y="${height-8}" text-anchor="end" font-size="8" fill="#999">数据来源: 阿里云DataV</text>
</svg>`;

  fs.writeFileSync(outputFile, svg);
  console.log('SVG 已保存:', outputFile);
  
  return allPaths;
}

async function main() {
  // 巴马瑶族自治县：adcode 451227
  await generateBoundarySvg(
    '451227',
    '巴马瑶族自治县',
    { lat: 24.15, lng: 107.25 },
    'geographicSVG/巴马县边界.svg',
    0.008 // 缩放比例
  );
  
  // 防城港市：adcode 450600
  await generateBoundarySvg(
    '450600',
    '防城港市',
    { lat: 21.62, lng: 108.35 },
    'geographicSVG/防城港市边界.svg',
    0.015
  );
  
  console.log('\n完成！');
}

main().catch(console.error);