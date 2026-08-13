# 旅居线路地图静态SVG方案（方案B改进版）设计文档

> 日期：2026-08-04
> 状态：待审批

## 一、目标

将旅居线路/基地的地图展示从**每次调用腾讯TMap JS API动态渲染**改为**预制作交互式SVG静态文件**，在管理后台提供自动化制作工坊，支持普通版和适老版双版本管理。

## 二、当前问题

| 问题 | 现状 |
|------|------|
| 加载慢 | 每次对话渲染需加载TMap SDK（800KB）+ 瓦片（120-240KB），耗时2.5-5s |
| API配额消耗 | 每次对话消耗腾讯地图配额 |
| 不稳定 | ~15-20%需要降级到自绘SVG |
| 移动端发烫 | WebGL持续渲染占50-80MB堆内存 |

## 三、架构设计

### 3.1 整体数据流

```
管理后台「地图SVG制作工坊」
  │
  ├── 1. 读取线路 waypoints（fangchenggang-routes.json 或实时拉取）
  ├── 2. 自动生成SVG初稿（Mercator投影 + 标点布局 + 连线 + 地理轮廓）
  ├── 3. 可视化编辑（拖拽/编辑标点/调整样式/切换版本）
  ├── 4. 保存 → 写入 /data/sojourn-maps/{route_id}_{version}.svg + .json
  │
  └── 模板渲染时
       ├── map-kit.js 优先查找预制作SVG → 有则内联到模板
       └── 无则降级到现有TMap API动态渲染（保持兼容）
```

### 3.2 文件存储结构

```
/data/sojourn-maps/
  ├── fcg_route_001_standard.svg      # 京族滨海文化线-普通版
  ├── fcg_route_001_standard.json     # 元数据（标点详情、版本信息）
  ├── fcg_route_001_elder.svg         # 京族滨海文化线-适老版
  ├── fcg_route_001_elder.json
  ├── fcg_route_002_standard.svg
  ├── fcg_route_002_standard.json
  ├── ...
  └── index.json                      # 所有SVG地图的索引清单
```

### 3.3 SVG文件结构规范

每个SVG文件是自包含的，内嵌所有标点数据和样式：

```xml
<svg viewBox="0 0 400 420" xmlns="http://www.w3.org/2000/svg"
     data-route-id="fcg_route_001" data-version="standard"
     data-center-lat="21.5279" data-center-lng="108.1668">

  <!-- 地理轮廓层（简化海岸线/省界，可选） -->
  <g class="geo-outline">
    <path d="M 80 50 Q 120 80 ..." fill="#E8F4F8" stroke="#B0D4E3" stroke-width="0.5"/>
  </g>

  <!-- 走线层（按day分段着色） -->
  <g class="route-paths">
    <path d="M 100 200 L 250 150 L 280 160 L 100 200"
          fill="none" stroke="#FF7826" stroke-width="3"
          stroke-dasharray="6 4" marker-end="url(#arrow)"/>
  </g>

  <!-- 标点层（每个标点一个 <g>，含交互元数据） -->
  <g class="markers">
    <!-- 基地（绿色） -->
    <g class="marker" data-type="base" data-day="Day1"
       data-name="嘉路滨海旅居基地" data-plan="大本营出发"
       data-lat="21.5279" data-lng="108.1668"
       transform="translate(100,200)">
      <circle r="14" fill="#2E7D32" stroke="#fff" stroke-width="2"/>
      <text text-anchor="middle" dy="5" fill="#fff" font-size="11" font-weight="bold">基</text>
      <text class="marker-label" y="28" text-anchor="middle" font-size="9" fill="#333">嘉路基地</text>
    </g>
    <!-- 景点（橙色） -->
    <g class="marker" data-type="spot" data-day="Day1"
       data-name="东兴京族三岛" data-plan="京族非遗体验+独弦琴"
       data-lat="21.5083" data-lng="107.8833"
       data-spot-desc="京族独弦琴非遗传承，哈节民俗展示"
       transform="translate(250,150)">
      <circle r="14" fill="#FF7826" stroke="#fff" stroke-width="2"/>
      <text text-anchor="middle" dy="5" fill="#fff" font-size="11" font-weight="bold">景</text>
      <text class="marker-label" y="28" text-anchor="middle" font-size="9" fill="#333">京族三岛</text>
    </g>
    <!-- ...更多标点 -->
  </g>

  <!-- 图例 -->
  <g class="legend" transform="translate(10, 380)">
    <circle cx="6" cy="6" r="5" fill="#2E7D32"/>
    <text x="16" y="9" font-size="9" fill="#666">基地</text>
    <circle cx="50" cy="6" r="5" fill="#FF7826"/>
    <text x="60" y="9" font-size="9" fill="#666">景点</text>
    <circle cx="94" cy="6" r="5" fill="#1976D2"/>
    <text x="104" y="9" font-size="9" fill="#666">康养</text>
    <circle cx="138" cy="6" r="5" fill="#D32F2F"/>
    <text x="148" y="9" font-size="9" fill="#666">返程</text>
  </g>

  <!-- SVG定义（箭头标记） -->
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5"
            markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#FF7826"/>
    </marker>
  </defs>
</svg>
```

### 3.4 元数据JSON结构

```json
{
  "route_id": "fcg_route_001",
  "route_name": "京族滨海文化线",
  "version": "standard",
  "created_at": "2026-08-04T12:00:00Z",
  "updated_at": "2026-08-04T12:30:00Z",
  "svg_file": "fcg_route_001_standard.svg",
  "view_box": { "width": 400, "height": 420 },
  "bounds": {
    "min_lat": 21.4950, "max_lat": 21.5279,
    "min_lng": 107.8700, "max_lng": 108.1668
  },
  "markers": [
    {
      "id": "m1",
      "type": "base",
      "name": "嘉路滨海旅居基地",
      "plan": "大本营出发",
      "lat": 21.5279, "lng": 108.1668,
      "svg_x": 100, "svg_y": 200,
      "spot_desc": ""
    },
    {
      "id": "m2",
      "type": "spot",
      "name": "东兴京族三岛",
      "plan": "京族非遗体验+独弦琴",
      "lat": 21.5083, "lng": 107.8833,
      "svg_x": 250, "svg_y": 150,
      "spot_desc": "京族独弦琴非遗传承，哈节民俗展示"
    }
  ],
  "style": {
    "bg_color": "#F8FAFB",
    "path_color": "#FF7826",
    "path_width": 3,
    "label_font_size": 9,
    "marker_radius": 14
  }
}
```

### 3.5 适老版与普通版的差异规范

| 属性 | 普通版(standard) | 适老版(elder) |
|------|-----------------|--------------|
| 标点半径 | 14px | 20px |
| 字体大小（标点内字） | 11px | 16px |
| 标签字体大小 | 9px | 13px |
| 走线粗细 | 3px | 5px |
| 颜色对比度 | 标准 | WCAG AAA（加粗描边） |
| 图例字体 | 9px | 13px |
| viewBox | 400×420 | 400×480（留更多空间给大字） |
| 标点数量上限 | 不限 | ≤6（避免视觉拥挤） |

## 四、管理后台制作工坊

### 4.1 新增导航项

在 admin 左侧导航栏新增「地图工坊」菜单项（data-mod="mapstudio"）。

### 4.2 后端API

```
GET  /api/admin/mapstudio/routes              → 获取可制作的线路列表
GET  /api/admin/mapstudio/data/:routeId       → 获取线路waypoints数据
POST /api/admin/mapstudio/generate             → 自动生成SVG初稿
     请求体: { route_id, version, options }
     返回: { svg, metadata }
POST /api/admin/mapstudio/save                 → 保存SVG+元数据
     请求体: { route_id, version, svg, metadata }
GET  /api/admin/mapstudio/list                 → 列出已保存的SVG地图
GET  /api/admin/mapstudio/file/:routeId/:version → 获取已保存的SVG内容
DELETE /api/admin/mapstudio/file/:routeId/:version → 删除某个版本
```

### 4.3 前端制作工坊交互流程

```
步骤1: 选择线路
  └── 下拉菜单显示5条防城港线路（从 fangchenggang-routes.json 加载）

步骤2: 选择版本
  └── 普通版 / 适老版 切换按钮

步骤3: 点击「自动生成」
  ├── 后端读取 waypoints → Mercator投影 → 计算SVG坐标
  ├── 自动布局标点（防重叠：最小间距40px）
  ├── 连线（按day分段着色 + 箭头）
  ├── 注入简化地理轮廓（从预制path库加载海岸线）
  └── 返回SVG初稿到前端编辑器

步骤4: 可视化编辑器（所见即所得）
  ├── SVG实时预览（左侧画布）
  ├── 右侧属性面板：
  │   ├── 全局样式（背景色/走线颜色/粗细/字体大小）
  │   ├── 选中标点编辑（名称/描述/类型/坐标微调）
  │   ├── 添加/删除标点
  │   └── 地理轮廓开关
  ├── 拖拽标点调整位置（鼠标拖动 → 更新 transform）
  └── 版本切换（普通版↔适老版，独立编辑独立保存）

步骤5: 预览
  └── 手机尺寸模拟（375×500 viewport预览）

步骤6: 保存
  ├── 写入 /data/sojourn-maps/{route_id}_{version}.svg
  ├── 写入 /data/sojourn-maps/{route_id}_{version}.json
  └── 更新 /data/sojourn-maps/index.json 索引
```

### 4.4 坐标投影算法

```javascript
// Mercator简化投影（低纬度地区线性近似足够）
function projectLatLng(lat, lng, bounds, viewBox) {
  const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * viewBox.width;
  // Y轴翻转（SVG坐标Y向下）
  const y = ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * viewBox.height;
  return { x: Math.round(x), y: Math.round(y) };
}

// 计算bounds（含padding）
function calcBounds(waypoints, paddingRatio = 0.1) {
  const lats = waypoints.map(w => w.lat);
  const lngs = waypoints.map(w => w.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const padLat = (maxLat - minLat) * paddingRatio;
  const padLng = (maxLng - minLng) * paddingRatio;
  return { minLat: minLat - padLat, maxLat: maxLat + padLat,
           minLng: minLng - padLng, maxLng: maxLng + padLng };
}
```

### 4.5 标点防重叠算法

```javascript
function resolveOverlaps(markers, minDist = 40) {
  for (let i = 0; i < markers.length; i++) {
    for (let j = i + 1; j < markers.length; j++) {
      const dx = markers[j].x - markers[i].x;
      const dy = markers[j].y - markers[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        const angle = Math.atan2(dy, dx);
        const push = (minDist - dist) / 2;
        markers[j].x += Math.cos(angle) * push;
        markers[j].y += Math.sin(angle) * push;
        markers[i].x -= Math.cos(angle) * push;
        markers[i].y -= Math.sin(angle) * push;
      }
    }
  }
  return markers;
}
```

## 五、模板改造

### 5.1 map-kit.js 改造

在 `buildRouteMapData()` 中增加预制作SVG查找逻辑：

```javascript
// 优先使用预制作SVG
const svgPath = path.join(process.cwd(), 'data', 'sojourn-maps',
  `${routeId}_${version || 'standard'}.svg`);
if (fs.existsSync(svgPath)) {
  return {
    ...baseFields,
    map_mode: 'static_svg',
    static_svg: fs.readFileSync(svgPath, 'utf-8'),  // 内联SVG字符串
    static_svg_url: `/api/sojourn-map/${routeId}/${version || 'standard'}.svg`
  };
}
// 降级到现有TMap动态渲染
return buildDynamicMapData(...);
```

### 5.2 sojourn_route.html 模板改造

新增 SVG 渲染分支（优先级最高）：

```javascript
// 第一档：预制作SVG（最快，0次API调用）
if (STATIC_SVG) {
  document.getElementById('mapCanvas').innerHTML = STATIC_SVG;
  bindSvgMarkerClicks();  // 绑定标点点击事件
  return;  // 不加载TMap SDK
}
// 第二档：TMap JS API（现有逻辑）
// 第三档：静态地图图片（现有逻辑）
// 第四档：自绘SVG（现有逻辑）
```

### 5.3 标点点击交互

```javascript
function bindSvgMarkerClicks() {
  document.querySelectorAll('.marker[data-name]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', function() {
      const name = this.dataset.name;
      const desc = this.dataset.spotDesc || '';
      const plan = this.dataset.plan || '';
      const day = this.dataset.day || '';
      // 弹出景点详情卡片（复用现有 InfoWindow 样式）
      showSpotDetail(name, desc, plan, day);
    });
  });
}
```

## 六、API 端点（对外提供SVG文件）

```
GET /api/sojourn-map/:routeId/:version.svg  → 返回SVG文件
GET /api/sojourn-map/:routeId/:version.json → 返回元数据
GET /api/sojourn-map/index.json             → 返回所有地图索引
```

## 七、兼容性策略

| 场景 | 行为 |
|------|------|
| 线路有预制作SVG | 模板内联SVG，不加载TMap |
| 线路无预制作SVG | 降级到现有TMap动态渲染（完全兼容） |
| SVG文件损坏 | 自动降级到TMap |
| 管理后台未制作 | 前端无感知，继续用动态地图 |

## 八、实施计划

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | 后端API路由 + SVG生成逻辑 | `src/admin/mapstudio.js` |
| 2 | 前端制作工坊UI | `src/public/admin/mapstudio.html` + `mapstudio.js` + `mapstudio.css` |
| 3 | 导航集成 | `src/public/admin/index.html` + `admin.js` |
| 4 | map-kit.js 预制作SVG查找 | `src/core/map/map-kit.js` |
| 5 | sojourn_route.html SVG分支 | `src/skills/travel_route/templates/html/sojourn_route.html` |
| 6 | 对外SVG API端点 | `src/app.js` |
| 7 | 初始数据：生成5条线路的SVG | 通过制作工坊生成 |
