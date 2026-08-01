# 旅居养老知识库解析报告

**解析时间**: 2026-07-31  
**输出目录**: `D:\GuiCare\flatTalk\src\skills\travel_route\knowledge\`

## 已解析文件

### 1. 嘉路康养中心周边15公里配套表.json
- **源文件**: 嘉路康养中心周边15公里配套表.xlsx
- **数据量**: 389 条配套设施记录
- **字段**: poi_id, name, address, pname, cityname, adname, lng, lat, category, amap_type, typecode, biz_status, tel, open_time, service_tags, overall_rating, service_rating, environment_rating, facility_rating, hygiene_rating, comment_num, source, collected_at, 距离_公里
- **文件大小**: 230.85 KB

### 2. guangxi_institutions.json
- **源文件**: 2023-2025广西旅居养老机构入选汇总表.xlsx
- **工作表**:
  - **旅居基地**: 160 条旅居基地数据
  - **长寿之乡**: 40 条长寿之乡数据
- **文件大小**: 16.41 KB

### 3. fangchenggang_routes.json
- **源文件**: 防城港市AI养老试点5条旅居养老线路产品设计方案.docx
- **数据量**: 识别出 7 条路线段落
- **内容**: 
  - 方案核心说明
  - 大本营基础配套说明
  - 5条旅居养老线路详细产品设计（京族滨海文化线、银发爱情边境线、壮村民俗康养线、森林轻氧休闲线、芒街跨境体验线）
  - 定价规划
  - 六大标准化模块
  - 落地实施计划
- **文件大小**: 30.11 KB

### 4. ten_premium_routes.json
- **源文件**: "到广西过冬养老"十条精品路线发布.docx
- **内容**: 完整的十条精品路线信息（包含原始文档全文）
  - 山水画廊•温泉养生之旅
  - 原生之境•长寿探秘之旅
  - 暖冬逐浪•滨海度假之旅
  - 山水秘境•边关风情之旅
  - 田园森林•修心禅养之旅
  - 八桂民族•民族风情之旅
  - 生态民俗•瑶浴疗养之旅
  - 慢享时光•绿城颐养之旅
  - 不忘初心·红土风韵之旅
  - 五感沉浸•岭南文化之旅
- **文件大小**: 37.28 KB

### 5. longevity_hometowns.json
- **源文件**: (2024年12月39个)广西中国长寿之乡情况.docx
- **数据量**: 识别出 58 个地区信息
- **内容**: 
  - 广西39个中国长寿之乡完整列表
  - 4个长寿市（贺州、北海、防城港、玉林）
  - 按地级市分类的详细名单及认定年份
- **文件大小**: 6.32 KB

## 数据结构说明

所有 JSON 文件均包含以下标准字段：
- `title`: 数据标题
- `description`: 数据描述
- `extractedAt`: 解析时间（ISO 8601格式）

Excel 文件额外包含：
- `headers`: 列标题数组
- `data`: 数据记录数组（对象格式）

Word 文件额外包含：
- `rawContent`: 原始文本内容
- 结构化提取的特定字段（如 routes, hometowns 等）

## 使用建议

1. **配套设施数据** (jialu_facilities.json): 可用于地图标注、周边设施查询
2. **旅居机构数据** (guangxi_institutions.json): 可用于机构推荐、信息查询
3. **路线数据** (fangchenggang_routes.json, ten_premium_routes.json): 可用于路线规划、产品展示
4. **长寿之乡数据** (longevity_hometowns.json): 可用于长寿文化介绍、目的地推荐

## 后续优化建议

1. 十条精品路线的解析可进一步优化，提取更结构化的字段（如路线特色、途经县市、推荐景点等）
2. 长寿之乡数据可按文档格式重新解析，提取表格数据而非纯文本匹配
3. 可添加数据验证和清洗逻辑，确保数据质量
