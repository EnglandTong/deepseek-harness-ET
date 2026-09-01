# `@deepseek-ai/dsh-supervisor-project-state`

[English](README.md) | 中文

本包是 Personal Supervisor 的只读项目治理适配器。它大小写不敏感地定位根目录 `Docs`/`docs`，读取当前 Active Packet、Work Order 和有界的 `LOOP_RUNS.jsonl` 尾部，并返回带来源与 authority fingerprint 的精简项目状态。

读取有大小上限并限制在项目根目录内。缺失 Packet、重复权威文件、损坏 Loop 记录、缺失来源或 fingerprint 不一致都会作为冲突返回。`refresh()` 永不写入；后续组合包只有在状态通过冲突门禁后，才能加入显式授权的原子写入器。

`createSkillHandoff()` 只返回 `cms-project-governance` 或 `agent-loop-engineering` 的用途和按需加载提示。Skill 正文和隐藏推理不会复制进项目状态或总控提示词。

## 模型体验

### 项目状态摘要

#### 模型看到的内容

模型收到项目身份、Packet/Work Order 摘要、最近 Loop 增量、指纹和冲突状态，默认不会收到完整项目历史。

#### Token 影响

适配器返回有界的最近 Loop 尾部和短字段，提示词增长受 `recentLoopCount` 与 `maxFileBytes` 控制。

#### KV Cache 影响

选定权威文件和适配器选项不变时，精简字段顺序保持稳定。

## 已知限制与暂缓事项

- **没有持久写入器**——这里完成冲突安全读取；授权 bootstrap 写入属于后续组合层。
- **Markdown 解析范围刻意较窄**——只投影当前 frontmatter 与标题，任意旧文档正文仍交给治理审查作为证据。
- **不负责运行时验收**——执行报告与 Independent QA 仍是分离的权威决定。
