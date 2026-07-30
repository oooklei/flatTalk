# 健康风险预警师 business knowledge

依据《方案设计》：从业务系统对接智能设备/云诊数据，再匹配预警规则，输出一般/关注/紧急。

## Core pages

- device_signal — 设备与云诊检测信号
- risk_rule_match — 健康风险规则匹配
- warning_level — 预警等级（一般/关注/紧急）
- call_handoff — 呼叫/转交
- remote_gap — 远程资源缺失（仅探测失败时使用）

## 资源探测

- 智能体已绑定的业务表 / 知识库视为已连接。
- 云诊365 需执行 `business_runtime.py yz365` 验证；成功才可宣称已连接。
- 用户发送「测试」时回报连接状态，禁止未探测就输出缺资源页。

## 数据对接

### 云诊365（已接入）

- 接口：`POST /stage-api/sd/yz365/checkDetail`
- 配置：`assets/config/yz365_api.json`
- 客户端：`scripts/backend/yz365_client.py`
- 运行时：`scripts/backend/business_runtime.py`（`page` / `yz365`）
- 映射：云诊 `riskLevel/riskName` → 方案预警等级（一般/关注/紧急）

### IoT（待对接）

- 血压、血糖、心率、睡眠、运动等智能设备指标
- 方案节点：7月15日前完成应用场景 IoT 与云诊数据接口

## 预警规则（方案）

1. 数据对接：获取智能设备/云诊检测数据  
2. 预警规则匹配：按预设规则确定一般 / 关注 / 紧急  
3. 结合健康档案、既往病史、用药记录、个体基线（远程表/知识库）
