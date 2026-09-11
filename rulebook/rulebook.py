#!/usr/bin/env python3
"""
Orchestrator Project Rulebook — SQLite database + query CLI.

Schema:
  meta(key, value)                                   -- rulebook version, tunable LOC thresholds
  project_types(key, name, loc_min, loc_max, strategy) -- the 7 project classifications
  guidelines(id, type_key, phase, step_no, priority, title, body, consequence)  -- phased runbooks
  mandates(id, type_key, kind, seq, directive, rationale, priority)             -- must / must_not

CLI:
  python3 rulebook.py init                      # create + seed the DB (idempotent)
  python3 rulebook.py types                     # list classifications + LOC bounds
  python3 rulebook.py classify <loc>            # classify by LOC → small/medium/big
  python3 rulebook.py playbook <type>           # ordered phase runbook for a type
  python3 rulebook.py rules <type>              # all guidelines incl. consequences
  python3 rulebook.py mandates <type> [must|must_not]  # non-negotiables for a type
  python3 rulebook.py check                     # integrity + coverage self-audit
"""
import argparse
import os
import sqlite3
import sys

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rulebook.db")
SCHEMA_VERSION = "1.0"

META = [
    ("schema_version", SCHEMA_VERSION),
    ("loc_small_max", "1000"),
    ("loc_medium_max", "20000"),
    ("source_of_truth", "User-defined: LOC-classified project handling + porting doctrine + vibe upgrade gate"),
]

# ---------------------------------------------------------------- project types
PROJECT_TYPES = [
    ("small", "Small Project", 0, 1000,
     "Single-lane, direct execution. Minimal ceremony, full verification. "
     "Handle in the orchestrator session or one specialist; never spawn the sub-orchestrator."),
    ("medium", "Medium Project", 1001, 20000,
     "Planned multi-lane work. Todo breakdown, parallel specialists where separable, "
     "sub-orchestrator only if it splits into clearly independent subsystems."),
    ("big", "Big Project", 20001, None,
     "Compartmentalize. Mandatory sub-orchestrator per separable subsystem, parallel background "
     "lanes, milestone review, independent final audit. Never run a big project in one session."),
    ("porting", "Porting (Cross-Language Migration)", None, None,
     "Hardest case: 1:1 translation at file/function/method/class/handler/variable level. "
     "Guaranteed-diverge risk. Special doctrine below — read phases + mandates before touching code."),
    ("new_ui", "New Software With UI", None, None,
     "Designer-owned surface. UI/UX direction set AND implemented by designer; orchestrator "
     "reviews copy after designer work without changing visual/interaction intent."),
    ("new_no_ui", "New Software Without UI", None, None,
     "Headless / backend / CLI / library. Contracts first, research-first versions, "
     "coder/fixer implementation, build + test verification."),
    ("upgrade_vibe", "Upgrade Existing Software (user's terms)", None, None,
     "User cannot fully detail requirements. Orchestrator must extract exact terms/wants, restate "
     "them, show a plan summary, and get approval BEFORE executing."),
]

# ---------------------------------------------------------------- guidelines
# phase order within a type defines the runbook sequence.
G = []  # (type_key, phase, step_no, priority, title, body, consequence)
def g(t, phase, no, pri, title, body, consequence):
    G.append((t, phase, no, pri, title, body, consequence))

# ---- small ----
g("small", "plan", 1, 5, "Restate the task",
  "Confirm the deliverable and acceptance bar in 1-2 sentences before doing anything. If the "
  "request is genuinely ambiguous, ask one targeted question. Do not silently pick an interpretation.",
  "Wrong or mismatched deliverable; rework.")
g("small", "plan", 2, 5, "Todo list",
  "Create a short todo list (3-6 items: plan → implement → audit → build/test). Keep exactly one "
  "in-progress item.",
  "Lost steps, missed verification.")
g("small", "implement", 3, 5, "Implement directly",
  "Stay in the orchestrator session or delegate to ONE specialist matching the lane. No "
  "sub-orchestrator, no parallel lanes — overhead exceeds value at this size.",
  "Token waste and coordination overhead.")
g("small", "verify", 4, 5, "Audit (requirement match + code consistency)",
  "Verify the result is exactly what was asked (nothing missing, nothing off-spec) AND that the "
  "code is internally coherent — features interlock, no mismatched interfaces.",
  "Delivering something that looks finished but does not fit together or fit the ask.")
g("small", "verify", 5, 5, "Build/test",
  "Run the build/test command the project specifies and fix errors until it passes. If the project "
  "has no test command, state the verification performed and its result explicitly.",
  "Unverified 'done' claim.")

# ---- medium ----
g("medium", "plan", 1, 5, "Todo breakdown",
  "Produce a systematic todo list covering the whole task: research → implement → audit → "
  "build/test. Identify which steps can proceed in parallel and which are dependency-ordered.",
  "Serialized work, missed dependencies.")
g("medium", "plan", 2, 4, "Research versions first",
  "For anything involving libraries/tools, research best stable versions (via researcher/librarian) "
  "before pinning. No pinning from memory.",
  "Outdated or broken dependency stack.")
g("medium", "implement", 3, 5, "Parallel specialists for separable zones",
  "Split by folder/subsystem scope and dispatch background specialists with non-overlapping write "
  "ownership. Reconcile results before integration. One orchestrator owns integration and conflict "
  "resolution.",
  "Write-lane conflicts, integration breakage.")
g("medium", "implement", 4, 3, "Sub-orchestrator only for true subsystems",
  "Use the sub-orchestrator only when the medium project decomposes into clearly independent "
  "sub-projects. Otherwise route lanes directly.",
  "Extra hop with no benefit.")
g("medium", "verify", 5, 5, "Audit + build/test",
  "Audit for requirement match and code consistency across the integrated whole, then build and "
  "test. Fix until green.",
  "Integrated result fails or diverges from the ask.")

# ---- big ----
g("big", "plan", 1, 5, "Compartmentalize first",
  "Map the project into separable subsystems (independent folders/services/features). Declare the "
  "compartmentalization plan and each subsystem's scope boundary in the todo list before any code.",
  "One giant session that loses coherence.")
g("big", "plan", 2, 5, "One sub-orchestrator per subsystem",
  "Delegate EACH subsystem to its own sub-orchestrator with a scoped brief: path ownership, "
  "objectives, quality bar, report format. Sub-orchestrators then delegate to specialists and run "
  "background lanes themselves.",
  "Orchestrator becomes the bottleneck; lanes serialize.")
g("big", "plan", 3, 4, "Research + architecture review",
  "Confirm best stable versions via researcher/librarian, and get an oracle architecture review "
  "for high-risk cross-subsystem decisions before implementation starts.",
  "Structural rework late in the project.")
g("big", "execute", 4, 5, "Parallel background lanes, non-overlapping paths",
  "Run subsystem sub-orchestrators in the background across disjoint paths. Continue only "
  "non-overlapping coordination work locally. Reconcile each lane's result when it completes.",
  "Write-lane conflicts and integration chaos.")
g("big", "execute", 5, 4, "Milestone review",
  "Review integration checkpoints between subsystems (interface contracts, shared types) as lanes "
  "land. Fix contract mismatches before the final build.",
  "Late integration failures across many lanes.")
g("big", "verify", 6, 5, "Independent final audit",
  "After reconciling all lanes, run an independent auditor pass (requirement match + code "
  "consistency + blocker detection). Then build and test the integrated whole.",
  "Big project marked done with hidden blockers.")

# ---- porting ----
g("porting", "pin", 1, 5, "Pin the source",
  "Record the EXACT source version: commit hash, release tag, or archive checksum of the software "
  "being ported. The port must reproduce this exact artifact — never 'a newer version' or 'what I "
  "remember'. Note the source language/runtime version and target language/runtime version.",
  "Porting the wrong revision; untraceable result.")
g("porting", "inventory", 2, 5, "Full artifact inventory",
  "Produce a file-by-file inventory FIRST: every source file with its role, and inside it every "
  "function, method, class, handler, and notable variable/constant. This inventory is the contract "
  "of what must survive the port. Include build/schema/config assets, not just code.",
  "Silent loss or invention of artifacts — the classic divergence.")
g("porting", "map", 3, 5, "Bidirectional artifact map",
  "Create an explicit map: source artifact → target artifact at file, class, function/method, "
  "handler, and variable level. Every source artifact must have a target counterpart; the map "
  "document (PORTING_MAP.md or in-repo markdown) is updated as translation proceeds. Nothing is "
  "translated without a map entry.",
  "Artifacts silently dropped, renamed, merged, or invented.")
g("porting", "translate", 4, 5, "Translate artifact-by-artifact, 1:1",
  "Port each artifact as an exact translation — same name, same signature, same behavior, same "
  "edge cases, same error strings. Do NOT improve, modernize, 'optimize', restructure, or merge "
  "while porting. Where the target language forbids an identifier, keep it recognizable and record "
  "the rename in the map.",
  "Behavioral drift: every 'improvement' changes the software the user relies on.")
g("porting", "translate", 5, 5, "Preserve observable behavior exactly",
  "Match: input/output semantics, return values, thrown errors and messages, exit codes, log "
  "lines, config keys, defaults, ordering, concurrency expectations, and public API shape. When in "
  "doubt, the SOURCE is the spec — re-read it before choosing.",
  "Silent behavior change = user-visible breakage.")
g("porting", "verify", 6, 5, "Parity verification, artifact attendance",
  "For each translated file, diff source vs port at artifact level: every function/method/class/"
  "handler/variable from the inventory exists in the port with equivalent behavior. Run the "
  "original test suite (ported 1:1) and compare outputs/errors/exit codes on the same inputs.",
  "A 'passing' port that is missing or altered behavior.")
g("porting", "verify", 7, 5, "No scope changes without approval",
  "If the target language truly cannot express something 1:1 (rare), do NOT improvise — flag the "
  "artifact, propose the minimal equivalent, and get user approval before substituting. Divergence "
  "must be explicit and approved, never silent.",
  "The port silently becomes 'something different'.")
g("porting", "report", 8, 4, "Port attestation report",
  "Report: source pinned revision; inventory counts (files/classes/functions/handlers/variables); "
  "map file location; any approved substitutions; verification run and results. State explicitly "
  "that behavior is preserved artifact-by-artifact.",
  "Unverifiable port with no audit trail.")

# ---- new_ui ----
g("new_ui", "plan", 1, 5, "Extract requirements + designer lane",
  "Clarify what the software must do, then hand the USER-FACING surface to the designer: layout, "
  "spacing, hierarchy, motion, responsiveness, component feel — designed AND implemented by "
  "designer. Never route UI polish to fixer or handle it in the orchestrator.",
  "Functional-but-ugly UI the user must live with.")
g("new_ui", "plan", 2, 4, "Research versions first",
  "Confirm best stable versions for the UI stack (framework, components, styling) via "
  "researcher/librarian before pinning.",
  "Outdated or mismatched UI stack.")
g("new_ui", "implement", 3, 5, "Designer implements; orchestrator owns copy",
  "Designer produces and implements the UI/UX. After designer output, the orchestrator reviews and "
  "improves user-facing copy to be grounded and normal — WITHOUT changing the designer's visual "
  "structure, spacing, or interaction intent.",
  "Designer's characteristically weak copy shipping, or orchestrator flattening the design.")
g("new_ui", "implement", 4, 4, "Backend/headless lanes in parallel",
  "Non-visual logic (services, data, state) may run in parallel headless lanes with non-overlapping "
  "scope, while designer owns the visual surface exclusively.",
  "Integration friction between visual and logic work.")
g("new_ui", "verify", 5, 5, "Audit + build/test + responsive check",
  "Audit requirement match + code consistency, build and test, and verify responsive behavior "
  "across target sizes (mobile-first on this device).",
  "Working code that breaks on real devices.")

# ---- new_no_ui ----
g("new_no_ui", "plan", 1, 5, "Contracts before code",
  "Define the external contract first: CLI commands and flags, REST/API endpoints and payloads, "
  "library public API, config/env schema — written down before implementation. Get user sign-off "
  "on the contract if it is user-facing.",
  "Building the wrong interface; rework.")
g("new_no_ui", "plan", 2, 4, "Research versions first",
  "Pick best stable versions (via researcher/librarian) for language runtime, libs, tooling. "
  "Pin deliberately, not from memory.",
  "Outdated or broken dependency stack.")
g("new_no_ui", "implement", 3, 5, "Implement via coder/fixer",
  "Headless implementation belongs to the coder/fixer lane with a bounded spec. Medium+ work may "
  "split into parallel non-overlapping zones.",
  "Slow, tangled implementation in the orchestrator.")
g("new_no_ui", "verify", 4, 5, "Build/test + edge cases",
  "Audit requirement match + consistency, build, and test happy path plus error/edge cases. "
  "Backend/CLI correctness must be evidenced, not asserted.",
  "Unverified claims on a headless product.")

# ---- upgrade_vibe ----
g("upgrade_vibe", "elicit", 1, 5, "Extract EXACT terms and wants",
  "The user cannot detail everything. Capture their literal words first — never paraphrase away "
  "specifics. Then translate their terms into concrete requirements in writing. Ask targeted "
  "questions to pin down: what changes, what must NOT change, priorities, and the acceptance bar.",
  "Upgrading a software the user did not describe — scope fiction.")
g("upgrade_vibe", "elicit", 2, 4, "Understand the existing software first",
  "Read the relevant existing code before proposing anything. Ground every proposed change in the "
  "current behavior; note what the user said vs what the code actually does.",
  "Proposals that ignore how the software actually works.")
g("upgrade_vibe", "plan", 3, 5, "Show a PLAN SUMMARY before executing",
  "Produce a concise plan summary: what will change, what will stay untouched, files/areas "
  "affected, approach, risks, and verification plan. Present it for approval BEFORE any code is "
  "written. Do not begin implementation until the user approves the plan.",
  "Executing on a guessed interpretation — the exact failure in vibe requests.")
g("upgrade_vibe", "execute", 4, 5, "Execute strictly what was approved",
  "Implement the approved plan only. Track scope: any user request that extends beyond the "
  "approved summary requires a re-shaped plan and re-approval.",
  "Scope creep disguised as following the vibe.")
g("upgrade_vibe", "verify", 5, 5, "Verify against approved plan + regressions",
  "Audit requirement match against the APPROVED summary (not against vibes), confirm untouched "
  "areas still behave, build/test.",
  "Approved change silently broken or regressed.")
g("upgrade_vibe", "report", 6, 4, "Report what changed vs the plan",
  "Report each approved change and its verification, plus anything you discovered that differed "
  "from the user's description worth confirming next.",
  "User cannot track what an upgrade actually did.")

# ---------------------------------------------------------------- mandates
# kind: "must" | "must_not"   seq: ordering within kind
M = []  # (type_key, kind, seq, priority, directive, rationale)
def m(t, kind, seq, pri, directive, rationale):
    M.append((t, kind, seq, pri, directive, rationale))

# ---- cross-cutting (ALL types) ----
g_all = [
    ("all", "must", 1, 5, "Check the current local time (Asia/Kolkata) before any download. "
     "12:00 AM–6:00 AM: free. 6:00 AM–11:59 PM: obtain explicit user consent before downloading "
     "anything, however small.", "Mobile data budget is limited and user-enforced."),
    ("all", "must", 2, 5, "Create a todo list covering the whole task before executing.",
     "Lost steps and skipped verification."),
    ("all", "must", 3, 5, "Pass the download rule and the plan→audit→build/test workflow down in "
     "every delegation prompt.", "Specialists violating data-consent or skipping verification."),
    ("all", "must_not", 1, 5, "Never claim completion without the required build/test evidence.",
     "Unverified 'done' is a lie to the user."),
    ("all", "must_not", 2, 5, "Never let a subagent touch files outside its assigned scope.",
     "Write-lane conflicts corrupt the tree."),
]
for row in g_all:
    M.append(row)

# ---- porting (the critical doctrine) ----
for seq, (dir_, rat) in enumerate([
    ("Must pin the exact source revision (commit/tag/checksum) and record source+target language "
     "versions before porting.", "Porting an unpinned source reproduces the wrong artifact."),
    ("Must produce a complete artifact inventory: every file, and inside it every function, method, "
     "class, handler, and variable/constant.", "Inventory is the survival contract of the port."),
    ("Must keep the bidirectional artifact map updated as translation proceeds; nothing is "
     "translated without a map entry.", "Artifacts get silently dropped, merged, or invented."),
    ("Must translate artifact-by-artifact as an exact 1:1 translation: name, signature, behavior, "
     "edge cases, error strings, exit codes, config, defaults, ordering.", "The port must BE the "
     "source, in another language."),
    ("Must treat the source as the spec — when in doubt, re-read the source code before choosing.",
     "Guessing changes behavior."),
    ("Must run parity verification: ported original tests, same inputs → same outputs/errors/exit "
     "codes, plus an artifact-attendance check of inventory vs port.", "A 'passing' port can still "
     "be missing behavior."),
    ("Must get explicit user approval for ANY substitution the target language forces.",
     "Silent divergence is the cardinal sin of porting."),
], start=1):
    m("porting", "must", seq, 5, dir_, rat)

for seq, (dir_, rat) in enumerate([
    ("Must NOT improve, modernize, optimize, restructure, or 'refactor while porting'.",
     "Every improvement changes the software the user relies on."),
    ("Must NOT rename artifacts for taste; keep names identical unless the target language "
     "forbids them, and record the rename.", "Renaming breaks callers and auditability."),
    ("Must NOT merge, split, or reorder functions/methods/handlers to 'clean up' the code.",
     "The port stops matching the source's structure."),
    ("Must NOT change user-visible strings, error messages, log lines, or API shape.",
     "User-visible behavior drift."),
    ("Must NOT drop 'ugly' or 'dead' code without proof and approval.", "Removing behavior the "
     "user depends on."),
    ("Must NOT silently interpret the source's intent differently in the port.",
     "Divergence — the exact failure the user warned about."),
], start=1):
    m("porting", "must_not", seq, 5, dir_, rat)

# ---- other types' mandates (concise set) ----
m("big", "must", 1, 5, "Must delegate each subsystem to its own sub-orchestrator with scoped "
  "ownership; the orchestrator never implements subsystem internals directly.",
  "Big projects collapse into one chaotic session.")
m("big", "must", 2, 4, "Must run an independent final audit after reconciling all lanes.",
  "Hidden blockers ship.")
m("medium", "must", 1, 5, "Must keep write ownership disjoint across parallel lanes.",
  "Lane conflicts break integration.")
m("upgrade_vibe", "must", 1, 5, "Must present a plan summary and obtain approval BEFORE writing "
  "code.", "Vibe requests cannot be executed on assumptions.")
m("upgrade_vibe", "must", 2, 5, "Must capture the user's literal terms first, then restate them as "
  "concrete requirements in writing.", "Paraphrasing loses the user's actual wants.")
m("upgrade_vibe", "must_not", 1, 5, "Must NOT begin implementation before plan approval.",
  "Guessing the meaning of a vague request.")
m("new_ui", "must", 1, 5, "Must hand all user-visible design and styling to the designer lane.",
  "Orchestrator-implemented UI looks thrown together.")
m("new_ui", "must", 2, 4, "Must review/improve copy after designer work without flattening the "
  "design.", "Designer copy is weak; orchestrator-owned copy edits keep design intent.")
m("new_ui", "must_not", 1, 4, "Must NOT 'simplify' or normalize the designer's layout, spacing, "
  "hierarchy, or motion afterwards.", "Design handoff discipline is final.")

# ---------------------------------------------------------------- db layer
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = connect()
    c = conn.cursor()
    c.executescript("""
    CREATE TABLE meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE project_types (
      key      TEXT PRIMARY KEY,
      name     TEXT NOT NULL,
      loc_min  INTEGER,
      loc_max  INTEGER,
      strategy TEXT NOT NULL
    );
    CREATE TABLE guidelines (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type_key   TEXT NOT NULL REFERENCES project_types(key),
      phase      TEXT NOT NULL,
      step_no    INTEGER NOT NULL,
      priority   INTEGER NOT NULL,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      consequence TEXT NOT NULL
    );
    CREATE TABLE mandates (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      type_key  TEXT NOT NULL,
      kind      TEXT NOT NULL CHECK (kind IN ('must','must_not')),
      seq       INTEGER NOT NULL,
      priority  INTEGER NOT NULL,
      directive TEXT NOT NULL,
      rationale TEXT NOT NULL
    );
    CREATE INDEX idx_guide_type ON guidelines(type_key, step_no);
    CREATE INDEX idx_mandate_type ON mandates(type_key, kind, seq);
    """)
    c.executemany("INSERT INTO meta(key,value) VALUES(?,?)", META)
    c.executemany("INSERT INTO project_types(key,name,loc_min,loc_max,strategy) "
                  "VALUES(:key,:name,:loc_min,:loc_max,:strategy)",
                  [{"key": k, "name": n, "loc_min": lo, "loc_max": hi, "strategy": s}
                   for (k, n, lo, hi, s) in PROJECT_TYPES])
    c.executemany("INSERT INTO guidelines(type_key,phase,step_no,priority,title,body,consequence) "
                  "VALUES(?,?,?,?,?,?,?)", G)
    c.executemany("INSERT INTO mandates(type_key,kind,seq,priority,directive,rationale) "
                  "VALUES(?,?,?,?,?,?)", M)
    conn.commit()
    conn.close()
    print(f"Rulebook initialized: {DB_PATH}")
    print(f"  types={len(PROJECT_TYPES)}  guidelines={len(G)}  mandates={len(M)}")

# ---------------------------------------------------------------- queries
def types():
    conn = connect()
    print(f"{'key':14} {'name':34} {'LOC range':18} strategy")
    print("-" * 120)
    for r in conn.execute("SELECT * FROM project_types ORDER BY "
                          "CASE key WHEN 'small' THEN 1 WHEN 'medium' THEN 2 WHEN 'big' THEN 3 "
                          "WHEN 'porting' THEN 4 WHEN 'new_ui' THEN 5 WHEN 'new_no_ui' THEN 6 "
                          "WHEN 'upgrade_vibe' THEN 7 ELSE 8 END"):
        lo = r["loc_min"] if r["loc_min"] is not None else "—"
        hi = r["loc_max"] if r["loc_max"] is not None else "∞"
        rng = f"[{lo}–{hi}]" if r["loc_min"] is not None or r["loc_max"] is not None else "any"
        print(f"{r['key']:14} {r['name']:34} {rng:18} {r['strategy'][:60]}")
    conn.close()

def summary():
    """List every rulebook with its tasks, grouped by phase."""
    conn = connect()
    order = ("small", "medium", "big", "porting", "new_ui", "new_no_ui", "upgrade_vibe")
    for key in order:
        t = conn.execute("SELECT * FROM project_types WHERE key=?", (key,)).fetchone()
        if not t:
            continue
        lo = t["loc_min"] if t["loc_min"] is not None else "—"
        hi = t["loc_max"] if t["loc_max"] is not None else "∞"
        rng = f"[{lo}–{hi}] LOC" if t["loc_min"] is not None or t["loc_max"] is not None else "any size"
        print(f"── {key}  ({t['name']})  {rng} ──")
        rows = conn.execute("SELECT phase, step_no, title FROM guidelines WHERE type_key=? "
                            "ORDER BY step_no", (key,)).fetchall()
        phase = None
        for r in rows:
            if r["phase"] != phase:
                phase = r["phase"]
                print(f"  {phase}:")
            print(f"    - {r['title']}")
        print()
    conn.close()

def classify(loc):
    conn = connect()
    small_max = int(conn.execute("SELECT value FROM meta WHERE key='loc_small_max'").fetchone()[0])
    medium_max = int(conn.execute("SELECT value FROM meta WHERE key='loc_medium_max'").fetchone()[0])
    conn.close()
    if loc <= small_max:
        key = "small"
    elif loc <= medium_max:
        key = "medium"
    else:
        key = "big"
    print(f"{loc} LOC → {key}")
    # print the runbook header for the classified type
    print()
    playbook(key)

def playbook(key):
    conn = connect()
    rows = conn.execute("SELECT phase, step_no, priority, title, body FROM guidelines "
                        "WHERE type_key=? ORDER BY step_no", (key,)).fetchall()
    conn.close()
    if not rows:
        print(f"no guidelines for '{key}'")
        return
    phase = None
    for r in rows:
        if r["phase"] != phase:
            phase = r["phase"]
            print(f"\n── {phase.upper()} ──")
        print(f"  [{r['step_no']}] (p{r['priority']}) {r['title']}")
        print(f"      {r['body']}")

def rules(key):
    conn = connect()
    rows = conn.execute("SELECT phase, step_no, priority, title, body, consequence FROM guidelines "
                        "WHERE type_key=? ORDER BY step_no", (key,)).fetchall()
    conn.close()
    if not rows:
        print(f"no guidelines for '{key}'")
        return
    phase = None
    for r in rows:
        if r["phase"] != phase:
            phase = r["phase"]
            print(f"\n── {phase.upper()} ──")
        print(f"[{r['step_no']}] {r['title']}  (priority {r['priority']})")
        print(f"    {r['body']}")
        print(f"    ⚠ if violated: {r['consequence']}")

def mandates(key, kind=None):
    conn = connect()
    q = ("SELECT kind, seq, priority, directive, rationale FROM mandates "
         "WHERE type_key IN (?, 'all')")
    args = [key]
    if kind:
        q += " AND kind=?"
        args.append(kind)
    q += " ORDER BY CASE kind WHEN 'must' THEN 0 ELSE 1 END, seq"
    rows = conn.execute(q, args).fetchall()
    conn.close()
    if not rows:
        print(f"no mandates for '{key}'")
        return
    for r in rows:
        tag = "MUST" if r["kind"] == "must" else "MUST_NOT"
        print(f"  [{tag}] {r['directive']}")
        print(f"      why: {r['rationale']}")

def check():
    conn = connect()
    c = conn.cursor()
    # foreign key integrity
    fk = c.execute("PRAGMA foreign_key_check").fetchall()
    # orphaned guidelines (type not in project_types)
    orphans = c.execute("SELECT COUNT(*) FROM guidelines g LEFT JOIN project_types t "
                        "ON g.type_key=t.key WHERE t.key IS NULL").fetchone()[0]
    # orphaned mandates: type_key must be a project type OR the cross-cutting 'all' bucket
    md_orphans = c.execute("SELECT COUNT(*) FROM mandates WHERE type_key NOT IN "
                           "(SELECT key FROM project_types) AND type_key != 'all'").fetchone()[0]
    counts = {r["key"]: 0 for r in c.execute("SELECT key FROM project_types")}
    rm = {r["key"]: 0 for r in c.execute("SELECT key FROM project_types")}
    for r in c.execute("SELECT type_key FROM guidelines"):
        counts[r["type_key"]] = counts.get(r["type_key"], 0) + 1
    for r in c.execute("SELECT type_key FROM mandates"):
        rm[r["type_key"]] = rm.get(r["type_key"], 0) + 1
    schema = c.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0]
    integrity = c.execute("PRAGMA integrity_check").fetchone()[0]
    print(f"integrity_check        : {integrity}")
    print(f"foreign_key_check      : {len(fk)} violations")
    print(f"guideline orphans      : {orphans}")
    print(f"mandate orphans        : {md_orphans}")
    print(f"schema_version        : {schema}")
    print()
    print("guidelines per type: ", dict(counts))
    print("mandates   per type: ", dict(rm))
    conn.close()
    ok = (integrity == "ok" and not fk and orphans == 0 and md_orphans == 0)
    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1

# ---------------------------------------------------------------- cli
def main():
    ap = argparse.ArgumentParser(description="Orchestrator project rulebook")
    ap.add_argument("cmd", choices=["init", "types", "summary", "classify", "playbook", "rules",
                                    "mandates", "check"])
    ap.add_argument("arg", nargs="?", help="type key or LOC count")
    ap.add_argument("--kind", choices=["must", "must_not"])
    args = ap.parse_args()

    if args.cmd == "init":
        init()
        return 0
    if args.cmd == "types":
        types(); return 0
    if args.cmd == "summary":
        summary(); return 0
    if args.cmd == "classify":
        if args.arg is None:
            print("usage: rulebook.py classify <loc>"); return 2
        try:
            loc = int(args.arg)
        except ValueError:
            print("LOC must be an integer"); return 2
        classify(loc); return 0
    if args.cmd in ("playbook", "rules", "mandates"):
        if args.arg is None:
            print(f"usage: rulebook.py {args.cmd} <type>"); return 2
        if args.cmd == "playbook": playbook(args.arg)
        elif args.cmd == "rules": rules(args.arg)
        else: mandates(args.arg, args.kind)
        return 0
    if args.cmd == "check":
        return check()
    return 0

if __name__ == "__main__":
    sys.exit(main())