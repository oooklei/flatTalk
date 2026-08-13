# flatTalk 技能测试用例

## 1. 膳食规划 (meal_plan)

| 测试场景 | 简明输入文本 | 预期意图 |
|---------|------------|---------|
| 基础膳食建议 | 老人吃什么好 | meal_plan_advice |
| 早餐建议 | 推荐适合老人的早餐 | meal_plan_breakfast_advice |
| 午餐建议 | 老人午饭吃什么 | meal_plan_lunch_advice |
| 晚餐建议 | 晚饭适合老人吃什么 | meal_plan_dinner_advice |
| 一周计划 | 生成一周膳食计划 | meal_plan_weekly_plan |
| 慢病膳食 | 糖尿病老人怎么吃 | meal_plan_condition_advice |
| 追问：一周计划 | 请基于这份膳食建议生成一周三餐计划 | meal_plan_weekly_plan |
| 追问：慢病调整 | 请结合老人的慢病情况调整这份膳食建议 | meal_plan_adjust |
| 追问：软烂版 | 请把这份膳食建议调整为软烂易咀嚼版本 | meal_plan_adjust |
| 追问：采购清单 | 请整理这一周膳食计划的采购清单 | meal_plan_shopping |

## 2. 旅居路线规划 (travel_route)

| 测试场景 | 简明输入文本 | 预期意图 |
|---------|------------|---------|
| 基础旅居规划 | 帮我规划旅居路线 | travel_route_plan |
| 线路查询 | 防城港旅居养老线路介绍 | travel_route_query |
| 预订查询 | 巴马旅居路线可以预订吗 | travel_route_booking |
| 目的地对比 | 巴马和北海哪个更适合老人旅居 | travel_route_compare |
| 天气风险 | 北海旅居天气风险怎么样 | travel_route_weather_risk |
| 预算规划 | 防城港旅居多少钱 | travel_route_budget |
| 交通方案 | 去巴马怎么走 | travel_route_transport |
| 嘉路康养中心 | 嘉路康养中心旅居路线 | travel_route_plan |
| 追问：对比目的地 | 请对比巴马和北海哪个更适合老人旅居 | travel_route_compare |
| 追问：查可订状态 | 请检查这条旅居路线近期是否可预订 | travel_route_availability |
| 追问：调整预算 | 请按经济型预算重新规划这条旅居路线 | travel_route_budget |
| 追问：天气风险 | 请检查目的地的天气风险 | travel_route_weather |

## 3. 健康风险预警 (health_risk_warning)

| 测试场景 | 简明输入文本 | 预期意图 |
|---------|------------|---------|
| 基础风险评估 | 老人健康风险预警 | health_risk_warning.assess |
| 信号查看 | 查看设备健康信号明细 | health_risk_warning.signal_detail |
| 规则命中 | 展示触发预警的研判规则 | health_risk_warning.rule_detail |
| 人工复核 | 请求人工复核风险预警 | health_risk_warning.manual_review |
| 血压偏高 | 老人血压偏高预警评估 | health_risk_warning.assess |
| 追问：重新读取信号 | 请重新读取设备健康信号 | health_risk_refresh |
| 追问：查看规则命中 | 请展示触发预警的具体规则 | health_risk_rules |
| 追问：膳食调养 | 请提供针对当前健康风险的膳食调养建议 | health_risk_dietary |

## 4. 养老服务发现 (find_service)

| 测试场景 | 简明输入文本 | 预期意图 |
|---------|------------|---------|
| 基础服务发现 | 推荐养老服务 | find_service_discover |
| 找养老机构 | 有哪些养老机构可以入住 | find_service_org |
| 找护工上门 | 我想找护工上门护理 | find_service_worker |
| 预约服务 | 帮我预约上门护理服务 | find_service_order |
| 服务目录 | 养老服务有哪些分类 | find_service_catalog |
| 查看订单 | 查看我的服务订单 | find_service_order_view |
| 追问：找护工上门 | 我想找护工上门护理 | find_service_worker |
| 追问：看养老机构 | 有哪些养老机构可以入住 | find_service_org |
| 追问：直接预约 | 帮我预约上门护理服务 | find_service_order |

## 5. 派单与工单调度 (dispatch_manage)

| 测试场景 | 简明输入文本 | 预期意图 |
|---------|------------|---------|
| 查看派单列表 | 查看派单列表 | dispatch_list |
| 接单 | 接下第一条待接派的单子 | dispatch_accept |
| 拒单 | 拒绝这个派单 | dispatch_reject |
| 查看工单 | 查看对应的服务工单 | dispatch_work_order |
| 催进度 | 帮我催一下这条派单的进度 | dispatch_status |
| 处理详情 | 处理这条派单详情 | dispatch_detail |
| 追问：接第一条派单 | 接下第一条待接派的单子 | dispatch_accept |
| 追问：查看工单 | 查看对应的服务工单 | dispatch_work_order |
| 追问：催进度 | 帮我催一下这条派单的进度 | dispatch_status |

## 6. 政策咨询 (common.policy)

| 测试场景 | 简明输入文本 | 预期意图 |
|---------|------------|---------|
| 基础政策咨询 | 养老政策有哪些 | elder_policy_consult |
| 补贴查询 | 老人有什么补贴 | elder_policy_benefit |
| 申请流程 | 养老补贴怎么申请，去哪办 | elder_policy_apply |
| 办理材料 | 办理养老补贴需要什么材料 | elder_policy_apply |
| 政策详情 | 高龄津贴政策详细解读 | elder_policy_detail |
| 长护险 | 长期护理保险怎么申请 | elder_policy_apply |
| 助手功能 | 桂小养能做什么 | elder_assistant_usage |
| 追问：查询补贴条件 | 老人有什么补贴，申请条件是什么 | elder_policy_benefit |
| 追问：整理办理材料 | 办理养老补贴需要准备哪些材料 | elder_policy_apply |
| 追问：查询办理流程 | 养老补贴应该去哪里办理，流程是什么 | elder_policy_apply |

## 快速验证清单

以下为每个技能/场景的最小验证输入（每个取1条）：

| 技能 | 最简输入 |
|------|---------|
| meal_plan | 老人吃什么好 |
| travel_route | 帮我规划旅居路线 |
| health_risk_warning | 老人健康风险预警 |
| find_service | 推荐养老服务 |
| dispatch_manage | 查看派单列表 |
| common.policy | 养老政策有哪些 |
