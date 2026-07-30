# 桂小养C端综合调度智能体 数据库表结构

## gxy_dispatch_session

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
| session_id | String | 是 | 桂小养C端综合调度智能体业务字段 |
| intent | String | 是 | 桂小养C端综合调度智能体业务字段 |
| skill_key | String | 是 | 桂小养C端综合调度智能体业务字段 |
| auth_level | String | 是 | 桂小养C端综合调度智能体业务字段 |
| dispatch_status | String | 是 | 桂小养C端综合调度智能体业务字段 |

初始化数据：`data_tables/gxy_dispatch_session.seed.json`，当前生成 500 条模拟现实业务数据。
