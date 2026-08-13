# 桂颐智养 VI · 模板对标清单

对标文件：`ui/guiyang-vi-system.html`

## 标准色（不可偏离）

| 角色 | 色名 | Hex | 用途 |
|------|------|-----|------|
| 主色 60% | 温润暖橙 | `#E8843C` | C端/桂小养头栏、CTA、高亮 |
| 辅色 20% | 绣球霁蓝 | `#3A6B8C` | 政务端/桂颐、信息层 |
| 辅色 10% | 青竹浅绿 | `#6B9B7A` | 成功、健康正向 |
| 点缀 10% | 稻穗暖金 | `#D4A537` | 徽章、强调 |
| 纸感底 | 暖纸白 | `#FAF8F5` | 页面底，禁止冷灰 `#F5F7FA` |
| 墨色 | 深暖灰 | `#3D3A36` | 正文 |
| 次文字 | | `#8A8278` | 说明 |
| 描边 | | `#E4E0D8` | 卡片边 |

渐变：`#E8843C → #D06E2A`（暖橙）；`#3A6B8C → #1E4A66`（霁蓝）

## 硬性规则

1. **禁止白板纯文本**：任何答复/兜底/列表卡必须有品牌头栏 + 暖纸底 + 描边阴影，不得只有白底黑字。
2. **C端技能**（nearby / find_service / meal / health / travel / common）：主色暖橙。
3. **政务技能**（dispatch / service_quality_eval）：主色霁蓝，暖橙作点缀。
4. 共享令牌：
   - `src/skills/_shared/gy-vi-tokens.css`（总规范）
   - 各技能 `templates/html/_design_tokens.css`

## 本轮已对齐

- 全部技能 `_design_tokens.css` / `_card_components.css` / `_route_product.css` / `_base.css`
- common：`answer` / `fallback_error` / `policy_*`（去白板）
- nearby 地图卡头栏、分类色收敛到 VI 色族
- find_service / dispatch / SQE / meal / health / travel 硬编码色批量替换
- 脚本：`scripts/align-templates-to-vi.mjs`、`scripts/align-vi-pass2.mjs`

## 抽检建议

1. 打开 mobile，分别触发：通用答复、周边地图、找服务、膳食、健康报告、旅居路线、派单、质量评估。
2. 目视头栏应为暖橙（或政务霁蓝），页面底为暖纸色，无大面积冷白/冷灰裸文本。
3. 改色后请硬刷新；模板 CSS 经 `link` 内联，需重启 Node 生效。
