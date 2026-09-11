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