# Examples 2.1

## Autonomous CMS Prompt

User:

```text
Follow CMS rules. Controller dispatches, Developer implements, QC verifies, and continue autonomously. Files inside this project may be changed; files outside it must not be changed or deleted.
```

Interpretation:

- use `autonomy_mode: Bounded`;
- map QC to Stage Reviewer;
- use `acceptance_mode: Layered`;
- resolve project root and deny outside writes;
- continue through authorized stages and repairs;
- stop Standard/Full at independent acceptance.

## Stage Failure

Focused API test fails. Developer records a failure signature, narrows it to one validation branch, repairs that branch, reruns focused and affected regression, then Stage Reviewer checks raw evidence. Keep the same Packet and Work Order.

## Full Suite Timeout

Shard for diagnosis and resource isolation. Do not call the gate passed. If sharded acceptance is desired, Controller/Owner must formally change the criterion and authority fingerprint.

## Contract Delivery

Types and schemas validate. Report `Contract Complete`, not "the product feature works". Runtime acceptance requires a separately classified runtime criterion and functional evidence.
