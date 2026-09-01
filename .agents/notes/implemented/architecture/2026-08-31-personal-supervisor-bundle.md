# Agent Note: Optional Personal Supervisor bundle assembly

Status: implemented

[中文](2026-08-31-personal-supervisor-bundle.zh.md) | English

## Problem

The Supervisor runtime spans several independent capability packages, but users need one installable profile layer that composes them without silently granting production tools, provider credentials, or a new default Agent preset.

## Decision

`@deepseek-ai/dsh-personal-supervisor` is an optional native bundle whose `dsh.bundle.patch` (`cordis.patch.yml`) mounts only the controller service, singleton Session provider, explicit project registry, project host, executor bridge, bounded orchestrator, memory projection, interaction runtime, Host API projection, and browser client view. The package also ships a controller-only Agent preset (`preset/supervisor/agent.cordis.yml`) and a confirmation/read-only routing-policy example (`routing-policy.example.yml`) as inert assets. The patch does not mount shell, filesystem, deployment, web, credential, or external CLI provider rows, and it does not change `agent-presets` or the user's default model.

The bundle depends on the mounted runtime packages so the Loader's manifest resolver can find every bare plugin named by the patch. Routing-policy and project-state remain library consumers of the runtime packages; they are not fake Loader rows. The shipped preset is exposed as an application-configured trusted root because a bundle cannot infer the host application's shipped preset directory from a Cordis patch.

## Alternatives considered

- **Add Supervisor rows to `dsh-base`:** rejected because the controller is optional and would change every profile's lifecycle and resource ownership.
- **Mount external Codex/Claude provider bundles here:** rejected because provider installation, authentication, executable discovery, and permissions belong to their native bundles.
- **Override `agent-presets` from this bundle:** rejected because it could replace a user's default composition and a bundle cannot safely resolve the application's shipped preset root.
- **Treat the example policy as active user configuration:** rejected because installing a package must not write settings or select a user's model/provider.

## Consequences

Installing the bundle starts no model or CLI process and leaves the profile's default Agent preset unchanged; the bounded values the patch sets for candidate discovery, repair attempts, memory summaries, and notification wakeup are ordinary patch configuration a profile can replace. The controller preset contains no production tool and the example policy defaults to confirmation and read-only permission without credentials.

The controller preset stays an inert asset until the host application adds `preset/supervisor/` to its trusted shipped-preset root — a Cordis patch cannot infer that directory, so application path ownership stays explicit. The keyless snapshot example mounts the controller services directly and does not rely on preset discovery.

Provider availability is intentionally deferred to installed executor/provider bundles; the example policy uses placeholder identifiers and cannot dispatch until the owner configures real providers.

## Testing

`packages/bundle/personal-supervisor/tests/personal-supervisor.spec.ts` pins that the manifest declares a parseable `dsh.bundle.patch` entry list naming every mounted service, that no shell, filesystem, deployment, credential, or external CLI provider row or dependency is mounted, and that the shipped preset carries no production tool. The assembled wiring is exercised keylessly by `examples/headless-agent/tests/supervisor.snapshot.ts` over `examples/headless-agent/supervisor.cordis.snapshot.yml`.
