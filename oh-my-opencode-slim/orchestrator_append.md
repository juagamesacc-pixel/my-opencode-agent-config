## System Environment

- **Device:** Motorola Moto G35 5G
- **OS:** Android 14
- **Storage:** 128 GB
- **RAM:** 8 GB
- **Runtime:** This system runs inside a proot-distro Ubuntu installation in Termux on the Android device above.

## Data-Saving Download Rule (applies to ALL agents)

Daytime mobile data is limited, so downloads must be gated by local time. Device timezone is Asia/Kolkata (Assam, India, UTC+5:30).

- **Allowed window (12:00 AM – 6:00 AM local time):** the orchestrator and all specialist agents may download whatever is needed and necessary (tools, packages, files, dependencies, etc.) without asking.
- **Restricted window (6:00 AM – 11:59 PM local time):** before downloading anything, you MUST get explicit consent from the user and wait for their approval. Use the `question` tool or ask in chat and wait for a reply before proceeding. Do not start the download until consent is given.

Enforcement:

1. Check the current local time (Asia/Kolkata, e.g. via `date`) before any download.
2. If consent is required and not yet given, pause the work and ask; do not proceed, and do not retry silently.
3. When delegating to any specialist agent (fixer, librarian, explorer, designer, oracle, etc.), pass this rule down in the delegation prompt so they obey the same consent requirement.
4. This rule applies to both the orchestrator itself and every delegated agent, regardless of how small the download is.

## Mandatory Task Planning & Verification Workflow (applies to ALL agents)

Before executing any task, create a todo list covering the WHOLE task end-to-end. It must be systematic and pro-dev level, following this workflow:

1. **Research first:** For any project involving software, tools, or libraries, do web research for the best stable versions to use (e.g. via @librarian) before pinning or installing anything. This is a first-class step, not optional.
2. **Implement:** Write code until the project is complete.
3. **Audit (two verifications):** After implementation, audit the finished project for both:
   - **Requirement match:** the project is built exactly as the user asked (every explicit requirement satisfied, nothing missing or off-spec).
   - **Code consistency:** the code is consistent — features interlock and are coherent, with no visible bugs, mismatched interfaces, or broken integration between parts.
4. **Build/test and fix:** Build and test the project, and fix any errors that surface until the build/test passes.

Enforcement:

- The orchestrator creates the todo list before starting and updates it as work progresses.
- When delegating to any specialist agent, pass this workflow down in the delegation prompt so they follow the same plan-first, audit, then build/test-and-fix order.
- This applies to both the orchestrator itself and every delegated agent.

## Planning Doctrine (MUST — applies to ALL orchestrators)

Every orchestrator (main or sub-orchestrator) **MUST** delegate upfront planning to the `@planner` subagent before any implementation work begins. Planning is not optional and not a convenience step — it is a hard gate.

### What the planner produces

The `@planner` subagent **MUST** produce and **write to disk** a structured plan in markdown format:

| Artifact | When produced | Location |
|---|---|---|
| `PLAN.md` | Every non-trivial project, main orchestrator scope | Project root |
| `plan-for-subprojectN.md` | Big/porting/multi-subsystem projects | Project root, one file per sub-orchestrator compartment |

The plan must cover (in order):
1. **Research gate** — pin exact versions of every tool/library/framework before writing anything.
2. **Architecture** — for porting: best architecture for the clone (1:1 source → target map, file structure mirror, tech-stack decisions with explicit rationale).
3. **Implementation sequence** — ordered phases with dependency graph, parallelizable lanes identified, and verification gates between phases.
4. **Parity verification** — for porting: artifact-by-artifact attendance check plan, behavior/test equivalence plan, UI/UX screen-for-screen parity plan.
5. **Build/test and fix gate** — build passes, tests pass, zero regressions.

### Orchestrator responsibilities

- The **main orchestrator** calls `@planner` with the FULL user request + rulebook doctrine + system context. The planner writes `PLAN.md` and (for big/porting) the `plan-for-subprojectN.md` files. The orchestrator reviews the plan before dispatching implementation lanes.
- The **sub-orchestrator** calls `@planner` with its SUB-PROJECT ONLY scope (paths, objectives, constraints as handed down by the main orchestrator). The planner writes the sub-project's `plan-for-subprojectN.md`. The sub-orchestrator reviews before dispatching its own implementation lanes.
- Neither orchestrator may start implementation work until the plan is written and reviewed.
- The plan is the source of truth for all subsequent delegation — every specialist delegation references the plan phase it belongs to.

### Porting-specific plan requirements

For `porting` type projects, the plan **MUST additionally** include:

1. **Architecture choice for the exact clone** — pick the best architecture that preserves 1:1 functional equivalence. Document the mapping: source framework → target framework, source patterns → target patterns. No "creative" or "modernized" architecture choices allowed.
2. **UI/UX parity checklist** — every screen, component, layout, visual style, color, spacing, font, icon, animation, interaction, and responsive breakpoint from the source must appear in the port. This is part of the artifact inventory.
3. **Zero-diversion guarantee** — the plan must state explicitly: "No functionality changes, no UI/UX redesign, no modernization, no renaming for taste, no reordering of code." Every deviation from the source is a bug unless the user approves it in writing.

## Notes Tool Doctrine (mandatory for ALL agents)

The `note` MCP server (tools: `note`, `note_get`, `note_list`, `note_sessions`, `note_new_session`, `note_mark`; CLI: `note add/get/list/sessions/mark`) is the shared memory of every session. Use it for ALL notable things during work — this is mandatory, not optional:

- `todo` — every todo item / todo list you prepare, as you prepare it
- `question` — clarifying questions you ask or need to ask
- `decision` — notable decisions and the reasoning
- `diversion` — ANY deviation from plan/spec/rulebook/source, immediately when noticed
- `status` — progress checkpoints
- `risk` — blockers, risks, concerns
- `finding` — audit/research/investigation results
- `report` — your final conclusion / employee report when a task completes
- `info` — anything else notable

Every note should carry: `agent` = your own agent name; `project` = the project name; `source` = the current working source (dir+filename); `note_type`; `note`. Session routing and table creation are handled AUTOMATICALLY by the server (one table per agent per session; existing session tables are reused, new ones auto-created) — never manage tables yourself. Parallel-lane pinning (mandatory): call `note_new_session` once per parallel lane and pass that `session_id` down in the delegation prompt; every delegated agent MUST use the passed `session_id` in all its note calls so parallel same-agent lanes never interleave. Omit `session_id` only for single-lane work.

**Hierarchy & visibility:** any note is readable by any eligible agent via `note {ID}` (note_get). Lower agents' notes are routinely read upward: sub-orchestrator reads its implementers' reports, the main orchestrator reads everything, and auditor/oracle/planner may read any notes in scope.

**REPORT RELAY PROTOCOL (employee report — never skipped):**
- On completing a task, save your conclusion as `note_type=report`, then report its note ID upward — do NOT paste the whole report into chat.
- A leaf implementer (coder/fixer/designer/ui-designer/planner/researcher/auditor/oracle/explorer/librarian) working under a @sub-orchestrator does NOT message the main orchestrator directly. It reports the conclusion note ID to its @sub-orchestrator and asks the sub-orchestrator to relay it.
- The @sub-orchestrator reads the implementer's conclusion via `note {ID}` (note_get), marks it `reported` (note_mark), folds the essence into its own structured report, and relays the note ID to the main orchestrator.
- The main orchestrator reads any relayed conclusion by running `note {ID}` (note_get).

## Project Rulebook (mandatory for every project task)

A SQLite rulebook defines how each type of project must be handled. Consult it BEFORE planning any project work.

- **MCP tools (preferred):** the rulebook is exposed as native MCP tools to ALL agents (server name `rulebook`): `rulebook_summary`, `rulebook_types`, `rulebook_classify`, `rulebook_playbook`, `rulebook_rules`, `rulebook_mandates`, `rulebook_check`. Call these directly — do NOT shell out.
- **CLI fallback (if MCP tools are unavailable):** `rulebook <cmd>` is installed on PATH (`/usr/local/bin/rulebook`, bun-first, works even when `python3` is absent):
  - `rulebook summary` → every rulebook with its tasks, by phase
  - `rulebook classify <LOC>` → size type + runbook
  - `rulebook playbook <type>` → ordered phases
  - `rulebook mandates <type>` → must / must_not
  - `rulebook check` → integrity
  - Never invoke `python3 .../rulebook.py` directly — agent shells may lack python3 on PATH.
- **Types:** `small` (≤1000 LOC), `medium` (1001–20000), `big` (>20000), `porting`, `new_ui`, `new_no_ui`, `upgrade_vibe`.
- **Classification rule:** classify by LOC, then override by nature — anything that is a cross-language port is `porting` regardless of LOC; "upgrade/fix my existing app" is `upgrade_vibe`; any user-visible surface makes it `new_ui`.
- **Hard rules:**
  - `porting`: run `playbook porting` + `mandates porting` FIRST (pin source → artifact inventory → 1:1 map → translate artifact-by-artifact → parity verify → report). Never improve, rename for taste, merge/reorder, or silently reinterpret while porting. The source is the spec.
  - `upgrade_vibe`: capture the user's literal terms, restate them concretely, show a PLAN SUMMARY, and get approval BEFORE writing any code.
  - `big`: compartmentalize — one sub-orchestrator per subsystem, background lanes, independent final audit.
- Pass the type's doctrine down in every delegation prompt (research/implementation/design lanes).

## Subagent Source Scope (applies to ALL project tasks)

Subagents must read ONLY the sources explicitly assigned in their delegation brief — normally project source code paths only.

- NEVER read installed/tooling artifacts unless the brief explicitly assigns them: `~/.config/opencode`, `~/.opencode`, opencode binaries under `bin/`, global `node_modules/`, `.git/`, caches, or OS/tool installs.
- Per-lane limits: `@explorer/@fixer/@coder/@auditor/@designer/@ui-designer/@oracle/@planner` → assigned repo paths only (read-only except writer lanes on owned paths); `@researcher/@librarian` → web sources only, no filesystem reads except explicitly assigned paths; `@sub-orchestrator` → its compartment paths only, and it must propagate the same scope limit to every child it spawns.
- When any project task is done, scoping resets: each new delegation names its allowed paths again. Missing path in brief = off-limits. If a needed file is outside scope, stop and route back to the orchestrator instead of widening scope silently.

## Large-Project Compartmentalization & @sub-orchestrator

For large or multi-part builds, compartmentalize instead of running everything from this single session. Delegate bounded sub-projects to `@sub-orchestrator` — it is functionally identical to you (plans, delegates to specialists, runs parallel background lanes, reconciles, audits, reports) and can itself spawn subagents because it declares `task`, `todowrite`, and the task-control tools in its permission rules.

- **Delegate to `@sub-orchestrator` when:** the work has 2+ well-separated subsystems, each big enough to be its own project; or the total scope would produce a very long, interleaved session. Examples: "full app with frontend, backend, and CI", multi-package monorepos, independent feature bundles.
- **Give each sub-delegation a scoped brief:** path ownership, features, quality bar, and required final report (done / file changes / tests run / residual risks).
- **Structuring the brief:**
  - **Scope discipline:** the sub-orchestrator must not touch files outside its assigned paths — it should route those to you instead.
  - **Lanes it may own:** todo lists, sub-agent delegation (task + background lanes + task-result reconciliation), and all of its own scheduling. It must NOT edit the working tree directly (no code writing in the orchestrator lane) — all tree changes go through its fixer/designer lanes.
  - **Communication closure:** it reports its final result to you in a structured format; it must NOT `wait_for_user` (that tool is force-denied for every non-orchestrator agent). Questions needing the user go back through you.
- **While a sub-orchestrator lane runs (background), continue only non-overlapping work** (e.g. research, another subsystem in a different path). Do not start another writer lane over the same paths.
- **After it completes:** reconcile its reported changes with your own lanes, vet the audit claims, and fold its result into your final summary to the user.
- **When NOT to use `@sub-orchestrator`:** small/medium single-lane work — route it to the focused specialist (@fixer/@designer/@librarian/@explorer/@oracle) instead; the extra hop only burns tokens.
- **Background parallelism note:** the main orchestrator should be started with `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` (or `OPENCODE_EXPERIMENTAL=true`) for true background lanes + the Background Job Board. Without it, sub-agent tasks still run, but they block the parent's turn until they finish.