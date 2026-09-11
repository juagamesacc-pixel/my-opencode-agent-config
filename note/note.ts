#!/usr/bin/env bun
/**
 * Project Notes — bun-based CLI + MCP server (zero deps).
 *
 * Every agent (orchestrator, sub-orchestrator, coder, fixer, auditor, ...)
 * records notable events: todos, decisions, diversion notes, clarifying
 * questions, status updates, risks, reports, findings.
 *
 * Storage model:
 *   - One table per (agent, session): n_<agent>_<session> — auto-created and
 *     auto-reused by the server ("if the session table exists, refer to it;
 *     otherwise create"). The AI agent never decides table management.
 *   - _sessions: tracks each agent's CURRENT active session so calls without
 *     an explicit session_id automatically route to that agent's open session.
 *   - _registry: global id -> (agent, session, table) index so `note {ID}`
 *     (note_get) resolves any note from any table by its id.
 *
 * CLI:
 *   bun note.ts add <type> "<note>" [--agent a] [--session s] [--project p] [--source dir/file] [--status open]
 *   bun note.ts get <id>
 *   bun note.ts list [--agent a] [--session s] [--project p] [--type t] [--status st]
 *   bun note.ts sessions [--agent a]
 *   bun note.ts new-session <agent>
 *   bun note.ts mark <id> <open|reported|done>
 *   bun note.ts check
 *
 * MCP server (stdio, JSON-RPC 2.0, newline-delimited):
 *   bun note.ts --mcp
 */
import { Database } from "bun:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dir, "note.db");
const SERVER_NAME = "note";
const VERSION = "1.0";

export const NOTE_TYPES = [
  "todo",       // planned work item / todo prepared
  "question",   // clarifying question asked or needed
  "decision",   // decision made (architecture, approach, choice)
  "diversion",  // ANY deviation from plan/spec/source — log immediately
  "report",     // task completion / conclusion / employee report
  "status",     // progress update
  "risk",       // blocker, risk, concern
  "finding",    // audit/research/investigation result
  "info",       // anything else notable
] as const;

export const NOTE_STATUSES = ["open", "reported", "done"] as const;

// ---------------------------------------------------------------- db helpers
function db(): Database {
  const d = new Database(DB_PATH);
  d.run("PRAGMA journal_mode=WAL");
  d.run("PRAGMA busy_timeout=3000");
  d.run(`CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  d.run(`CREATE TABLE IF NOT EXISTS _sessions (
    agent      TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    opened_at  TEXT NOT NULL)`);
  d.run(`CREATE TABLE IF NOT EXISTS _registry (
    id            TEXT PRIMARY KEY,
    agent         TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    tbl           TEXT NOT NULL,
    project       TEXT NOT NULL,
    note_type     TEXT NOT NULL,
    status        TEXT NOT NULL,
    note_summary  TEXT NOT NULL,
    created_at    TEXT NOT NULL)`);
  return d;
}

function nowIso(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const base = d.toISOString().slice(0, 19);
  return `${base}${sign}${pad(Math.floor(off / 60))}:${pad(off % 60)}`;
}

function sanitize(s: string): string {
  return (s || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "x";
}

function tableName(agent: string, session: string): string {
  return `n_${sanitize(agent)}_${sanitize(session)}`;
}

/** Resolve which (session_id, tbl) a note belongs to — fully automatic. */
function resolveSession(d: Database, agent: string, sessionId?: string):
  { sessionId: string; tbl: string } {
  const agentKey = sanitize(agent) || "unknown";
  if (sessionId && sessionId.trim()) {
    const sid = sanitize(sessionId);
    return { sessionId: sid, tbl: tableName(agentKey, sid) };
  }
  // automatic: reuse the agent's active session, else create one
  const cur = d.query("SELECT session_id FROM _sessions WHERE agent=?").get(agentKey) as
    { session_id: string } | undefined;
  if (cur) return { sessionId: cur.session_id, tbl: tableName(agentKey, cur.session_id) };
  const sid = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  d.query("INSERT OR REPLACE INTO _sessions (agent, session_id, opened_at) VALUES (?,?,?)")
    .run(agentKey, sid, nowIso());
  return { sessionId: sid, tbl: tableName(agentKey, sid) };
}

function ensureTable(d: Database, tbl: string): void {
  d.run(`CREATE TABLE IF NOT EXISTS ${tbl} (
    id          TEXT PRIMARY KEY,
    agent       TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    project     TEXT NOT NULL,
    source_dir  TEXT NOT NULL,
    source_file TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    note_type   TEXT NOT NULL,
    note        TEXT NOT NULL,
    status      TEXT NOT NULL)`);
}

export function addNote(args: {
  agent: string;
  session_id?: string;
  project?: string;
  source?: string;          // "dir/filename" current working source
  source_dir?: string;
  source_file?: string;
  note_type: string;        // one of NOTE_TYPES
  note: string;
  status?: string;
}): { id: string; agent: string; session_id: string; tbl: string } {
  const d = db();
  try {
    const type = String(args.note_type || "info").toLowerCase();
    if (!(NOTE_TYPES as readonly string[]).includes(type)) {
      throw new Error(`invalid note_type '${args.note_type}' — allowed: ${NOTE_TYPES.join(", ")}`);
    }
    let status = String(args.status || "open").toLowerCase();
    if (!(NOTE_STATUSES as readonly string[]).includes(status)) status = "open";

    const agentKey = sanitize(args.agent) || "unknown";
    const { sessionId, tbl } = resolveSession(d, agentKey, args.session_id);
    ensureTable(d, tbl);

    const project = (args.project || "").trim() || "unspecified";
    const src = (args.source || "").trim();
    let sourceDir = (args.source_dir || "").trim();
    let sourceFile = (args.source_file || "").trim();
    if (src) {
      const idx = src.lastIndexOf("/");
      sourceDir = idx >= 0 ? src.slice(0, idx) : ".";
      sourceFile = idx >= 0 ? src.slice(idx + 1) : src;
    }
    if (!sourceDir) sourceDir = ".";
    if (!sourceFile) sourceFile = "-";

    const id = randomUUID();
    const ts = nowIso();
    d.query(`INSERT INTO ${tbl} (id, agent, session_id, project, source_dir, source_file,
             created_at, note_type, note, status) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, agentKey, sessionId, project, sourceDir, sourceFile, ts, type,
        String(args.note).trim(), status);
    d.query(`INSERT INTO _registry (id, agent, session_id, tbl, project, note_type, status,
             note_summary, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, agentKey, sessionId, tbl, project, type, status,
        String(args.note).trim().slice(0, 120), ts);
    return { id, agent: agentKey, session_id: sessionId, tbl };
  } finally {
    d.close();
  }
}

export function getNote(id: string): any | null {
  const d = db();
  try {
    const reg = d.query("SELECT * FROM _registry WHERE id=?").get(id) as any | undefined;
    if (!reg) return null;
    const row = d.query(`SELECT * FROM ${reg.tbl} WHERE id=?`).get(id) as any | undefined;
    return row ?? null;
  } finally {
    d.close();
  }
}

export function listNotes(f: { agent?: string; session_id?: string; project?: string;
  note_type?: string; status?: string } = {}): any[] {
  const d = db();
  try {
    const conds: string[] = [];
    const args: string[] = [];
    if (f.agent) { conds.push("agent=?"); args.push(sanitize(f.agent)); }
    if (f.session_id) { conds.push("session_id=?"); args.push(sanitize(f.session_id)); }
    if (f.project) { conds.push("project=?"); args.push(f.project.trim()); }
    if (f.note_type) { conds.push("note_type=?"); args.push(f.note_type.toLowerCase()); }
    if (f.status) { conds.push("status=?"); args.push(f.status.toLowerCase()); }
    const where = conds.length ? " WHERE " + conds.join(" AND ") : "";
    return d.query(
      `SELECT id, agent, session_id, project, note_type, status, note_summary, created_at
       FROM _registry${where} ORDER BY created_at DESC LIMIT 500`
    ).all(...(args as any)) as any[];
  } finally {
    d.close();
  }
}

export function listSessions(agent?: string): any[] {
  const d = db();
  try {
    if (agent) {
      return d.query(
        `SELECT agent, session_id, opened_at,
           (SELECT COUNT(*) FROM _registry r WHERE r.session_id=s.session_id) AS notes
         FROM _sessions s WHERE agent=? ORDER BY opened_at DESC`
      ).all(sanitize(agent)) as any[];
    }
    return d.query(
      `SELECT agent, session_id, opened_at,
         (SELECT COUNT(*) FROM _registry r WHERE r.session_id=s.session_id) AS notes
       FROM _sessions s ORDER BY opened_at DESC`
    ).all() as any[];
  } finally {
    d.close();
  }
}

export function newSession(agent: string): { agent: string; session_id: string; created: boolean } {
  const d = db();
  try {
    const agentKey = sanitize(agent) || "unknown";
    const sid = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    d.query("INSERT OR REPLACE INTO _sessions (agent, session_id, opened_at) VALUES (?,?,?)")
      .run(agentKey, sid, nowIso());
    return { agent: agentKey, session_id: sid, created: true };
  } finally {
    d.close();
  }
}

export function markStatus(id: string, status: string): { ok: boolean; message: string } {
  const st = String(status || "").toLowerCase();
  if (!(NOTE_STATUSES as readonly string[]).includes(st)) {
    return { ok: false, message: `invalid status — allowed: ${NOTE_STATUSES.join(", ")}` };
  }
  const d = db();
  try {
    const reg = d.query("SELECT * FROM _registry WHERE id=?").get(id) as any | undefined;
    if (!reg) return { ok: false, message: `no note with id ${id}` };
    d.query(`UPDATE ${reg.tbl} SET status=? WHERE id=?`).run(st, id);
    d.query("UPDATE _registry SET status=? WHERE id=?").run(st, id);
    return { ok: true, message: `note ${id} marked ${st}` };
  } finally {
    d.close();
  }
}

// ---------------------------------------------------------------- formatting
function fmtNote(r: any): string {
  return [
    `id        : ${r.id}`,
    `agent     : ${r.agent}`,
    `session   : ${r.session_id}`,
    `project   : ${r.project}`,
    `source    : ${r.source_dir}/${r.source_file}`,
    `created   : ${r.created_at}`,
    `type      : ${r.note_type}`,
    `status    : ${r.status}`,
    ``,
    `${r.note}`,
  ].join("\n");
}

function fmtList(rows: any[]): string {
  if (!rows.length) return "(no notes)";
  const hdr = "id                                  agent      type      status  created              project   note";
  const lines = [hdr, "-".repeat(hdr.length)];
  for (const r of rows) {
    lines.push(
      `${r.id.slice(0, 36).padEnd(36)} ${(r.agent || "").slice(0, 10).padEnd(10)} ` +
      `${(r.note_type || "").slice(0, 8).padEnd(8)} ${(r.status || "").slice(0, 6).padEnd(6)}  ` +
      `${r.created_at}  ${(r.project || "").slice(0, 9).padEnd(9)} ${r.note_summary || ""}`
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- MCP
type MCPRequest = { jsonrpc: string; id?: number | string; method: string; params?: any };

const TOOLS = [
  {
    name: "note",
    description: `Record a notable event. Type must be one of: ${NOTE_TYPES.join(", ")}. `
      + `Session routing is automatic: pass session_id to pin a session, omit it to reuse ` +
      `this agent's current open session (auto-created if none). Always include project and ` +
      `source (the current working dir/file) when known. Returned: note id, agent, session_id. ` +
      `Diversions from plan/spec/source must be logged as type=diversion. Todos as type=todo. ` +
      `Final conclusions as type=report.`,
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Your own agent name (orchestrator, sub-orchestrator, coder, fixer, auditor, planner, ...)" },
        session_id: { type: "string", description: "Optional; omit to auto-reuse this agent's active session" },
        project: { type: "string", description: "Project name" },
        source: { type: "string", description: "Current working source dir+filename (e.g. src/app.ts or /path/file)" },
        note_type: { type: "string", enum: [...NOTE_TYPES], description: "Note type" },
        note: { type: "string", description: "The note body" },
        status: { type: "string", enum: [...NOTE_STATUSES], description: "Default open" },
      },
      required: ["agent", "note_type", "note"],
    },
  },
  {
    name: "note_get",
    description: `Fetch one note by its id (e.g. 'note {ID}'). Use to read a report/conclusion note ` +
      `referenced by a lower agent or a sub-orchestrator report.`,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "note_list",
    description: "List notes (latest first) filtered by agent/session/project/type/status.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        session_id: { type: "string" },
        project: { type: "string" },
        note_type: { type: "string", enum: [...NOTE_TYPES] },
        status: { type: "string", enum: [...NOTE_STATUSES] },
      },
    },
  },
  {
    name: "note_sessions",
    description: "List agent sessions with note counts. Optional agent filter.",
    inputSchema: {
      type: "object",
      properties: { agent: { type: "string" } },
    },
  },
  {
    name: "note_new_session",
    description: "Start a fresh session for an agent (new table). Call when beginning a new task/session.",
    inputSchema: {
      type: "object",
      properties: { agent: { type: "string" } },
      required: ["agent"],
    },
  },
  {
    name: "note_mark",
    description: "Mark a note status: open | reported | done. Use reported once a report note has been relayed upward.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: [...NOTE_STATUSES] },
      },
      required: ["id", "status"],
    },
  },
];

function callTool(name: string, args: any): { text: string; isError: boolean } {
  try {
    switch (name) {
      case "note": {
        const r = addNote({
          agent: args?.agent, session_id: args?.session_id, project: args?.project,
          source: args?.source, note_type: args?.note_type, note: args?.note,
          status: args?.status,
        });
        return { text: `saved note ${r.id}\nagent: ${r.agent}\nsession: ${r.session_id}`, isError: false };
      }
      case "note_get": {
        const r = getNote(args?.id);
        if (!r) return { text: `no note with id ${args?.id}`, isError: true };
        return { text: fmtNote(r), isError: false };
      }
      case "note_list":
        return { text: fmtList(listNotes(args || {})), isError: false };
      case "note_sessions": {
        const rows = listSessions(args?.agent);
        if (!rows.length) return { text: "(no sessions yet)", isError: false };
        return { text: rows.map((r) =>
          `${r.agent.padEnd(14)} ${r.session_id.padEnd(20)} ${r.opened_at}  ${r.notes} notes`).join("\n"),
          isError: false };
      }
      case "note_new_session":
        return { text: JSON.stringify(newSession(args?.agent)), isError: false };
      case "note_mark": {
        const r = markStatus(args?.id, args?.status);
        return { text: r.message, isError: !r.ok };
      }
      default:
        return { text: `unknown tool: ${name}`, isError: true };
    }
  } catch (e: any) {
    return { text: `error: ${e.message}`, isError: true };
  }
}

async function runMcp() {
  const rl = (await import("node:readline")).createInterface({ input: process.stdin });
  const send = (obj: any) => process.stdout.write(JSON.stringify(obj) + "\n");
  rl.on("line", (line: string) => {
    line = line.trim();
    if (!line) return;
    let msg: MCPRequest;
    try { msg = JSON.parse(line); } catch { return; }
    const { id, method, params } = msg;
    if (id === undefined || id === null) return;
    if (method === "initialize") {
      send({ jsonrpc: "2.0", id, result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: VERSION },
      }});
    } else if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
    } else if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    } else if (method === "tools/call") {
      const res = callTool(params?.name, params?.arguments);
      send({ jsonrpc: "2.0", id, result: {
        content: [{ type: "text", text: res.text }], isError: res.isError,
      }});
    } else if (method === "resources/list" || method === "prompts/list") {
      send({ jsonrpc: "2.0", id, result: { resources: [], prompts: [] } });
    } else {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
    }
  });
  await new Promise(() => {});
}

// ---------------------------------------------------------------- CLI
function cli(argv: string[]): number {
  const [cmd, a] = argv;
  const flagArgs = argv.slice(2);            // everything after the subcommand
  const optAll = (names: string[]): string | undefined => {
    // flags may appear anywhere after `cmd` (list --type report => position 1)
    const all = argv.slice(1);
    for (let i = 0; i < all.length - 1; i++) {
      if (names.includes(all[i])) return all[i + 1];
    }
    return undefined;
  };
  const opt = (names: string[]): string | undefined => {
    for (let i = 0; i < flagArgs.length - 1; i++) {
      if (names.includes(flagArgs[i])) return flagArgs[i + 1];
    }
    return undefined;
  };
  if (!cmd) {
    console.log(`usage: note <add|get|list|sessions|new-session|mark|check> ...`);
    return 2;
  }
  try {
    switch (cmd) {
      case "add": {
        const type = a;
        const text = opt(["--note", "-n"]) ||
          (argv[2] && !argv[2].startsWith("-") ? argv[2] : undefined);
        if (!type || !text || !(NOTE_TYPES as readonly string[]).includes(type.toLowerCase())) {
          console.log(`usage: note add <type> \"note text\" [--agent a] [--session s] [--project p] [--source dir/file]`);
          console.log(`types: ${NOTE_TYPES.join(", ")}`);
          return 2;
        }
        const r = addNote({
          agent: opt(["--agent", "-a"]) || "unknown",
          session_id: opt(["--session", "-s"]),
          project: opt(["--project", "-p"]),
          source: opt(["--source"]),
          note_type: type.toLowerCase(),
          note: text,
          status: opt(["--status"]),
        });
        console.log(`saved note ${r.id} (agent=${r.agent} session=${r.session_id})`);
        return 0;
      }
      case "get": {
        if (!a) { console.log("usage: note get <id>"); return 2; }
        const r = getNote(a);
        if (!r) { console.log(`no note with id ${a}`); return 1; }
        console.log(fmtNote(r));
        return 0;
      }
      case "list":
        console.log(fmtList(listNotes({
          agent: optAll(["--agent", "-a"]), session_id: optAll(["--session", "-s"]),
          project: optAll(["--project", "-p"]), note_type: optAll(["--type", "-t"]),
          status: optAll(["--status"]),
        })));
        return 0;
      case "sessions": {
        const rows = listSessions(optAll(["--agent", "-a"]));
        if (!rows.length) { console.log("(no sessions yet)"); return 0; }
        for (const r of rows) console.log(`${r.agent.padEnd(14)} ${r.session_id.padEnd(20)} ${r.opened_at}  ${r.notes} notes`);
        return 0;
      }
      case "new-session": {
        if (!a) { console.log("usage: note new-session <agent>"); return 2; }
        const r = newSession(a);
        console.log(`new session ${r.session_id} for ${r.agent}`);
        return 0;
      }
      case "mark": {
        const status = flagArgs.find((x) => !x.startsWith("-"));
        if (!a || !status) { console.log("usage: note mark <id> <open|reported|done>"); return 2; }
        const r = markStatus(a, status as string);
        console.log(r.message);
        return r.ok ? 0 : 1;
      }
      case "check": {
        const d = db();
        const integ = (d.query("PRAGMA integrity_check").get() as any).integrity_check;
        const ntables = d.query("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name LIKE 'n_%'").get() as { c: number };
        const nnotes = d.query("SELECT COUNT(*) c FROM _registry").get() as { c: number };
        d.close();
        console.log(`integrity: ${integ}\ntables   : ${ntables.c}\nnotes    : ${nnotes.c}`);
        console.log(`\nRESULT: ${integ === "ok" ? "PASS" : "FAIL"}`);
        return integ === "ok" ? 0 : 1;
      }
      default:
        console.log(`unknown command: ${cmd}`);
        return 2;
    }
  } catch (e: any) {
    console.log(`error: ${e.message}`);
    return 1;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--mcp") await runMcp();
  else process.exitCode = cli(argv);
}

main();