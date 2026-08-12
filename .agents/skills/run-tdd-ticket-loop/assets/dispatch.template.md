# <TICKET-ID> rework dispatch, round <N>

Candidate reviewed: <40-character Git SHA> Required next state: RED

Controller run ID: <TICKET-ID>/orchestrator/r0/<UUID> Implementer run ID:
<TICKET-ID>/implementer/r<N>/<UUID> Execution class:
<ordinary|protected-config-maintenance>

Before any production, configuration, template, or protocol edit, add every
regression dispatched below. Run them together against the unchanged input
candidate, then stop for the trusted controller to freeze one test/check-only
RED revision and the SHA-256 of every changed test/check file.

## Required changes

### <FINDING-ID>: <short title>

- Severity/lens: <P0-P3> / <lens>
- Location: <exact path plus line, symbol, route, query, or config key>
- Expected behavior: <accepted expected behavior>
- Observed behavior: <evidence-backed observed behavior>
- Reproduction: <command or deterministic source reproduction>
- Impact: <concrete user, security, reliability, or delivery impact>
- Affected criterion: <acceptance criterion ID>
- Contract reference: <repository-relative accepted contract and section>
- Required remediation: <observable correction>
- Verification: <regression test or deterministic check>
- Resolution status: open

## Constraints preserved

- RED changes contain only explicit test/check paths and ticket evidence.
- Round <N> starts from the prior round's exact candidate revision.
- <Accepted contract or boundary that must remain unchanged>
