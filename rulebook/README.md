# Orchestrator Project Rulebook

SQLite database + query tooling that defines how the orchestrator handles every type of project.
Served to agents two ways: **native MCP tools** (preferred) and a **`rulebook` CLI** (fallback).

## Location

- DB: `/root/.config/opencode/rulebook/rulebook.db`
- MCP server + CLI: `/root/.config/opencode/rulebook/rulebook.ts` (bun, zero deps, `bun:sqlite`)
- Reference CLI (python3, offline): `/root/.config/opencode/rulebook/rulebook.py`
- **Runtime:** bun at `/root/.bun/bin/bun`. Python is NOT required — agent shells often lack
  `python3` on PATH, which is why the tool is bun-based and spawned via absolute path.

## MCP integration

Registered in `opencode.jsonc`:

```jsonc
"mcp": {
  "rulebook": {
    "type": "local",
    "command": ["/root/.bun/bin/bun", "/root/.config/opencode/rulebook/rulebook.ts", "--mcp"],
    "environment": {}
  }
}
```

Available tools (all agents with MCP access):

| Tool | Purpose |
|------|---------|
| `rulebook_summary` | every rulebook with its tasks, by phase |
| `rulebook_types` | the 7 classifications + LOC bounds |
| `rulebook_classify` | LOC → type (+ optional `nature` override: porting/new_ui/new_no_ui/upgrade_vibe) → runbook |
| `rulebook_playbook` | ordered phase runbook for a type |
| `rulebook_rules` | runbook incl. violation consequences |
| `rulebook_mandates` | must / must_not for a type (incl. cross-cutting) |
| `rulebook_check` | integrity + coverage self-audit |

## Project types

| key          | name                                  | LOC range      | Strategy |
|--------------|---------------------------------------|----------------|----------|
| `small`      | Small Project                         | 0–1000         | Single lane, direct execution, full verification |
| `medium`     | Medium Project                        | 1001–20000     | Planned multi-lane, parallel specialists, no sub-orchestrator unless true subsystems |
| `big`        | Big Project                           | 20001+         | Compartmentalize: sub-orchestrator per subsystem, background lanes, independent audit |
| `porting`    | Porting (Cross-Language Migration)    | any            | 1:1 translation at file/function/method/class/handler/variable level |
| `new_ui`     | New Software With UI                  | any            | Designer-owned surface; orchestrator reviews copy post-design |
| `new_no_ui`  | New Software Without UI               | any            | Contracts first; coder/fixer implementation; build+test evidence |
| `upgrade_vibe` | Upgrade Existing (user's terms)     | any            | Extract literal terms → plan summary → approval BEFORE code |

## Usage

```bash
# CLI (bun-first; works without python3 on PATH)
rulebook init                              # (re)build + seed DB (python3 CLI only, resets content)
rulebook types                             # list types + LOC bounds
rulebook summary                           # every rulebook with its tasks, by phase
rulebook classify 5000                     # LOC → type + prints that type's runbook
rulebook playbook big                      # ordered phases for a type
rulebook rules medium                      # runbook incl. violation consequences
rulebook mandates porting                  # must / must_not for a type (incl. cross-cutting)
rulebook mandates porting --kind must_not
rulebook check                             # integrity + coverage self-audit

# or directly:
/root/.bun/bin/bun /root/.config/opencode/rulebook/rulebook.ts <cmd>
```

## Orchestrator workflow

1. On any new project task, get the LOC estimate (source files only: `find` excluding build
   artifacts, `node_modules`, lockfiles, vendored/generated code).
2. `classify <loc>` → type. Override by nature: anything called "port"/"convert to X language"
   is `porting` regardless of LOC; "upgrade/fix my existing app" is `upgrade_vibe`; UI surface
   → `new_ui`.
3. Read `playbook <type>` and `mandates <type>` BEFORE delegating; pass the type doctrine down in
   each specialist brief.
4. Porting is the prime-risk type — its 8-phase runbook (pin → inventory → map → translate 1:1 →
   parity verify → report) and 13 mandates are the anti-diversion contract. Never start a port
   without running `playbook porting` + `mandates porting` first.

## Maintenance

- Edits to doctrine: edit data lists in `rulebook.py` (`PROJECT_TYPES`, `G()` calls, `M()` calls),
  then rebuild + verify: `python3 rulebook.py init && python3 rulebook.py check` (needs python3
  on that machine), or edit the DB directly with `bun:sqlite` / sqlite3.
- Thresholds live in `meta` (`loc_small_max`, `loc_medium_max`).