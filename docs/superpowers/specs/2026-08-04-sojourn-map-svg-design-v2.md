# 旅居路线静态资源制作工坊（方案B增强版）设计文档 v2

> 日期：2026-08-04
> 状态：待审批
> 替代：v1 设计文档（仅SVG地图，不含数据采集流水线）

## 一、目标

在管理后台「地图工坊」中，一键调用腾讯地图 API + Tavily 搜索，为每条旅居线路生成**完整的静态路线资源包**（地图 SVG + 行程数据 + 景点描述/图片），嵌入 HTML 模板供主流程直接引用。天气和价格保持运行时动态获取。

## 二、静态 vs 动态边界

| 分类 | 内容 | 获取时机 | 预制作 |
|------|------|---------|--------|
| **静态** | 走线地图 SVG | 制作工坊一次性 | ✅ |
| **静态** | 行程安排（每日时间表） | 制作工坊一次性 | ✅ |
| **静态** | 景点描述+图片（Tavily） | 制作工坊一次性 | ✅ |
| **静态** | 标点坐标+走线折线（地图API） | 制作工坊一次性 | ✅ |
| **静态** | 亮点/适合人群/餐食住宿 | 制作工坊一次性 | ✅ |
| **动态** | 实时天气+预报 | 对话请求时 | ❌ 运行时 |
| **动态** | 价格/优惠 | 对话请求时 | ❌ 运行时 |
| **动态** | 可订状态 | 对话请求时 | ❌ 运行时 |

## 三、数据采集流水线

### 3.1 生成流程

```
管理后台「地图工坊」点击「一键生成」
  │
  ├── 1. 读取线路基础数据
  │     来源：data/fangchenggang-routes.json
  │     获取：product_id, product_name, waypoints, itinerary, highlights
  │
  ├── 2. 腾讯地图 POI 搜索（每个景点）
  │     调用：tencent-map-adapter.js searchNearby()
  │     获取：精确坐标、地址、电话
  │     用途：修正 waypoints 坐标 + 补充地址信息
  │
  ├── 3. 腾讯地图驾车路径规划（走线折线）
  │     调用：tencent-map-adapter.js routePlanning()
  │     获取：真实道路折线坐标序列 [{lat,lng},...]
  │     用途：生成 SVG 走线 + 保留原始折线供动态地图降级用
  │
  ├── 4. Tavily 搜索（每个景点）
  │     调用：tavily-nearby-adapter.js searchCategory('spot')
  │     获取：景点描述（≤160字）、图片（≤2张）、口碑标签
  │     清洗：乱码过滤、SEO聚合页过滤、繁体检测
  │     转换：→ 简体中文（见 3.2）
  │
  ├── 5. 组装静态资源包
  │     产出 3 个文件：
  │     ├── map.svg         ← 交互式矢量地图
  │     ├── route_data.json ← 完整行程数据
  │     └── index.json 更新 ← 索引
  │
  └── 6. 模板融合（运行时）
        map-kit.js 优先查找静态包 → 有则注入 SVG + 静态行程
        model-service.js 注入动态天气 + 价格
```

### 3.2 简繁转换（全局保证简体中文）

**现有问题**：Tavily 返回的内容可能含繁体中文（台湾/香港网站），当前仅检测繁体占比并丢弃，不转换。

**解决方案**：引入轻量级简繁转换（纯 JS 映射表，无外部依赖）：

```javascript
// src/core/utils/simplified-chinese.js
// 内嵌常用繁→简映射表（~2500字，覆盖99%旅居/景点文本）
const TRAD_TO_SIM = { '廣':'广', '東':'东', '區':'区', '觀':'观', ... };

export function toSimplified(text) {
  if (!text) return '';
  return text.replace(/[\u4e00-\u9fff]/g, (ch) => TRAD_TO_SIM[ch] || ch);
}
```

**应用点（全局）**：
1. Tavily 返回的 description / title → `toSimplified()` 后再注入
2. mapstudio 生成 route_data.json 时对所有文本字段统一转换
3. model-service.js fillRouteCard 对 spots/itinerary 文本做最终保险转换
4. SVG 标点名称/描述经过转换

### 3.3 资源包文件结构

```
data/sojourn-maps/
  ├── index.json                              ← 全局索引
  ├── fcg_route_001/
  │   ├── map_standard.svg                    ← 普通版地图
  │   ├── map_elder.svg                       ← 适老版地图
  │   └── route_data.json                     ← 行程数据（共用）
  ├── fcg_route_002/
  │   ├── map_standard.svg
  │   ├── map_elder.svg
  │   └── route_data.json
  └── ...
```

### 3.4 route_data.json 结构

```json
{
  "route_id": "fcg_route_001",
  "route_name": "京族滨海文化线",
  "version": "1.0",
  "generated_at": "2026-08-04T12:00:00Z",
  "data_sources": {
    "map": "tencent_map_poi",
    "spots": "tavily_search",
    "route": "tencent_driving"
  },
  "destination": "防城港",
  "days": 1,
  "summary": "非遗滨海康养主题...",
  "highlights": ["京族独弦琴非遗传承人现场教学", ...],
  "suitable_for": "60—75周岁无重大基础病活力长者",
  "waypoints": [
    {
      "id": "wp1",
      "name": "嘉路滨海旅居基地",
      "type": "base",
      "day": "Day1",
      "plan": "大本营出发",
      "lat": 21.5279,
      "lng": 108.1668,
      "address": "防城港市港口区",
      "tel": ""
    },
    {
      "id": "wp2",
      "name": "东兴京族三岛",
      "type": "spot",
      "day": "Day1",
      "plan": "京族非遗体验+独弦琴",
      "lat": 21.5083,
      "lng": 107.8833,
      "address": "东兴市江平镇",
      "tel": "",
      "spots": [
        {
          "name": "京族独弦琴",
          "desc": "独弦琴是京族特有的单弦弹拨乐器...",
          "images": ["https://..."]
        }
      ]
    }
  ],
  "polyline_path": [[108.1668,21.5279],[107.8833,21.5083],...],
  "itinerary": [
    { "time": "07:00-08:00", "content": "晨间康养：八段锦教学", "note": "..." }
  ],
  "tags": ["非遗文化","滨海康养","负氧离子"],
  "resources": { "非遗": ["京族独弦琴",...], "康养": [...] }
}
```

## 四、管理后台制作工坊 UI

### 4.1 页面布局

```
┌─────────────────────────────────────────────────────┐
│  地图工坊                                             │
├─────────────────────────────────────────────────────┤
│ [线路选择▼] [普通版|适老版] [一键生成] [保存] [预览]   │
├──────────────────────────┬──────────────────────────┤
│                          │  全局样式                  │
│   SVG 地图预览画布        │  背景色 / 走线色 / 粗细    │
│   (可点击标点编辑)        ├──────────────────────────┤
│                          │  选中标点                  │
│                          │  名称 / 描述 / 类型 / 坐标  │
│                          ├──────────────────────────┤
│                          │  数据源状态                │
│                          │  ✓ 地图POI (4/4坐标)       │
│                          │  ✓ Tavily (3/4景点)        │
│                          │  ✓ 路径规划 (12个折线点)    │
│                          │  ✓ 简体中文 (全部已转换)    │
├──────────────────────────┴──────────────────────────┤
│  已保存的地图资源包                                    │
│  [京族滨海文化线 standard 2026-08-04 查看 删除]        │
│  [京族滨海文化线 elder    2026-08-04 查看 删除]        │
└─────────────────────────────────────────────────────┘
```

### 4.2 「一键生成」按钮的后端流水线

点击后后端依次执行：

| 步骤 | 调用 | 超时 | 失败处理 |
|------|------|------|---------|
| 1. 加载线路基础数据 | fangchenggang-routes.json | - | 返回错误 |
| 2. 地图 POI 搜索（每个景点并发） | tencent-map-adapter searchNearby | 5s/个 | 用原始坐标 |
| 3. 驾车路径规划 | tencent-map-adapter routePlanning | 8s | 用直线连接 |
| 4. Tavily 景点搜索（并发） | tavily-nearby-adapter searchCategory | 5s/个 | 空描述 |
| 5. 简体中文转换 | toSimplified() 全量文本 | - | - |
| 6. 生成 SVG（两种版本） | mapstudio.js generateSvg() | - | - |
| 7. 组装 route_data.json | 合并所有数据 | - | - |

**进度反馈**：前端轮询或 SSE 接收每步状态（`map_poi:done`, `tavily:3/4`, `route:done`, `chinese:done`, `svg:done`）。

### 4.3 后端 API

```
POST /api/admin/mapstudio/pipeline
  请求体: { route_id, version }
  返回: { ok, svg, route_data, stats: {poi_count, tavily_count, polyline_points} }

POST /api/admin/mapstudio/save
  请求体: { route_id, version, svg, route_data }
  返回: { ok, files: [...] }

GET  /api/admin/mapstudio/list
  返回: { ok, packages: [{route_id, route_name, version, generated_at}] }

GET  /api/admin/mapstudio/package/:routeId
  返回: { ok, route_data, svg_standard, svg_elder }

DELETE /api/admin/mapstudio/package/:routeId
  返回: { ok }
```

## 五、模板融合（运行时）

### 5.1 map-kit.js 改造

```javascript
export function buildRouteMapData({ destination, waypoints, spots, routeId, version = 'standard' }) {
  // ★ 优先查找预制作资源包
  const pkg = findPrebuiltPackage(routeId);
  if (pkg) {
    return {
      ...pkg.routeData,           // 静态行程+景点+坐标
      map_mode: 'static_svg',
      static_svg: pkg.svg,         // 内联SVG
      static_svg_url: `/api/sojourn-map/${routeId}/map_${version}.svg`,
      // 以下字段仍提供给模板做动态降级
      map_key: getMapKey(),
      centerLat: ..., centerLng: ...,
      waypoints_json: JSON.stringify(pkg.routeData.waypoints),
      polyline_path_json: JSON.stringify(pkg.routeData.polyline_path),
    };
  }
  // 降级到现有 TMap 动态渲染
  return buildDynamicMapData(...);
}
```

### 5.2 model-service.js fillRouteCard 改造

```javascript
// 静态部分：map-kit 已注入（行程+地图+景点）
// 动态部分：运行时获取天气+价格
const routeMapData = buildRouteMapDataFromKit({
  destination, waypoints: jtdWaypoints,
  routeId: product?.product_id   // ← 新增
});

// 天气（动态，30分钟缓存）
const weather = await weatherService.getWeatherByCity(destination);

// 价格/可订（动态，实时）
const priceLabel = product?.price_label || '';
const bookingStatus = jtd.detail?.stock ?? null;

// 合并注入模板
data = {
  ...routeMapData,              // 静态行程+SVG地图+景点
  weather_json: JSON.stringify(weather),  // 动态天气
  price_label: priceLabel,      // 动态价格
  booking_status: bookingStatus,// 动态可订
};
```

## 六、简体中文全局保障

### 6.1 转换模块

新建 `src/core/utils/simplified-chinese.js`，内嵌繁→简映射表，导出 `toSimplified(text)` 函数。

### 6.2 注入点（5处全局保障）

| 注入点 | 文件 | 说明 |
|--------|------|------|
| Tavily 结果清洗 | `tavily-nearby-adapter.js` | normalizeTavilyResponse 中对 description/title 转换 |
| 景点增强 | `local-routes.js` / `jtd-service.js` | cleanSpotText 输出后转换 |
| 资源包生成 | `mapstudio.js` | route_data.json 所有文本字段转换 |
| SVG 生成 | `mapstudio.js` generateSvg | 标点名称/描述转换 |
| 模板注入保险 | `model-service.js` | fillRouteCard 对最终 spots/itinerary 转换 |

## 七、与现有代码的关系

| 现有文件 | 改动 |
|---------|------|
| `src/admin/mapstudio.js` | **重写**：增加数据采集流水线（POI+路径+Tavily+简繁） |
| `src/core/map/map-kit.js` | **修改**：findPrebuiltPackage 替代 findPrebuiltSvg |
| `src/core/model-service.js` | **修改**：传入 routeId，动态天气/价格分离 |
| `src/core/utils/simplified-chinese.js` | **新建**：繁→简映射+转换函数 |
| `src/services/nearby-resource/tavily-nearby-adapter.js` | **修改**：增加 toSimplified 调用 |
| `src/services/travel/local-routes.js` | **修改**：cleanSpotText 后增加 toSimplified |
| `src/public/admin/mapstudio.html` | **重写**：修复页面+增加数据源状态面板 |
| `src/public/admin/mapstudio.js` | **重写**：修复类型字段对齐+增加流水线进度 |
| `src/public/admin/mapstudio.css` | **微调**：增加状态面板样式 |
| `src/public/admin/admin.js` | **修改**：修复 renderMapStudio 静态文件加载 |
| `src/public/admin/index.html` | **修改**：版本号更新 |

## 八、兼容性

| 场景 | 行为 |
|------|------|
| 线路有静态资源包 | 模板内联SVG + 静态行程，天气/价格运行时注入 |
| 线路无静态资源包 | 降级到现有TMap动态渲染（完全兼容） |
| Tavily 失败 | 景点描述为空，不阻塞生成 |
| 地图POI失败 | 用原始坐标，不阻塞生成 |
| 路径规划失败 | 用直线连接，不阻塞生成 |
