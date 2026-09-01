# `@deepseek-ai/dsh-supervisor-routing-policy`

[English](README.md) | 中文

`routing-policy` 包负责校验 Personal Supervisor 的 YAML 路由策略，并确定性地解析一个可解释的模型/执行器路由。它覆盖 executor/provider/model 选择、任务筛选条件、能力、成本和运行次数上限、并发、时段（包括跨午夜时段）、审批方式、权限上限、项目白名单、fallback 目标和 reviewer 流程。

凭证不属于此文件。未知字段和类似凭证的键会在策略编译前被拒绝。路由结果包含公共 `RouteDecision`，以及派发需要的控制信息（`dispatchable`、审批方式、权限上限、超时、review 流程和 fallback 证据）。

`RoutingPolicyStore.preview()` 生成稳定的路由差异和 hash。`apply()` 必须得到显式确认，并拒绝过期预览，因此对话不能静默改变活动策略。

## 最小 YAML

```yaml
version: 1
timezone: Asia/Shanghai
timeWindows:
  - { start: "09:00", end: "23:00" }
routes:
  - id: software-review
    domain: software
    taskType: review
    language: typescript
    capabilities: [read, test]
    executor: codex
    provider: openai
    model: coding-review
    costTier: medium
    approval: auto
    permissionCeiling: read
    timeoutMs: 120000
    projectAllowlist: [project-a]
    fallback:
      - { executor: claude-code, provider: anthropic, model: review, costTier: high }
    review:
      strategy: single
      condition: always
      reviewer: { executor: codex, provider: openai, model: second-pass, costTier: medium }
```

完整 YAML schema 由导出的 TypeScript 类型表达，并在加载时严格校验。

## 模型体验

### 路由策略

#### 模型看到的内容

模型可以看到候选路由、provider 可用性、策略版本/hash、审批门禁、成本等级和简洁原因，但看不到凭证或隐藏的 provider 状态。

#### Token 影响

路由器输出一个紧凑决策和路由级 diff，不读取项目对话历史，也不会在每次任务请求中嵌入完整 YAML。

#### KV Cache 影响

稳定的策略版本会让重复决策保持前缀稳定，直到显式确认的更新改变策略 hash。

## 已知限制与暂缓事项

- Provider 认证和模型可用性仍由所选 executor/provider bundle 负责。
- 策略评估在进程内进行；持久化的策略历史由 Supervisor 记忆层记录。
