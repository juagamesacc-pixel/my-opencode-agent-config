# note — shared agent memory (CLI + MCP server)

Zero-dependency bun-based note tool. Every agent (orchestrator, sub-orchestrator,
coder, fixer, designer, auditor, explorer, librarian, oracle, planner, researcher,
ui-designer) logs notable events — todos, questions, decisions, diversions,
status, risks, findings, final reports — into a shared SQLite store with
automatic per-(agent, session) table routing and globally unique note IDs
(`note {ID}` reads any note from anywhere).

## Quick start

```
note check                 # integrity self-test
note add todo "Build the login page" --agent coder --project MyApp
note add report "Done: ..." --agent coder --project MyApp
note list --agent coder --type report
note get <UUID>            # same as: note <UUID>
note mark <UUID> reported  # mark a report as relayed upward
note sessions              # active sessions + note counts
note new-session           # start a fresh session for your agent
```

Every note carries: `id` (UUID), `agent`, `session_id`, `project`,
`source_dir`, `source_file`, `created_at`, `note_type`, `note`, `status`.

## Note types (bounded enum)

| type       | use for                                                |
|------------|--------------------------------------------------------|
| todo       | every todo item / todo list you prepare                |
| question   | clarifying questions                                   |
| decision   | notable decisions + reasoning                          |
| diversion  | ANY deviation from plan/spec/rulebook/source (instant) |
| status     | progress checkpoints                                   |
| risk       | blockers, risks, concerns                              |
| finding    | audit / research / investigation results               |
| report     | final conclusion / employee report on task completion  |
| info       | anything else notable                                  |

Statuses: `open`, `reported`, `done`.

## Storage model (automatic, not AI-managed)

- One table per (agent, session): `n_<agent>_<session>`
  (sanitized identifiers) — `CREATE TABLE IF NOT EXISTS` per call, the
  server handles it; agents never manage tables themselves.
- `_sessions` tracks active sessions per agent (session id, created time).
- `_registry` maps every global UUID → its table, so `note {ID}` / `note_get`
  resolves any note regardless of which table it lives in.
- SQLite WAL mode; DB auto-created at
  `$HOME/.config/opencode/note/note.db` (devices may rebuild it freely;
  the runtime DB is gitignored).

Automatic routing: a note call with `session_id` pins that session; without
it, the server reuses the agent's most recent active session (creates a new
one only when the agent has none).

## MCP server mode

Run standalone (stdio JSON-RPC) with:

```
bun note.ts --mcp
```

Exposes 6 tools: `note`, `note_get`, `note_list`, `note_sessions`,
`note_new_session`, `note_mark`.

Registered in `opencode.jsonc` as a local MCP server (command:
`/root/.bun/bin/bun /root/.config/opencode/note/note.ts --mcp`) — loads at
opencode startup; a restart is required after config changes.

## Report relay protocol

1. On completion, an implementer saves its conclusion as `type=report` and
   reports the note **ID** upward (never pastes the whole report into chat).
2. A leaf agent under a @sub-orchestrator reports its conclusion note ID to
   the sub-orchestrator and asks it to relay; it never messages the main
   orchestrator directly.
3. The @sub-orchestrator reads it via `note {ID}` (note_get), marks it
   `reported` (note_mark), folds the essence into its own structured report,
   and relays the note ID upward.
4. The main orchestrator reads any relayed conclusion with `note {ID}`.

## Install

`install.sh note` installs `/usr/local/bin/note` (bun-first wrapper);
`install.sh full` installs note + rulebook + config.

## Usage rules

- Run queries with the `note` CLI from any shell; the wrapper prefers the
  absolute bun path because agent shells often lack `python3`.
- Pass `--agent <name>` / `--project <name>` / `--source <dir+file>` to keep
  notes attributable; flags are optional (defaults: current agent = hostname
  fallback, project = `unknown`).