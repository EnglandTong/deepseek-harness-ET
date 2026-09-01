# Agent Note：只读项目治理状态适配器

Status: implemented

[English](2026-08-31-supervisor-project-state.md) | 中文

## 问题

Personal Supervisor 需要当前项目事实，但不能把每份项目文档或 Skill 正文复制到主对话。治理文件可能使用 `Docs` 或 `docs`，也可能不完整或互相矛盾。无法证明权威来源时，派发必须停止，不能根据过时文字猜测。

## 决定

`@deepseek-ai/dsh-supervisor-project-state` 是一个有界只读适配器。它定位根目录唯一的 `Docs`/`docs`，读取当前 Active Packet、Work Order 和有界的 Loop Runs 尾部，使用规范化相对路径与文件字节计算 authority fingerprint，并返回带显式冲突的精简摘要。`refresh()` 不执行任何写入；本接缝不提供原子写入器——需要写入的调用方单独持有它，且只能在冲突门禁通过之后。Skill handoff 只包含 Skill 名称、用途和按需加载提示。

## 测试

`packages/supervisor/supervisor-project-state/tests/project-state.spec.ts` 钉住以下行为：

- `Docs`/`docs` 查找大小写不敏感，拒绝重复目录，并拒绝指向工作区外的 symlink。
- Packet frontmatter 必须包含 `contract_version: "2.0"`、非空 `authority_fingerprint` 和至少一个 Authority Sources 条目。
- 权威来源支持反引号路径、Markdown link 和普通列表路径；缺失或越界来源产生冲突。
- Loop Runs 记录必须是包含治理必需字段的 JSON 对象；损坏或不完整记录标记为 corrupt，不能升级为证据。
- 指纹不一致、重复 Packet 或 Work Order、缺失来源返回零写入冲突结果。
- Skill handoff 不包含 Skill 正文、隐藏推理或完整项目历史。

## 考虑过的备选

- 将所有项目 Markdown 复制进总控提示词被否决，因为它把上下文增长当作存储机制，也隐藏了事实的权威文件。
- 用向量索引作为权威被否决，因为检索排序不能证明当前修订，也不能解决 Packet 冲突。
- 让适配器自动重写过期或缺失 Packet 被否决，因为这可能覆盖 Owner 决定，也违反冲突零写入。
- 在每份摘要中嵌入完整 `cms-project-governance` 和 `agent-loop-engineering` 指令被否决，因为它浪费 Token，并把项目状态绑定到 Skill 版本。

## 后果

- 治理事实保持有界且冲突显式：无法证明权威来源时派发停止，而不是根据过时文字猜测；治理消费者按需读取指定的权威文件。
- Markdown 投影范围刻意较窄，可能遗漏旧记录事实；零写入纪律意味着适配器永远不能自行修复过期或缺失的 Packet——任何写入器由获得授权的组合层持有，且只能在冲突门禁通过之后。Loop 摘要只是证据引用，永远不是验收决定。
