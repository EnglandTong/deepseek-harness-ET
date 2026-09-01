# @deepseek-ai/dsh-client-ui-supervisor

English | [中文](README.zh.md)

The Personal Supervisor browser plugin provides the single user-facing dashboard for registered projects, task status, critical notifications, Host-approved task actions, and read-only child-session references.

The package contributes one `sidebar.footer.action` entry. Opening it reads the Host-backed `ctx.supervisor` projection and renders project and task cards. Approve, reject, rework, pause, and continue controls send compare-and-set actions with the displayed task revision; a stale revision is reported by the runtime and does not overwrite the card.

Child execution sessions are references only. The dashboard does not mount a composer, grant tools, or infer task state from a transcript. Host/API availability is required; an unavailable optional Supervisor bundle is shown as an error rather than replaced with fabricated data.

The node half is intentionally inert. Install the package in the browser profile after the Personal Supervisor Host and client runtime capabilities. The package does not change the existing conversation root or the child-session transport.

The `./invariant` companion reserves package ownership without creating a second client-side state authority.

## Model Experience

### Supervisor dashboard

#### What the model sees

The dashboard is a client projection and does not add model prompt content. It presents `supervisor_status` data and owner actions through the Host API.

#### Token effect

None. Dashboard refreshes use bounded snapshots rather than child transcripts.

#### KV Cache effect

None. UI state does not rewrite prompt prefixes.

## Known Limitations and Deferred Work

- The dashboard requires the optional Supervisor Host/API rows and reports their unavailability instead of fabricating state.
- Child sessions remain read-only references; transcript editing and direct child input are intentionally not exposed.
