#!/usr/bin/env bun
// screenshot — Termux screenshot MCP server + CLI (bun, zero-dependency).
//
// Takes screenshots via the ScreenshotTile app broadcast intent and reads
// (copies) existing screenshots from the device into the agent working dir.
//
// Research (verified 2026-09-12 from README + AndroidManifest + IntentHandler.kt):
//   action : com.github.cvzi.screenshottile.SCREENSHOT
//   package: com.github.cvzi.screenshottile (receiver exported=true, open broadcast)
//   command: am broadcast --user 0 -a com.github.cvzi.screenshottile.SCREENSHOT -e secret '<PW>' com.github.cvzi.screenshottile
//   (--user 0 is required: Termux am defaults to user -2, which Android 14
//   rejects with SecurityException/INTERACT_ACROSS_USERS)
//   extras : secret (String, REQUIRED — set in app Settings), partial (optional bool/"true")
//   saves  : Pictures/Screenshots/Screenshot_yyyy-MM-dd_HH-mm-ss.png (default)
//   works from unrooted Termux/proot shells; no su/Shizuku needed.
//
// Usage:
//   screenshot take [--secret PW] [--partial] [--no-copy] [--wait-ms N]
//   screenshot read [count]            # copy latest N (default 1) into ./ss/
//   screenshot list [count]            # list latest device screenshots (no copy)
//   screenshot check                   # am binary + screenshot dir sanity (RESULT: PASS/FAIL)
//   screenshot --mcp                   # run as MCP server (stdio JSON-RPC)
//
// Env overrides: AM_BIN, SCREENSHOT_SECRET, SCREENSHOT_DIR, SS_DIR.
// The ss/ dir is pruned to the 10 most recent PNGs on every copy.

const SERVER_NAME = "screenshot";
const VERSION = "1.0";

const ACTION = "com.github.cvzi.screenshottile.SCREENSHOT";
const PACKAGE = "com.github.cvzi.screenshottile";
const KEEP = 10;

const fs = await import("node:fs");
const path = await import("node:path");
const os = await import("node:os");

// ---------------------------------------------------------------- helpers
function whichAm(): string | undefined {
  const cands = [
    process.env.AM_BIN,
    "am",
    "/data/data/com.termux/files/usr/bin/am",
    "/system/bin/am",
    "/system/xbin/am",
  ].filter(Boolean) as string[];
  for (const c of cands) {
    if (c.includes("/")) {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return c;
      } catch { /* next */ }
    } else {
      const r = Bun.spawnSync(["sh", "-c", `command -v ${c}`]);
      const p = r.stdout.toString().trim().split("\n")[0];
      if (r.exitCode === 0 && p) return p;
    }
  }
  return undefined;
}

function deviceDir(): string | undefined {
  const home = os.homedir();
  const cands = [
    process.env.SCREENSHOT_DIR,
    "/sdcard/Pictures/Screenshots",
    "/storage/emulated/0/Pictures/Screenshots",
    `${home}/storage/shared/Pictures/Screenshots`,
    "/data/data/com.termux/files/home/storage/shared/Pictures/Screenshots",
    `${home}/storage/pictures/Screenshots`,
  ].filter(Boolean) as string[];
  for (const c of cands) {
    try {
      if (fs.statSync(c).isDirectory()) return c;
    } catch { /* next */ }
  }
  return undefined;
}

function ssDir(): string {
  return process.env.SS_DIR || path.join(process.cwd(), "ss");
}

type Shot = { name: string; devPath: string; mtimeMs: number; size: number };

function listShots(dir: string, limit?: number): Shot[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const shots: Shot[] = [];
  for (const n of names) {
    if (!/\.png$/i.test(n)) continue;
    const p = path.join(dir, n);
    try {
      const st = fs.statSync(p);
      if (st.isFile()) shots.push({ name: n, devPath: p, mtimeMs: st.mtimeMs, size: st.size });
    } catch { /* skip unreadable */ }
  }
  shots.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : -1));
  return limit === undefined ? shots : shots.slice(0, limit);
}

function newestSet(dir: string): Set<string> {
  return new Set(listShots(dir).map((s) => s.name));
}

// Prune ss/ to the KEEP most recent PNGs. Returns number of files deleted.
function pruneSs(dir: string): number {
  const shots = listShots(dir);
  if (shots.length <= KEEP) return 0;
  let removed = 0;
  for (const s of shots.slice(KEEP)) {
    try {
      fs.unlinkSync(path.join(dir, s.name));
      removed++;
    } catch { /* keep going */ }
  }
  return removed;
}

// Copy shots into ss/; skip names already present with same size. Returns copied names.
function copyToSs(shots: Shot[], dir: string): { copied: string[]; skipped: string[] } {
  fs.mkdirSync(dir, { recursive: true });
  const copied: string[] = [];
  const skipped: string[] = [];
  for (const s of shots) {
    const dest = path.join(dir, s.name);
    try {
      const st = fs.statSync(dest);
      if (st.isFile() && st.size === s.size) {
        skipped.push(s.name);
        continue;
      }
    } catch { /* not present — copy */ }
    try {
      fs.copyFileSync(s.devPath, dest);
      copied.push(s.name);
    } catch { /* unreadable source — ignore */ }
  }
  return { copied, skipped };
}

function fmtPaths(ssdir: string, names: string[]): string {
  return names.map((n) => `- ${n}  (${path.join(ssdir, n)})`).join("\n");
}

// ---------------------------------------------------------------- core ops
function opCheck(): { text: string; ok: boolean } {
  const am = whichAm();
  const dir = deviceDir();
  const lines = [
    `am binary : ${am ?? "(not found — set AM_BIN or expose Termux am)"}`,
    `device dir: ${dir ?? "(not found — set SCREENSHOT_DIR)"}`,
  ];
  if (dir) lines.push(`png count : ${listShots(dir).length}`);
  lines.push(`ss dir    : ${ssDir()} (pruned to last ${KEEP} on every copy)`);
  const ok = !!am && !!dir;
  lines.push(`\nRESULT: ${ok ? "PASS" : "FAIL"}`);
  if (!process.env.SCREENSHOT_SECRET) {
    lines.push(`Note: SCREENSHOT_SECRET is unset — screenshot_take needs the app password (app Settings → broadcast intent password).`);
  }
  return { text: lines.join("\n"), ok };
}

function opTake(opts: { secret?: string; partial?: boolean; copy?: boolean; waitMs?: number }): { text: string; isError: boolean } {
  const am = whichAm();
  if (!am) return { text: `error: no 'am' binary found. Set AM_BIN=/data/data/com.termux/files/usr/bin/am (Termux) or expose am on PATH.`, isError: true };
  const dir = deviceDir();
  if (!dir) return { text: `error: no device screenshot dir found. Set SCREENSHOT_DIR (default /sdcard/Pictures/Screenshots).`, isError: true };
  const secret = opts.secret || process.env.SCREENSHOT_SECRET;
  if (!secret) {
    return { text: `error: screenshot password missing. Set it once in the ScreenshotTile app (Settings → broadcast intent password), then pass --secret / secret param or export SCREENSHOT_SECRET. Without it the app ignores the broadcast.`, isError: true };
  }
  const waitMs = opts.waitMs ?? 15000;
  const before = newestSet(dir);

  const args = ["broadcast", "--user", "0", "-a", ACTION, "-e", "secret", secret];
  if (opts.partial) args.push("--ez", "partial", "true");
  args.push(PACKAGE);
  const r = Bun.spawnSync([am, ...args]);
  if (r.exitCode !== 0) {
    return { text: `error: am broadcast failed (exit ${r.exitCode}): ${r.stderr.toString().trim() || r.stdout.toString().trim()}`, isError: true };
  }

  // Poll for the new PNG the broadcast should produce.
  const t0 = Date.now();
  let fresh: Shot[] = [];
  while (Date.now() - t0 < waitMs) {
    const now = listShots(dir);
    fresh = now.filter((s) => !before.has(s.name));
    if (fresh.length) break;
    Bun.sleepSync(500);
  }
  if (!fresh.length) {
    return { text: `Broadcast sent but no new PNG appeared in ${dir} within ${waitMs}ms.\nNote: check the app password, capture-method permissions (MediaProjection/accessibility per app Settings), and that the screen is on. Existing screenshots are still readable via screenshot_read.`, isError: true };
  }

  const lines = [
    `Screenshot captured: ${fresh[0].devPath}`,
    ...(fresh.length > 1 ? [`(also new: ${fresh.slice(1).map((s) => s.name).join(", ")})`] : []),
  ];
  if (opts.copy !== false) {
    const ss = ssDir();
    const { copied, skipped } = copyToSs([fresh[0]], ss);
    const pruned = pruneSs(ss);
    if (copied.length) lines.push(`Copied to ss/:\n${fmtPaths(ss, copied)}`);
    if (skipped.length) lines.push(`Already in ss/: ${skipped.join(", ")}`);
    lines.push(`Note: ss/ holds the last ${KEEP} screenshots (pruned ${pruned} old file(s) this call).`);
  } else {
    lines.push(`Note: copy skipped (--no-copy); use screenshot_read to copy it into ${ssDir()}/ss later.`);
  }
  return { text: lines.join("\n"), isError: false };
}

function opRead(count?: number): { text: string; isError: boolean } {
  const dir = deviceDir();
  if (!dir) return { text: `error: no device screenshot dir found. Set SCREENSHOT_DIR (default /sdcard/Pictures/Screenshots).`, isError: true };
  const n = Math.max(1, Math.floor(count ?? 1));
  const all = listShots(dir);
  if (!all.length) return { text: `No PNG screenshots found in ${dir}.`, isError: true };
  const picked = all.slice(0, n);
  const ss = ssDir();
  const { copied, skipped } = copyToSs(picked, ss);
  const pruned = pruneSs(ss);

  const lines = [`Screenshots copied to ${ss}/ (${copied.length} new, ${skipped.length} already present):`];
  const names = [...copied, ...skipped];
  if (names.length) lines.push(fmtPaths(ss, names));
  lines.push(`Note: picked the ${picked.length} latest of ${all.length} PNG(s) in ${dir}; ss/ keeps the last ${KEEP} (pruned ${pruned} old file(s) this call).`);
  return { text: lines.join("\n"), isError: false };
}

// ---------------------------------------------------------------- MCP
type MCPRequest = { jsonrpc: string; id?: number | string; method: string; params?: any };

const TOOLS = [
  {
    name: "screenshot_take",
    description: `Take a new screenshot on the Android device via the ScreenshotTile app broadcast intent (am broadcast, no root). ` +
      `The app password must be set (app Settings → broadcast intent password); pass it as secret or export SCREENSHOT_SECRET. ` +
      `Returns the captured device path and, unless copy=false, the copied ss/ path plus a Note. ss/ keeps the last ${KEEP} screenshots.`,
    inputSchema: {
      type: "object",
      properties: {
        secret: { type: "string", description: "ScreenshotTile broadcast password (fallback: SCREENSHOT_SECRET env)" },
        partial: { type: "boolean", description: "Open the area selector for a partial screenshot instead of full capture" },
        copy: { type: "boolean", description: "Copy the new PNG into <cwd>/ss/ (default true)" },
        wait_ms: { type: "number", description: "Max wait for the new PNG to appear (default 15000)" },
      },
    },
  },
  {
    name: "screenshot_read",
    description: `Copy the latest N existing device screenshots into <cwd>/ss/ (agent working dir) and return their paths with file names plus a Note. ` +
      `Keeps only the last ${KEEP} PNGs in ss/ (older ones deleted on every call). Use this to view screenshots in this session.`,
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "How many of the latest screenshots to copy (default 1)" },
      },
    },
  },
];

function callTool(name: string, args: any): { text: string; isError: boolean } {
  try {
    switch (name) {
      case "screenshot_take":
        return opTake({
          secret: args?.secret,
          partial: args?.partial,
          copy: args?.copy,
          waitMs: args?.wait_ms,
        });
      case "screenshot_read":
        return opRead(args?.count);
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
  const opt = (names: string[]): string | undefined => {
    for (let i = 1; i < argv.length - 1; i++) {
      if (names.includes(argv[i])) return argv[i + 1];
    }
    return undefined;
  };
  const has = (names: string[]): boolean => argv.slice(1).some((x) => names.includes(x));
  if (!cmd) {
    console.log(`usage: screenshot <take|read [count]|list [count]|check> ...`);
    return 2;
  }
  try {
    switch (cmd) {
      case "take": {
        const r = opTake({
          secret: opt(["--secret"]),
          partial: has(["--partial"]),
          copy: has(["--no-copy"]) ? false : true,
          waitMs: opt(["--wait-ms"]) ? parseInt(opt(["--wait-ms"])!, 10) : undefined,
        });
        console.log(r.text);
        return r.isError ? 1 : 0;
      }
      case "read": {
        const n = a && !a.startsWith("-") ? parseInt(a, 10) : 1;
        const r = opRead(Number.isFinite(n) ? n : 1);
        console.log(r.text);
        return r.isError ? 1 : 0;
      }
      case "list": {
        const dir = deviceDir();
        if (!dir) { console.log("error: no device screenshot dir found (set SCREENSHOT_DIR)."); return 1; }
        const n = a && !a.startsWith("-") ? parseInt(a, 10) : 5;
        const shots = listShots(dir, Number.isFinite(n) ? n : 5);
        if (!shots.length) { console.log(`No PNGs in ${dir}.`); return 0; }
        console.log(`Latest in ${dir}:`);
        for (const s of shots) console.log(`- ${s.name}`);
        return 0;
      }
      case "check": {
        const r = opCheck();
        console.log(r.text);
        return r.ok ? 0 : 1;
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
