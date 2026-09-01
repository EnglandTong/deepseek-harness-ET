# Agent Note: 确定性的 Personal Supervisor 路由策略

Status: implemented

[English](2026-08-31-supervisor-routing-policy.md) | 中文

## 问题

Supervisor 需要在不同模型和 CLI executor 之间选择，但不能嵌入凭证、静默改变策略，或把风险判断退化为关键词路由。Provider 可用性、项目范围、成本、时间和审批要求必须保持可审阅。

## 决策

`@deepseek-ai/dsh-supervisor-routing-policy` 是纯策略编译器和路由器。严格 YAML 校验生成带稳定 SHA-256 hash 的不可变策略。匹配使用显式筛选条件，并按确定性的具体度和 ID 排序。风险、权限、时段、预算、并发、白名单和 provider 可用性门禁只允许收紧自动派发。策略编辑先生成绑定 hash 的 diff，显式确认后才能替换。

路由请求只携带一个 `failed` 和一个 `reviewRequested` 字段供 reviewer 条件求值，且 fallback 路由引用必须存在且不能自引用。

## 包职责

- Schema parser：在持久化/配置边界拒绝未知字段和类似凭证的键。
- 策略编译器：固化安全默认值，并按规范化内容计算 hash。
- 路由 provider：返回公共 `RouteDecision`、派发控制和 reviewer 拓扑。
- 更新 store：提供预览/应用，并防止过期预览覆盖当前策略。

## 测试

`packages/supervisor/supervisor-routing-policy/tests/routing-policy.spec.ts` 覆盖相同内容重复编译下的稳定 hash 与冻结不可变性、带风险门禁和跨午夜时段的显式筛选条件、主 provider 不可用时的 fallback 选择、白名单/并发/deny/条件 reviewer 门禁、未知路由、预算耗尽和过期更新预览的确认要求，以及编译前对未知字段、类凭证字段和缺失或自引用 fallback 引用的拒绝。

## 考虑过的备选

- 硬编码关键词路由：无法表达 provider 能力、预算和可解释优先级，因此拒绝。
- 每次把 YAML 原样传给 executor：错误会在派发后才发现，且可能泄露凭证，因此拒绝。
- 没有排序依据的 first-match：文件重排会静默改变行为，因此拒绝；采用具体度后按稳定 ID 排序。
- 静默热替换：策略变化必须展示用户可见 diff 并确认，因此拒绝。

## 后果

- 相同输入和策略内容产生相同的路由顺序和 hash，重排文件无法静默改变行为。
- 包不登录、不购买额度、不写凭证；未匹配路由和不可用 provider 以需要确认的不可派发决定失败关闭，绝不猜测可用性。
- Provider 能力目录由填充路由请求的 executor 集成提供；目录缺失或不可用时按门禁处理，不能猜测可用性。
- 项目白名单按已登记的 ID/路径精确匹配；registry 规范化不在本包内发生。
