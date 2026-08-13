// 合并真实景点数据（图片+描述）到 route_data.json
// 数据源：geographicSVG/bama-spots-data.json（Tavily 已采集的真实图片+描述）
// 目标：data/sojourn-maps/bama_5d4n/route_data.json 的 waypoints 补充 spot_images + 丰富 spot_desc
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'd:/GuiCare/flatTalk';
const spotsData = JSON.parse(fs.readFileSync(path.join(ROOT, 'geographicSVG/bama-spots-data.json'), 'utf8'));
const routePath = path.join(ROOT, 'data/sojourn-maps/bama_5d4n/route_data.json');
const route = JSON.parse(fs.readFileSync(routePath, 'utf8'));

// 构建景点名 → {images, desc} 映射
const spotMap = {};
for (const s of spotsData.spots) {
  spotMap[s.name] = {
    spot_images: s.spot_images || [],
    spot_desc: s.spot_desc || '',
  };
}
console.log('spots-data 景点数:', Object.keys(spotMap).length);

// 端点（起点/终点）的康养特色描述
const endpointDescs = {
  '巴马县城': '巴马瑶族自治县县城，世界长寿之乡核心区。海拔600-800米，地磁强度适中，空气负氧离子高达2-7万个/cm³，盘阳河穿城而过，是康养旅居的集散中心。县城配套完善，有长寿博物馆、民族文化广场，可品鉴巴马火麻汤、苞谷粥等长寿饮食。',
  '返程': '结束愉快康养之旅，沿盘阳河畔返程。盘阳河是巴马母亲河，沿岸风光旖旎，负氧离子含量极高，被誉为"长寿走廊"。返程途中可最后感受巴马的山水意境与清新空气。',
};

// 合并到 waypoints
let mergedCount = 0;
let endpointCount = 0;
route.waypoints = route.waypoints.map((wp) => {
  const enriched = { ...wp };
  // 匹配 spots-data
  const spot = spotMap[wp.name];
  if (spot) {
    enriched.spot_images = spot.spot_images;
    // 用更丰富的描述替换简短手写描述
    if (spot.spot_desc && spot.spot_desc.length > (wp.spot_desc || '').length) {
      enriched.spot_desc = spot.spot_desc;
    }
    mergedCount++;
  }
  // 端点描述补充
  if (!enriched.spot_desc && endpointDescs[wp.name]) {
    enriched.spot_desc = endpointDescs[wp.name];
    enriched.spot_images = [];
    endpointCount++;
  } else if (endpointDescs[wp.name] && (wp.type === 'arrival' || wp.type === 'departure')) {
    // 端点也补充丰富描述
    if (!enriched.spot_desc || enriched.spot_desc.length < 50) {
      enriched.spot_desc = endpointDescs[wp.name];
      endpointCount++;
    }
  }
  return enriched;
});

// 更新 data_sources 标记
route.data_sources.spots = 'tavily_search_merged';
route.generated_at = new Date().toISOString();

// 写回
fs.writeFileSync(routePath, JSON.stringify(route, null, 2), 'utf8');

// 统计
const withImages = route.waypoints.filter((w) => w.spot_images && w.spot_images.length > 0).length;
const withDesc = route.waypoints.filter((w) => w.spot_desc && w.spot_desc.length > 20).length;
console.log(`合并完成: ${mergedCount} 个景点匹配 spots-data, ${endpointCount} 个端点补充描述`);
console.log(`含图片的 waypoints: ${withImages}/${route.waypoints.length}`);
console.log(`含描述(>20字)的 waypoints: ${withDesc}/${route.waypoints.length}`);
route.waypoints.forEach((w) => {
  console.log(`  ${w.type.padEnd(10)} ${w.name.padEnd(8)} img=${(w.spot_images||[]).length} desc=${(w.spot_desc||'').length}字`);
});
