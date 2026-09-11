#!/usr/bin/env bun
/**
 * Orchestrator Project Rulebook — bun-based CLI + MCP server (zero deps).
 *
 * Reads rulebook.db directly via bun:sqlite. Spawned via absolute interpreter
 * path, so it works regardless of PATH/Python availability in agent shells.
 *
 * CLI (same interface as rulebook.py):
 *   bun rulebook.ts types
 *   bun rulebook.ts summary
 *   bun rulebook.ts classify <loc>
 *   bun rulebook.ts playbook <type>
 *   bun rulebook.ts rules <type>
 *   bun rulebook.ts mandates <type> [--kind must|must_not]
 *   bun rulebook.ts check
 *
 * MCP server (stdio, JSON-RPC 2.0, newline-delimited):
 *   bun rulebook.ts --mcp
 */
import { Database } from "bun:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dir, "rulebook.db");
const SERVER_NAME = "rulebook";
const VERSION = "1.0";

// ---------------------------------------------------------------- db
function db() {
  if (!exists(DB_PATH)) {
    throw new Error(`rulebook.db not found at ${DB_PATH}`);
  }
  return new Database(DB_PATH, { readonly: true });
}

function exists(p: string): boolean {
  try {
    return (Bun.file(p).size ?? -1) >= 0;
  } catch {
    return false;
  }
}

function meta(key: string): string | null {
  const d = db();
  try {
    const r = d.query("SELECT value FROM meta WHERE key=?").get(key) as
      | { value: string }
      | undefined;
    return r ? r.value : null;
  } finally {
    d.close();
  }
}

const TYPE_ORDER = ["small", "medium", "big", "porting", "new_ui", "new_no_ui", "upgrade_vibe"];

function fmtRange(lo: number | null, hi: number | null): string {
  if (lo === null && hi === null) return "any";
  const l = lo === null ? "—" : String(lo);
  const h = hi === null ? "∞" : String(hi);
  return `[${l}–${h}]`;
}

// ---------------------------------------------------------------- query fns
function typesText(): string {
  const d = db();
  try {
    const rows = d
      .query(
        `SELECT key,name,loc_min,loc_max,strategy FROM project_types
         ORDER BY CASE key WHEN 'small' THEN 1 WHEN 'medium' THEN 2 WHEN 'big' THEN 3
         WHEN 'porting' THEN 4 WHEN 'new_ui' THEN 5 WHEN 'new_no_ui' THEN 6
         WHEN 'upgrade_vibe' THEN 7 ELSE 8 END`
      )
      .all() as {
      key: string;
      name: string;
      loc_min: number | null;
      loc_max: number | null;
      strategy: string;
    }[];
    const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
    let out = pad("key", 14) + pad("name", 34) + pad("LOC range", 18) + "strategy\n";
    out += "-".repeat(120) + "\n";
    for (const r of rows) {
      out += `${pad(r.key, 14)}${pad(r.name, 34)}${pad(fmtRange(r.loc_min, r.loc_max), 18)}${r.strategy.slice(0, 60)}\n`;
    }
    return out.trimEnd();
  } finally {
    d.close();
  }
}

function summaryText(): string {
  const d = db();
  try {
    let out = "";
    for (const key of TYPE_ORDER) {
      const t = d
        .query("SELECT * FROM project_types WHERE key=?")
        .get(key) as {
        name: string;
        loc_min: number | null;
        loc_max: number | null;
      } | undefined;
      if (!t) continue;
      const rng =
        t.loc_min === null && t.loc_max === null
          ? "any size"
          : `${fmtRange(t.loc_min, t.loc_max)} LOC`;
      out += `── ${key}  (${t.name})  ${rng} ──\n`;
      const rows = d
        .query(
          "SELECT phase, step_no, title FROM guidelines WHERE type_key=? ORDER BY step_no"
        )
        .all(key) as { phase: string; step_no: number; title: string }[];
      let phase: string | null = null;
      for (const r of rows) {
        if (r.phase !== phase) {
          phase = r.phase;
          out += `  ${phase}:\n`;
        }
        out += `    - ${r.title}\n`;
      }
      out += "\n";
    }
    return out.trimEnd();
  } finally {
    d.close();
  }
}

function classifyText(loc: number): string {
  const smallMax = Number(meta("loc_small_max") ?? 1000);
  const mediumMax = Number(meta("loc_medium_max") ?? 20000);
  let key: string;
  if (loc <= smallMax) key = "small";
  else if (loc <= mediumMax) key = "medium";
  else key = "big";
  return `${loc} LOC → ${key}\n\n${playbookText(key)}`;
}

function playbookText(key: string): string {
  const d = db();
  try {
    const rows = d
      .query(
        "SELECT phase, step_no, priority, title, body FROM guidelines WHERE type_key=? ORDER BY step_no"
      )
      .all(key) as {
      phase: string;
      step_no: number;
      priority: number;
      title: string;
      body: string;
    }[];
    if (!rows.length) return `no guidelines for '${key}'`;
    let out = "";
    let phase: string | null = null;
    for (const r of rows) {
      if (r.phase !== phase) {
        phase = r.phase;
        out += `\n── ${phase.toUpperCase()} ──\n`;
      }
      out += `  [${r.step_no}] (p${r.priority}) ${r.title}\n`;
      out += `      ${r.body}\n`;
    }
    return out.trim();
  } finally {
    d.close();
  }
}

function rulesText(key: string): string {
  const d = db();
  try {
    const rows = d
      .query(
        "SELECT phase, step_no, priority, title, body, consequence FROM guidelines WHERE type_key=? ORDER BY step_no"
      )
      .all(key) as {
      phase: string;
      step_no: number;
      priority: number;
      title: string;
      body: string;
      consequence: string;
    }[];
    if (!rows.length) return `no guidelines for '${key}'`;
    let out = "";
    let phase: string | null = null;
    for (const r of rows) {
      if (r.phase !== phase) {
        phase = r.phase;
        out += `\n── ${phase.toUpperCase()} ──\n`;
      }
      out += `[${r.step_no}] ${r.title}  (priority ${r.priority})\n`;
      out += `    ${r.body}\n`;
      out += `    ⚠ if violated: ${r.consequence}\n`;
    }
    return out.trim();
  } finally {
    d.close();
  }
}

function mandatesText(key: string, kind?: string): string {
  const d = db();
  try {
    const args: string[] = [key];
    let q =
      "SELECT kind, seq, priority, directive, rationale FROM mandates WHERE type_key IN (?, 'all')";
    if (kind) {
      q += " AND kind=?";
      args.push(kind);
    }
    q += " ORDER BY CASE kind WHEN 'must' THEN 0 ELSE 1 END, seq";
    const rows = d.prepare(q).all(...(args as any)) as {
      kind: string;
      seq: number;
      priority: number;
      directive: string;
      rationale: string;
    }[];
    if (!rows.length) return `no mandates for '${key}'`;
    let out = "";
    for (const r of rows) {
      const tag = r.kind === "must" ? "MUST" : "MUST_NOT";
      out += `  [${tag}] ${r.directive}\n`;
      out += `      why: ${r.rationale}\n`;
    }
    return out.trimEnd();
  } finally {
    d.close();
  }
}

function checkText(): string {
  const d = db();
  try {
    const fk = d.query("PRAGMA foreign_key_check").all();
    const orphans = (
      d.query(
        "SELECT COUNT(*) c FROM guidelines g LEFT JOIN project_types t ON g.type_key=t.key WHERE t.key IS NULL"
      ).get() as { c: number }
    ).c;
    const mdOrphans = (
      d.query(
        "SELECT COUNT(*) c FROM mandates WHERE type_key NOT IN (SELECT key FROM project_types) AND type_key != 'all'"
      ).get() as { c: number }
    ).c;

    const types = d.query("SELECT key FROM project_types").all() as { key: string }[];
    const counts: Record<string, number> = {};
    const rm: Record<string, number> = {};
    for (const t of types) {
      counts[t.key] = 0;
      rm[t.key] = 0;
    }
    for (const r of d.query("SELECT type_key FROM guidelines").all() as {
      type_key: string;
    }[]) {
      counts[r.type_key] = (counts[r.type_key] ?? 0) + 1;
    }
    for (const r of d.query("SELECT type_key FROM mandates").all() as {
      type_key: string;
    }[]) {
      rm[r.type_key] = (rm[r.type_key] ?? 0) + 1;
    }
    const schema = meta("schema_version") ?? "?";
    const integrity = (d.query("PRAGMA integrity_check").get() as { integrity_check: string })
      .integrity_check;

    let out = "";
    out += `integrity_check        : ${integrity}\n`;
    out += `foreign_key_check      : ${fk.length} violations\n`;
    out += `guideline orphans      : ${orphans}\n`;
    out += `mandate orphans        : ${mdOrphans}\n`;
    out += `schema_version        : ${schema}\n\n`;
    out += "guidelines per type: " + JSON.stringify(counts) + "\n";
    out += "mandates   per type: " + JSON.stringify(rm) + "\n";
    const ok = integrity === "ok" && fk.length === 0 && orphans === 0 && mdOrphans === 0;
    out += `\nRESULT: ${ok ? "PASS" : "FAIL"}`;
    return out;
  } finally {
    d.close();
  }
}

// ---------------------------------------------------------------- MCP
type MCPRequest = {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: any;
};

const TOOLS = [
  {
    name: "rulebook_summary",
    description:
      "List every project rulebook with its tasks, grouped by phase. Use to see the whole doctrine at a glance.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "rulebook_types",
    description: "List the 7 project classifications, their LOC bounds, and one-line strategies.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "rulebook_classify",
    description:
      "Classify a project by LOC count → small/medium/big, then print that type's runbook. Include non-LOC nature override logic (porting/new_ui/new_no_ui/upgrade_vibe apply regardless of size).",
    inputSchema: {
      type: "object",
      properties: {
        loc: { type: "integer", description: "Lines of code count" },
        nature: {
          type: "string",
          enum: ["", "porting", "new_ui", "new_no_ui", "upgrade_vibe"],
          description: "Optional nature override; if set, return that type's runbook instead",
        },
      },
      required: ["loc"],
    },
  },
  {
    name: "rulebook_playbook",
    description: "Ordered phase runbook (guidelines) for a project type.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: TYPE_ORDER,
          description: "Project type key",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "rulebook_rules",
    description: "All guidelines for a type including the consequence if violated.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: TYPE_ORDER, description: "Project type key" },
      },
      required: ["type"],
    },
  },
  {
    name: "rulebook_mandates",
    description:
      "Non-negotiable must/must_not directives for a project type (includes cross-cutting 'all' mandates).",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: TYPE_ORDER, description: "Project type key" },
        kind: {
          type: "string",
          enum: ["must", "must_not"],
          description: "Filter by kind; omit for both",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "rulebook_check",
    description: "Integrity + coverage self-audit of the rulebook database.",
    inputSchema: { type: "object", properties: {} },
  },
];

function callTool(name: string, args: any): { text: string; isError: boolean } {
  try {
    switch (name) {
      case "rulebook_summary":
        return { text: summaryText(), isError: false };
      case "rulebook_types":
        return { text: typesText(), isError: false };
      case "rulebook_check":
        return { text: checkText(), isError: false };
      case "rulebook_classify": {
        const loc = Number(args?.loc);
        if (!Number.isInteger(loc) || loc < 0)
          return { text: "loc must be a non-negative integer", isError: true };
        const nature = args?.nature;
        if (nature === "porting" || nature === "new_ui" || nature === "new_no_ui" || nature === "upgrade_vibe") {
          const head = `${loc} LOC → ${nature} (nature override)\n`;
          return { text: head + "\n" + playbookText(nature), isError: false };
        }
        return { text: classifyText(loc), isError: false };
      }
      case "rulebook_playbook":
        return { text: playbookText(args?.type), isError: false };
      case "rulebook_rules":
        return { text: rulesText(args?.type), isError: false };
      case "rulebook_mandates":
        return { text: mandatesText(args?.type, args?.kind), isError: false };
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
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const { id, method, params } = msg;
    // notifications (no id) — no response
    if (id === undefined || id === null) return;

    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: VERSION },
        },
      });
    } else if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
    } else if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    } else if (method === "tools/call") {
      const res = callTool(params?.name, params?.arguments);
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: res.text }],
          isError: res.isError,
        },
      });
    } else if (method === "tools/list_changed") {
      send({ jsonrpc: "2.0", id, result: {} });
    } else if (method === "resources/list") {
      send({ jsonrpc: "2.0", id, result: { resources: [] } });
    } else if (method === "prompts/list") {
      send({ jsonrpc: "2.0", id, result: { prompts: [] } });
    } else {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `method not found: ${method}` },
      });
    }
  });
  await new Promise(() => {});
}

// ---------------------------------------------------------------- CLI
function cli(argv: string[]): number {
  const [cmd, arg, ...rest] = argv;
  const kindArg = rest.indexOf("--kind") !== -1 ? rest[rest.indexOf("--kind") + 1] : undefined;
  if (!cmd) {
    console.log(
      "usage: rulebook <types|summary|classify|playbook|rules|mandates|check> [arg] [--kind must|must_not]"
    );
    return 2;
  }
  switch (cmd) {
    case "types":
      console.log(typesText());
      return 0;
    case "summary":
      console.log(summaryText());
      return 0;
    case "check":
      console.log(checkText());
      return checkText().includes("RESULT: PASS") ? 0 : 1;
    case "classify": {
      if (arg === undefined) {
        console.log("usage: rulebook classify <loc>");
        return 2;
      }
      const loc = Number(arg);
      if (!Number.isInteger(loc) || loc < 0) {
        console.log("LOC must be a non-negative integer");
        return 2;
      }
      console.log(classifyText(loc));
      return 0;
    }
    case "playbook":
    case "rules":
    case "mandates": {
      if (arg === undefined) {
        console.log(`usage: rulebook ${cmd} <type>`);
        return 2;
      }
      const out =
        cmd === "playbook"
          ? playbookText(arg)
          : cmd === "rules"
            ? rulesText(arg)
            : mandatesText(arg, kindArg);
      console.log(out);
      return 0;
    }
    default:
      console.log(`unknown command: ${cmd}`);
      return 2;
  }
}

// ---------------------------------------------------------------- entry
async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--mcp") {
    await runMcp();
  } else {
    process.exitCode = cli(argv);
  }
}

main();