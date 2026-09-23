# Managed Builder query lifetime

Builder and sandbox-test runs keep one SDK async input stream open until pending task IDs have
received `task_notification` and the parent has emitted its following `result`. `task_started`
registers IDs in a Set, making duplicate starts/completions harmless. Do not close on a final
notification: the parent can still call tools, summarize, or start more work. A terminal error
result, cancellation or transport exit releases the input too. Existing SDK AbortController
shutdown remains responsible for stopping the subprocess; this change does not promise immediate
termination of every background child during the SDK's graceful-shutdown window.

Why: SDK 0.3.220 closes stdin on the first result when given a string prompt. A parent may return
while background agents still need PreToolUse/permission responses. Those callbacks then cannot
send their allow result, and CLI 2.1.220 can report that the user declined. Static permission
allow rules can hide this for some tools, so a successful tool in another run does not disprove it.

Generic (non-product) runs and the explicit context-compaction command retain their existing
single-turn behavior. Tool allow lists, sandbox restrictions, AskUserQuestion handling, session
identity, database schema and frontend protocol are unchanged.

## Validation (2026-09-23)

- Backend regression tests cover ordinary turns, multiple/nested/duplicate task events,
  failed/stopped tasks, terminal errors, cancellation, and transport failure.
- The actual adapter was transpiled and exercised with SDK 0.3.220 + native CLI 2.1.220 against a
  loopback model fixture. The parent replied before its background child; the child then needed
  Read approval, read a scratch marker, finished, and the parent summarized. Authorization and
  natural process exit succeeded without the fixture watchdog.
- The baseline string prompt reproduced the exact refusal text. The fixture explicitly asked
  for Read permission to exercise the control path deterministically; this does not assert that
  a merchant configured that ask rule.
- `session_state_changed: idle` is declared by the SDK but was not emitted in the tested CLI
  configuration. Do not use it as the only completion condition.
- No real model endpoint or merchant data was used by these fixtures. Production recovery of
  an already-running old sandbox remains a separate deployment/acceptance step.

Validation results: 70 backend tests passed (one existing skip), 128 frontend tests passed;
frontend/backend lint and typecheck, backend bundle and frontend production build passed.
Changed-file formatting passed. `make check` stops at the existing formatting violation in
`frontend/src/App.test.tsx`; that unrelated file was left unchanged, and the remaining checks
were run separately.
