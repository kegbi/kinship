# PILOT-001 RED retry, round 1

The first fresh implementer attempt was interrupted after it read the packet but
before it changed a file or ran the RED command. The orchestrator verified the
worktree remained clean. This is neither RED evidence nor an implementation
finding.

Start again from dispatch/round-01.md in a fresh context. Add one focused test
file first; it is sufficient for the valid bundle assertion to fail with the
existing not_implemented diagnostic. Record that run and stop. After the RED
revision is frozen, make the smallest GREEN change for that assertion, then add
each remaining behavior in its own RED/GREEN cycle before REFACTOR.
