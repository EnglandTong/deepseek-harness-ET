# Agent Loop Engineering 中文执行协议

版本：2.1.1

本 Skill 是已授权软件工作的执行层。只要仍能在范围内产生有效进展，默认继续推进。对于普通、可逆、项目目录内的技术选择，应遵循现有项目模式自主决定、诊断、修复和验证，不要求 Owner 逐轮监督。

使用用户的语言回复。持久状态必须事实化、精简，不保存隐藏推理。

## 语言与兼容

- 中文任务使用本文件，只加载 `{baseDir}/references/zh-CN/` 中当前需要的文件。
- 英文任务使用 `{baseDir}/SKILL.md` 和 `references/en/`。
- 两种语言的机器字段和枚举值保持英文。
- `contract_version` 继续使用 `"2.0"`，2.1 通过新增策略字段向后兼容。

## 入口与迁移

开始执行前必须明确：

- 用户可见的目标结果；
- 当前范围与 Non-Goals；
- 带交付类别的可观察验收标准；
- 允许修改和保护边界；
- 所需证据；
- 唯一下一步。

优先使用 `Docs/ACTIVE_PACKET.md`。旧项目没有 Packet 时，先调用 `cms-project-governance` 的 Legacy Bootstrap，或运行：

```text
node {baseDir}/scripts/bootstrap-active-packet.mjs --workspace <项目路径> --language zh-CN --json
```

Bootstrap 默认只读，只有显式增加 `--write` 才允许写入。目标、工单、判定或权限存在冲突时，设为 `Invalid State` 并停止，不得猜测。

旧项目规则见 `{baseDir}/references/zh-CN/migration.md`。

## 权限与目录边界

- Owner 决定目的、Non-Goals 和重大选择。
- Controller 决定规模、授权阶段、工单范围和对齐结论。
- Developer 负责实现与执行证据。
- Stage Reviewer 负责阶段检查和退回修复。
- Standard / Full 的最终验收由 Independent QA 决定。

用户在单 Agent 流程中所说的 `QC`，映射为 `Stage Reviewer`，不是独立终验。

必须解析项目根目录和所有候选写入路径的真实路径。设置 `write_scope: "."`、`outside_write_policy: Deny` 后，禁止通过普通路径、符号链接或 junction 在项目目录外新增、修改、移动或删除文件。

## 2.1 Packet 策略

新 Packet 使用：

```yaml
contract_version: "2.0"
autonomy_mode: "Bounded"
acceptance_mode: "Layered"
delivery_class: "Runtime"
context_profile: "Compact"
write_scope: "."
outside_write_policy: "Deny"
authority_fingerprint: "sha256:..."
agent_strategy: "Isolated"
max_parallel_agents: 3
context_return_policy: "SummaryAndEvidence"
shared_authority_mode: "FingerprintAndExcerpt"
single_writer: true
```

`delivery_class` 可为 `Runtime`、`Contract`、`Governance`、`Artifact`、`Mixed`。Contract 或 Governance 交付不得表述成运行功能已可用；Mixed 必须逐条标明验收项类别。

`Layered` 表示同一个执行 Agent 可以做阶段检查和返修，但新 Standard / Full 最终只能进入 `Ready for Independent Acceptance`。`Ready for Review` 只作为旧状态兼容输入。只有另一个 Agent、任务或人工评审者读取任务局部证据后，才能签署最终 QA。

完成和证据规则见 `{baseDir}/references/zh-CN/evidence-and-completion.md`。

## 有界自主循环

当 `autonomy_mode: Bounded` 时执行：

```text
Controller 阶段派发
  -> Developer 开发和聚焦验证
  -> Stage Reviewer 检查验收项、diff 和原始证据
  -> 通过：完成对齐并继续下一个已授权阶段
  -> 不通过：同一 Packet / Work Order 进入 Needs Fix
  -> Developer 返修和复验
  -> 终局阶段：Ready for Independent Acceptance
```

普通、可逆、符合项目惯例的实现选择不询问 Owner，采用保守默认并记录重要假设。只有涉及目标、Non-Goals、受保护架构或数据、生产行为、费用、凭证、破坏性影响或验收权限时才请求决定。

检查失败后：

1. 生成 failure signature；
2. 只读最相关的日志和源码；
3. 形成新的证据化假设；
4. 在范围内做有界修复；
5. 重跑聚焦检查和受影响回归；
6. 有真实进展就继续。

相同 failure signature 连续两次没有新证据、范围收窄、根因或通过行为时才停止。原样重复同一命令不算进展。

具体循环见 `{baseDir}/references/zh-CN/execution-loop.md`。

## 阶段与对齐

最多授权十个阶段：

| 规模 | 单阶段上限 | 总复核时域 |
| --- | ---: | ---: |
| Small | 30 分钟 | 5 小时 |
| Medium | 60 分钟 | 10 小时 |
| Large | 120 分钟 | 20 小时 |

阶段是结果检查点，不是文件。每个阶段做一次轻量目标链接检查；在阶段 3、6、10 以及以下情况立即做正式对齐：

- authority fingerprint 改变；
- 范围增长超过 20%；
- 自动检查全绿但核心用户流程失败；
- 无法用一句话说明当前工作与目标的关系；
- 出现受保护边界或新产品方向。

阶段 10 必须返回 `Ready for Independent Acceptance`、`Needs Fix`、`Blocked`、`Invalid State` 或拆分/重基线建议，禁止静默再开十阶段。

## 证据与验证成本

无证据不完成。Runtime 声明通常需要：

1. 自动验证；
2. 功能或用户流程验证；
3. 要求时的目标环境验证；
4. Standard / Full 最终独立证据。

验证顺序：

- 每轮先跑聚焦复现或测试；
- 集成点和修复后跑受影响回归；
- 终验、验收明确要求或重大风险触发时才跑全量回归；
- 没有新假设或改动时，不反复运行同一昂贵测试。

成功命令只记录命令、退出码、简短结果、时间和证据路径。失败命令保留有用尾部和原始日志路径，不把完整 stdout 复制进状态。

证据冲突时采用较弱结论。Build 和单元测试不能覆盖失败的真实用户流程。

## Compact 上下文

`context_profile: Compact` 默认只读取：

1. Active Packet；
2. 当前 Work Order 或唯一动作；
3. 受影响源码和测试；
4. 验证配置；
5. 最近三条 Loop。

authority fingerprint 未变化时，不重复读取 TARGET、ACCEPTANCE 或 Work Order。除非诊断明确冲突，不加载历史 Milestone、Handoff、QA 文件或完整日志。

按规模使用软上限：Small 6 个文件 / 30,000 字符，Medium 10 / 60,000，Large 16 / 100,000。只有明确证据需要时才能超过，并记录原因、先压缩再继续。这些限制用于控制上下文，不是完成证据。

安全与上下文详见 `{baseDir}/references/zh-CN/safety-and-context.md`。

## 隔离型委派

只有任务可分离且预计产生大量读取或工具输出时，才用子 Agent 隔离上下文。小型、高耦合工作留在主 Loop。每个 Worker 只接收有界任务包、不重叠写入范围、authority fingerprint、必要摘录和结构化回传契约；禁止发送完整父对话。

每个 Packet 只有一个协调写者，通常同时活跃的 Worker 不超过三个。优先隔离日志分析、大范围只读调查、嘈杂验证和独立 QA。并行 Developer 必须使用不重叠 Work Order，并有已授权集成阶段。

阅读 `{baseDir}/references/zh-CN/isolated-delegation.md`。只有当前 Host 需要时，才读取 `{baseDir}/references/zh-CN/host-cost-controls.md` 的会话、缓存、附件、压缩和回退适配。

## 状态写回

每轮结束：

1. 更新执行与阶段状态；
2. 只更新受影响验收项和精简证据链接；
3. 保留阻塞和重要假设；
4. 保持唯一下一步；
5. 向 `Docs/LOOP_RUNS.jsonl` 追加一个对象。

新记录使用 `record_version: "2.1"`，可包含 `role`、`progress_delta`、`stage_review`、`failure_signature`、`context_stats`。禁止在多个 Markdown 重复写同一状态；优先使用 Packet 和 Loop Log，不创建逐阶段 Dispatch、Handoff 或 QA 文件。

## 硬停止门禁

以下操作前必须停止：

- 密钥、凭证、账户登录或可复用 Session；
- 生产数据或未脱敏客户数据；
- 付费资源、公开或生产部署；
- 系统级安装、提权、驱动或主机安全设置；
- 破坏性 Git、迁移、覆盖、reset、force push 或不可逆删除；
- 受保护架构、数据边界、技术栈、目标或 Non-Goal 变更；
- 项目真实根目录外的任何写入；
- 权限不足或阶段、失败、上下文预算耗尽。

可以用分片诊断长时间或超时测试，但除非 Controller / Owner 正式修改验收门禁，分片不得替代原有全量门禁。

## 自动化与交接

外层 Runner 只能在单写者锁、每轮重新加载状态、预算受控的条件下重复执行；任何终局或无效状态必须停止。不得发明范围、自动回答 Owner 门禁、验收治理工作或隐藏失败。

Stage Reviewer 和 Independent QA 应收到验收项、diff、命令和原始证据，不应把 Developer 希望得到的结论当作证据。

详见 `{baseDir}/references/zh-CN/automation-and-handoff.md`。

## 校验

执行不修改项目的精简校验：

```text
node {baseDir}/scripts/validate-loop-state.mjs --workspace <项目路径> --summary --max-findings 20
```

需要机器输出时加 `--json`；只有审查旧日志迁移本身时才使用 `--strict-history`。校验通过只证明状态一致，不证明产品正确。

## 用户报告

只报告当前增量：

```text
执行状态：
阶段与角色：
目标链接：
进展增量：
自动验证：
功能验证：
阶段审查：
风险或阻塞：
下一步：
是否需要独立 QA：
```

没有当前验收权限时，不得声称最终 Accepted。
