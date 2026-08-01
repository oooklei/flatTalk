# nearby_resource 技能 Tavily+腾讯地图富化设计

> 日期：2026-07-31 | 状态：approved | 方案：B（独立富化服务层）

## 1. 目标

为 `nearby_resource` 技能增加 Tavily 网页搜索 + 腾讯地图实时 POI 能力，在不破坏现有静态数据流的前提下，分层补充缺失分类、富化 POI 描述/图片/评价。

## 2. 架构

```
chat-orchestrator (nearby_resource 分支)
  ├─ getJialuFacilities()           静态388条
  ├─ nearbyAugmentor.enrich()       ★ 新增富化层
  │    ├─ 覆盖率检测 → 腾讯地图补充低覆盖分类
  │    ├─ Tavily 批量富化 Top-N POI
  │    └─ 合并去重 + 标注 _source
  └─ business_data.jialu_facilities → model-service → 模板
```

## 3. 新增文件

| 文件 | 职责 |
|------|------|
| `services/nearby-resource/tavily-nearby-adapter.js` | Tavily API 适配器 |
| `services/nearby-resource/nearby-augmentor.js` | 富化编排器（覆盖率检测+调用+合并+缓存） |

## 4. 关键参数

- 覆盖率阈值：wellness<5 或某分类=0 → 触发腾讯地图补充
- Tavily 超时：3秒；腾讯地图超时：2秒
- 缓存 TTL：10分钟，key=`center.lng,center.lat,intent`
- Tavily 粒度：按分类查 Top-5
- 去重：name 相似度>0.8 + 坐标差<100m

## 5. POI 扩展字段

```json
{
  "_source": "local|tencent|tavily|merged",
  "enriched_description": "Tavily 提取的描述",
  "enriched_images": ["url1", "url2"],
  "enriched_rating_hint": "好评 / 口碑佳"
}
```

## 6. 模板增强

现有15个模板增加：
- POI 卡片底部显示描述（如有）
- 图片缩略图（如有，最多2张）
- 来源标签（本地库 / Tavily / 腾讯地图）
