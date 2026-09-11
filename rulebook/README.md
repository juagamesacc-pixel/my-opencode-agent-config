# Orchestrator Project Rulebook

SQLite database + query CLI that defines how the orchestrator handles every type of project.

## Location

- DB: `/root/.config/opencode/rulebook/rulebook.db`
- CLI: `/root/.config/opencode/rulebook/rulebook.py`
- Requires: `python3` (stdlib `sqlite3`, no downloads, no consent needed)

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
cd /root/.config/opencode/rulebook

python3 rulebook.py init                    # (re)build + seed DB (resets content)
python3 rulebook.py types                   # list types + LOC bounds
python3 rulebook.py summary                 # every rulebook with its tasks, by phase
python3 rulebook.py classify 5000           # LOC → type + prints that type's runbook
python3 rulebook.py playbook big            # ordered phases for a type
python3 rulebook.py rules medium            # runbook incl. violation consequences
python3 rulebook.py mandates porting        # must / must_not for a type (incl. cross-cutting)
python3 rulebook.py mandates porting --kind must_not
python3 rulebook.py check                   # integrity + coverage self-audit
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
  then re-run `python3 rulebook.py init && python3 rulebook.py check`.
- Thresholds live in `meta` (`loc_small_max`, `loc_medium_max`).