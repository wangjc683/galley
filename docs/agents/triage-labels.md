# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

Since issues are local markdown files, each label is written as a `Status:` value near the top of the issue file rather than applied through an issue-tracker UI.

| Canonical role    | String in our tracker | Meaning                                  |
| ----------------- | --------------------- | ---------------------------------------- |
| `needs-triage`    | `needs-triage`        | Maintainer needs to evaluate this issue  |
| `needs-info`      | `needs-info`          | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent`     | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human`     | Requires human implementation            |
| `wontfix`         | `wontfix`             | Will not be actioned                     |
| *(terminal)*      | `done`                | Shipped / resolved — see the disposal rule in [issue-tracker](./issue-tracker.md) |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.
