# screenshot — Termux screenshot MCP tool

Takes screenshots via the ScreenshotTile app broadcast intent and copies
existing device screenshots into the agent working dir (`<cwd>/ss/`).

## Setup (one time, on the phone)

1. Install **ScreenshotTile** (`com.github.cvzi.screenshottile`, F-Droid/Play).
2. In the app: Settings → set a **broadcast intent password**.
3. Grant the capture method it asks for (MediaProjection or accessibility).
4. Export the password for agent shells: `export SCREENSHOT_SECRET='<pw>'`
   (or pass `secret` per call).

## Tools (MCP server `screenshot`, also CLI)

- `screenshot_take` — `am broadcast --user 0 -a com.github.cvzi.screenshottile.SCREENSHOT
  -e secret '<pw>' com.github.cvzi.screenshottile`
  (`--user 0` is required — Termux `am` defaults to user -2, rejected on Android 14)
  (optional `partial: true` opens the area selector). Polls
  `/sdcard/Pictures/Screenshots` for the new PNG, copies it to `<cwd>/ss/`.
  The poll waits for the MediaStore-committed final name (not the `.pending-*`
  temp file) and the copy re-resolves + retries once across the rename.
- `screenshot_read {count}` — copies the latest N (default 1) existing PNGs
  into `<cwd>/ss/`. Returns full paths with file names + a Note.
- `screenshot_app {package, activity?, wait_s?}` — opens the app (launcher
  auto-resolved via `cmd package resolve-activity --user 0`), waits N seconds
  (default 3), captures via `screenshot_take`, then returns to Termux.

Every copy prunes `ss/` to the **last 10 PNGs** (older deleted each call).
`ss/` is git-ignored (`**/ss/` in the repo `.gitignore`).

## CLI

```
screenshot take [--secret PW] [--partial] [--no-copy] [--wait-ms N]
screenshot read [count]     # latest N into ./ss/
screenshot list [count]     # list latest device PNGs (no copy)
screenshot check            # RESULT: PASS/FAIL (am binary + dir)
```

Env overrides: `AM_BIN`, `SCREENSHOT_SECRET`, `SCREENSHOT_DIR`, `SS_DIR`.
