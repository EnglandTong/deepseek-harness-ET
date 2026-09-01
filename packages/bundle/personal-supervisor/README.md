# `@deepseek-ai/dsh-personal-supervisor`

English | [中文](README.zh.md)

This optional bundle adds the Personal Supervisor controller layer over [`dsh-base`](../base/README.md). Its [`cordis.patch.yml`](cordis.patch.yml) mounts the singleton Supervisor service, durable controller Session, explicit project registry, project-bound host, executor bridge, bounded orchestrator, memory projection, and critical-notification/`@总控` command runtime. The bundle is a patch layer: a profile may replace a row or omit the bundle without changing the base profile.

The bundle does not mount shell, filesystem, deployment, web, credential, or external CLI provider rows. Installing it does not start a model or CLI process. Provider bundles remain independent and keep their own authentication and permission configuration. The project host admits one writer per registered project and the executor bridge receives only the permission granted by the routing policy.

## Preset and policy assets

[`preset/supervisor/agent.cordis.yml`](preset/supervisor/agent.cordis.yml) is a controller-only preset. It contributes a complete Supervisor persona and no production tool. An application that exposes shipped agent presets must add this directory to its trusted preset root; the bundle intentionally does not replace the profile's existing default preset.

[`routing-policy.example.yml`](routing-policy.example.yml) is a safe starting document. It uses confirmation and read-only permission, contains placeholder executor/provider identifiers, and contains no credentials or user-specific model choice. Copy it to a user-owned policy location and replace those identifiers only after the corresponding provider bundle is installed.

## Configuration

The patch sets bounded defaults for candidate discovery, repair attempts, memory summaries, and notification wakeup. These values are ordinary patch configuration and can be replaced by a profile or home patch. The bundle does not write a policy file or settings value and does not change `agent-presets` or the user's default model.

The routing-policy and project-state packages are libraries consumed by the orchestration and memory layers; they are not standalone Loader rows. Their current behavior is documented by [`supervisor-routing-policy`](../../supervisor/supervisor-routing-policy/README.md) and [`supervisor-project-state`](../../supervisor/supervisor-project-state/README.md).

## Model Experience

### Supervisor bundle

#### What the model sees

The shipped preset gives the controller a short, complete persona while keeping project execution behind the `supervisor` services. Runtime state is supplied by the memory and interaction layers as bounded summaries; raw child transcripts, hidden reasoning, and credentials do not become controller prompt content through this bundle.

#### Token effect

Bounded summaries avoid copying child transcripts into the controller context.

#### KV Cache effect

Stable preset text and policy versions keep the controller prefix predictable.

## Known Limitations and Deferred Work

- The bundle is process-local and requires the normal DeepSeek Harness persistence and settings rows supplied by the selected profile. It does not provide cross-device coordination, background work after application shutdown, automatic project enrollment, or an external provider login flow. Final acceptance remains an owner action after the independent QA gate.
