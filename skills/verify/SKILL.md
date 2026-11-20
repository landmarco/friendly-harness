---
name: verify
description: Prove a change works by running the real thing, not by trusting the diff. Boot the app, drive the route or flow, check the database state, then run the cheap checks. Use before calling any feature done, before submitting or committing work under time pressure, and whenever a change touches a running system (Flask API, SvelteKit page, migration). Built from the Claude Code team's verification practice - E2E beats unit, properties catch what cases miss, and the change never edits the check that judges it.
metadata:
  category: Workflow
  tags:
    - verification
    - e2e
    - testing
    - smoke-test
related_skills:
  - critic
  - agent-browser
  - project-tooling
---

# Verify

Verification means running the change, not reading it. The order below is
cheapest-usable first, but "does it run end to end" outranks "does the unit
test pass" - a green unit suite over a broken feature is the failure mode this
skill exists to prevent.

## The loop

1. **Boot it.** Start the app the way the README says. A server that will not
   start is the answer; stop and fix that.
2. **Drive the real flow.** Hit the actual endpoint or the actual page with a
   browser (`agent-browser`) - the user's path, not a mock's.
3. **Check the state it wrote.** Read the row, the file, or the response body.
   Assert on content, not just status code.
4. **Run the cheap checks.** Project test command, lint, build. Failures get
   fixed now, not noted.
5. **Say what you ran.** Report the commands and the observed output. "Tests
   pass" without evidence is not verification.

## Evidence, not intent

State the command, then the evidence:

```
$ curl -s localhost:5000/api/requests | jq '.[0].status'
"resolved"
$ agent-browser open localhost:5173/requests && agent-browser read
# Requests (3)
```

## Three test types worth the time

- **E2E** - real flow, hard to fool. One walk through the happy path plus the
  edge case that matters beats twenty unit tests.
- **Property** - invariants the code cannot be allowed to break. Python:
  `hypothesis`. Round-trip, invariant, idempotency, equivalence.
- **Differential** - old system is the oracle. Only when behaviour must not
  change (migration, rewrite).

## Rules

- **The change never edits what judges it.** Write or record the failing check
  before the fix. If a test only passes after loosening a mock, the mock is
  the suspect.
- **Three rounds, then a human.** If a check fails three times, stop and report
  instead of thrashing.
- **Never skip, sleep, or retry a flaky test to green.** Find the cause or
  delete the test and say why.
- **Flaky is worse than absent.** Slow or flaky checks train re-runs instead of
  fixes.
- One failing cheap check is a reason to stop, not to proceed and note it.

## Stack notes

Flask + SQLAlchemy + Alembic + SQLite, SvelteKit + Tailwind:

```bash
.venv/bin/python -m flask --app app run --port 5000 &   # or the project's run script
.venv/bin/python -m pytest -q                            # unit + property
.venv/bin/alembic upgrade head && sqlite3 app.db ".tables"   # migration applied
npm run test -- --run                                    # vitest, one shot
npm run build                                            # SvelteKit compiles
```

`bin/stack-check --warm` in the harness verifies the toolchain and pre-caches
the packages before a timed session.

## Related

- `critic` - the cheap-checks-first habit this operationalizes.
- `agent-browser` - hands and eyes on a running web app.
- `project-tooling` - the project's own scripts come before invented commands.
