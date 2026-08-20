# 示例 2.1

## 自主 CMS 提示词

```text
请按 CMS 规则推进。Controller 派工、Developer 开发、QC 验收并自主循环。项目目录内可修改，目录外严禁修改或删除。
```

解释：使用 `autonomy_mode: Bounded`；QC 映射 Stage Reviewer；使用 `acceptance_mode: Layered`；解析项目真实根目录并拒绝外部写入；自动经过已授权阶段和返修；Standard / Full 停在独立终验前。

## 阶段失败

聚焦 API 测试失败后，Developer 记录 failure signature，收窄到一个验证分支，修复并重跑聚焦及受影响回归，再由 Stage Reviewer 检查原始证据。保持同一 Packet 和 Work Order。

## 全量测试超时

可以分片诊断和隔离资源，但不能声明原门禁通过。如需把分片改为验收门禁，Controller / Owner 必须正式修改验收项和 fingerprint。

## Contract 交付

类型与 schema 校验通过，只能报告 `Contract Complete`，不能说产品功能可用。Runtime 验收需要独立分类的运行验收项和功能证据。
