# AI膳食建议 数据库表结构

## gxy_meal_recommendation

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| uid | String | 是 | 本机种子记录唯一编号 |
| record_no | Integer | 是 | 模拟记录序号 |
| elder_id | String | 是 | 老人编号 |
| elder_name | String | 是 | 老人姓名 |
| terminal | Enum | 是 | C/G/B/Admin 端侧 |
| role | String | 是 | 登录角色 |
| community_name | String | 是 | 所属社区 |
| service_type | String | 是 | 业务类型 |
| status | String | 是 | 业务状态 |
| created_at | DateTime | 是 | 创建时间 |
| meal_plan_id | String | 是 | AI膳食建议业务字段 |
| chronic_tags | String | 是 | AI膳食建议业务字段 |
| nutrition_goal | String | 是 | AI膳食建议业务字段 |
| dish_set | String | 是 | AI膳食建议业务字段 |
| contraindication_hit | String | 是 | AI膳食建议业务字段 |
| order_status | String | 是 | AI膳食建议业务字段 |

初始化数据：`data_tables/gxy_meal_recommendation.seed.json`，当前生成 500 条模拟现实业务数据。
