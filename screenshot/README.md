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

- `screenshot_take` — `am broadcast -a com.github.cvzi.screenshottile.SCREENSHOT
  -e secret '<pw>' com.github.cvzi.screenshottile`
  (optional `partial: true` opens the area selector). Polls
  `/sdcard/Pictures/Screenshots` for the new PNG, copies it to `<cwd>/ss/`.
- `screenshot_read {count}` — copies the latest N (default 1) existing PNGs
  into `<cwd>/ss/`. Returns full paths with file names + a Note.

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
