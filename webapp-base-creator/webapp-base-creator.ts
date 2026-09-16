#!/usr/bin/env bun
/**
 * webapp-base-creator — bun-based CLI + MCP server (zero deps).
 *
 * Scaffolds the Kotlin WebView host base for webapp-android-builder,
 * following the MT host-apk design (juagamesacc-pixel/MT):
 * Theme.MT dark theme, full-sticky immersive system bars, WebViewAssetLoader
 * https origin serving assets/web/app/, JS bridge + ready-signal + fallback
 * page, fix-asset-paths + copy-web-to-assets script pair, single workflow.
 * Theme values below are observed MT values, never invented.
 *
 * CLI:
 *   bun webapp-base-creator.ts create --projectDir /abs/path --packageName com.example.app --appName "My App" --versionName 1.0.0 [--versionCode 1] [--minSdk 24] [--targetSdk 34] [--compileSdk 34] [--abi arm64-v8a,armeabi-v7a] [--overwrite false]
 *
 * MCP server (stdio, JSON-RPC 2.0, newline-delimited):
 *   bun webapp-base-creator.ts --mcp
 */
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SERVER_NAME = "webapp-base-creator";
const VERSION = "1.0";

type CreateArgs = {
  projectDir: string;
  packageName: string;
  appName: string;
  versionName: string;
  versionCode?: number;
  minSdk?: number;
  targetSdk?: number;
  compileSdk?: number;
  abiFilters?: string[];
  overwrite?: boolean;
};

const PKG_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i;

function fail(msg: string): never {
  throw new Error(msg);
}

function validate(a: CreateArgs): Required<Omit<CreateArgs, "overwrite">> & { overwrite: boolean } {
  if (!a.projectDir || !resolve(a.projectDir)) fail("projectDir (absolute) is required");
  const dir = resolve(a.projectDir);
  if (!a.packageName || !PKG_RE.test(a.packageName)) fail(`packageName invalid: ${a.packageName}`);
  if (!a.appName || !a.appName.trim()) fail("appName is required");
  if (!a.versionName || !a.versionName.trim()) fail("versionName is required");
  const versionCode = a.versionCode ?? 1;
  if (!Number.isInteger(versionCode) || versionCode < 1) fail("versionCode must be integer >= 1");
  const minSdk = a.minSdk ?? 24;
  const targetSdk = a.targetSdk ?? 34;
  const compileSdk = a.compileSdk ?? 34;
  for (const [k, v] of [["minSdk", minSdk], ["targetSdk", targetSdk], ["compileSdk", compileSdk]] as const) {
    if (!Number.isInteger(v) || v < 21 || v > 36) fail(`${k} must be integer 21..36, got ${v}`);
  }
  if (minSdk > targetSdk || targetSdk > compileSdk) fail("require minSdk <= targetSdk <= compileSdk");
  const abiFilters = a.abiFilters?.length ? a.abiFilters : ["arm64-v8a"];
  for (const abi of abiFilters) {
    if (!/^[a-z0-9_-]+$/i.test(abi)) fail(`abiFilter invalid: ${abi}`);
  }
  return { projectDir: dir, packageName: a.packageName, appName: a.appName.trim(), versionName: a.versionName.trim(), versionCode, minSdk, targetSdk, compileSdk, abiFilters, overwrite: !!a.overwrite };
}

function isNonEmptyDir(p: string): boolean {
  try {
    if (!existsSync(p)) return false;
    const st = statSync(p);
    if (!st.isDirectory()) fail(`projectDir exists and is not a directory: ${p}`);
    return readdirSync(p).length > 0;
  } catch (e: any) {
    if (e.message?.startsWith("projectDir exists")) throw e;
    return false;
  }
}

function pkgPath(pkg: string): string {
  return pkg.replace(/\./g, "/");
}

function workflowYml(): string {
  return `name: build-web-and-apk
on:
  push:
    branches: ["**"]
  workflow_dispatch:

jobs:
  build-web-and-apk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20.19.0"

      - name: Build React UI (base './' => ./assets/)
        working-directory: web
        run: |
          npm install --no-audit --no-fund
          npm run build
          test -f dist/index.html || (echo "dist/index.html missing" && exit 1)

      - name: Rewrite built index.html asset paths
        run: bash scripts/fix-asset-paths.sh web/dist

      - name: Copy web content into Android assets
        run: bash scripts/copy-web-to-assets.sh

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"

      - uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: 8.10.2

      - name: Accept Android SDK licenses
        run: yes | sdkmanager --licenses || true

      - name: Assemble debug APK
        working-directory: android
        run: gradle :app:assembleDebug

      - uses: actions/upload-artifact@v4
        with:
          name: app-debug
          path: android/app/build/outputs/apk/debug/*.apk

      - name: Assemble release APK (unsigned)
        working-directory: android
        run: gradle :app:assembleRelease

      - uses: actions/upload-artifact@v4
        with:
          name: app-release
          path: android/app/build/outputs/apk/release/*.apk
`;
}

function files(v: Required<Omit<CreateArgs, "overwrite">> & { overwrite: boolean }): Array<[string, string]> {
  const abi = v.abiFilters.map((s) => `"${s}"`).join(", ");
  const pp = pkgPath(v.packageName);
  return [
    ["settings.gradle.kts", `pluginManagement {\n  repositories {\n    google()\n    mavenCentral()\n    gradlePluginPortal()\n  }\n}\ndependencyResolutionManagement {\n  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)\n  repositories {\n    google()\n    mavenCentral()\n  }\n}\nrootProject.name = "${v.appName}"\ninclude(":app")\n`],
    ["build.gradle.kts", `plugins {\n  id("com.android.application") version "8.5.2" apply false\n  id("org.jetbrains.kotlin.android") version "2.0.20" apply false\n}\n`],
    ["gradle.properties", `org.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\nkotlin.code.style=official\nandroid.nonTransitiveRClass=true\n`],
    ["gradle/wrapper/gradle-wrapper.properties", `distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-8.7-bin.zip\nnetworkTimeout=10000\nvalidateDistributionUrl=true\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\n`],
    ["app/build.gradle.kts", `plugins {\n  id("com.android.application")\n  id("org.jetbrains.kotlin.android")\n}\n\nandroid {\n  namespace = "${v.packageName}"\n  compileSdk = ${v.compileSdk}\n\n  defaultConfig {\n    applicationId = "${v.packageName}"\n    minSdk = ${v.minSdk}\n    targetSdk = ${v.targetSdk}\n    versionCode = ${v.versionCode}\n    versionName = "${v.versionName}"\n    ndk { abiFilters += listOf(${abi}) }\n  }\n\n  buildTypes {\n    release {\n      isMinifyEnabled = false\n    }\n  }\n  compileOptions {\n    sourceCompatibility = JavaVersion.VERSION_17\n    targetCompatibility = JavaVersion.VERSION_17\n  }\n  kotlinOptions { jvmTarget = "17" }\n}\n\ndependencies {\n  implementation("androidx.core:core-ktx:1.13.1")\n  implementation("androidx.appcompat:appcompat:1.7.0")\n  implementation("com.google.android.material:material:1.12.0")\n  implementation("androidx.webkit:webkit:1.10.0")\n}\n`],
    ["app/src/main/AndroidManifest.xml", `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <!-- MT-minimal permissions: offline-first host needs none. Coder adds uses-permission only if remote content is required. -->\n  <application\n    android:allowBackup="true"\n    android:label="${v.appName}"\n    android:supportsRtl="true"\n    android:theme="@style/Theme.MT">\n    <activity\n      android:name=".MainActivity"\n      android:exported="true"\n      android:hardwareAccelerated="true"\n      android:configChanges="orientation|screenSize|keyboardHidden"\n      android:windowSoftInputMode="adjustResize">\n      <intent-filter>\n        <action android:name="android.intent.action.MAIN" />\n        <category android:name="android.intent.category.LAUNCHER" />\n      </intent-filter>\n    </activity>\n  </application>\n</manifest>\n`],
    [`app/src/main/java/${pp}/MainActivity.kt`, `package ${v.packageName}\n\nimport android.graphics.Color\nimport android.os.Build\nimport android.os.Bundle\nimport android.view.View\nimport android.view.WindowInsetsController\nimport android.webkit.WebResourceError\nimport android.webkit.WebResourceRequest\nimport android.webkit.WebResourceResponse\nimport android.webkit.WebSettings\nimport android.webkit.WebView\nimport android.webkit.WebViewClient\nimport androidx.appcompat.app.AppCompatActivity\nimport androidx.webkit.WebViewAssetLoader\n\n/** Single-activity fullscreen shell hosting the WebView UI from assets/web/app/. */\nclass MainActivity : AppCompatActivity() {\n\n  companion object {\n    const val APP_URL = "https://appassets.androidplatform.net/assets/web/app/index.html"\n    const val ASSET_HANDLER_PREFIX = "/assets/"\n    const val FALLBACK_HTML = "<!doctype html><html><head><meta charset='utf-8'>" +\n      "<meta name='viewport' content='width=device-width,initial-scale=1'>" +\n      "<title>${v.appName} — missing web assets</title></head><body style='font-family:sans-serif;padding:24px;background:#0B0E14;color:#F2EFE6'>" +\n      "<h1>Web UI failed to load</h1>" +\n      "<p>The bundled interface (assets/web/app/index.html) could not be opened. " +\n      "Please install the latest build.</p>" +\n      "</body></html>"\n  }\n\n  lateinit var webView: WebView\n    private set\n\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(savedInstanceState)\n    setContentView(R.layout.activity_main)\n    setupSystemBars()\n    webView = findViewById(R.id.webView)\n    // Dark surface from the first frame: matches --bg-deep so there is no white flash.\n    webView.setBackgroundColor(0xFF0B0E14.toInt())\n    setupWebView()\n    if (savedInstanceState != null) webView.restoreState(savedInstanceState)\n    else webView.loadUrl(APP_URL)\n  }\n\n  private fun setupSystemBars() {\n    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {\n      window.insetsController?.let { controller ->\n        controller.hide(\n          android.view.WindowInsets.Type.statusBars() or\n            android.view.WindowInsets.Type.navigationBars()\n        )\n        controller.systemBarsBehavior =\n          WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE\n      }\n    } else {\n      @Suppress("DEPRECATION")\n      window.decorView.systemUiVisibility = (\n        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY\n          or View.SYSTEM_UI_FLAG_FULLSCREEN\n          or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION\n          or View.SYSTEM_UI_FLAG_LAYOUT_STABLE\n          or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN\n          or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION\n        )\n    }\n    window.statusBarColor = Color.parseColor("#0A0A1A")\n    window.navigationBarColor = Color.parseColor("#0A0A1A")\n  }\n\n  @Suppress("SetJavaScriptEnabled", "AddJavascriptInterface")\n  private fun setupWebView() {\n    webView.settings.apply {\n      javaScriptEnabled = true\n      domStorageEnabled = true\n      allowFileAccess = true\n      allowContentAccess = true\n      mediaPlaybackRequiresUserGesture = false\n      cacheMode = WebSettings.LOAD_DEFAULT\n    }\n    webView.addJavascriptInterface(JsBridge(this), "NativeBridge")\n    val assetLoader = WebViewAssetLoader.Builder()\n      .addPathHandler(ASSET_HANDLER_PREFIX, WebViewAssetLoader.AssetsPathHandler(this))\n      .build()\n    webView.webViewClient = object : WebViewClient() {\n      override fun shouldInterceptRequest(\n        view: WebView,\n        request: WebResourceRequest\n      ): WebResourceResponse? {\n        return assetLoader.shouldInterceptRequest(request.url)\n      }\n      override fun onReceivedError(\n        view: WebView,\n        request: WebResourceRequest,\n        error: WebResourceError\n      ) {\n        if (request.isForMainFrame) view.loadDataWithBaseURL(null, FALLBACK_HTML, "text/html", "utf-8", null)\n      }\n      override fun onPageFinished(view: WebView?, url: String?) {\n        super.onPageFinished(view, url)\n        view?.evaluateJavascript("window.__NATIVE_READY__ = true;", null)\n        view?.evaluateJavascript("if(window.__onNativeReady) window.__onNativeReady();", null)\n      }\n    }\n  }\n\n  override fun onSaveInstanceState(outState: Bundle) {\n    super.onSaveInstanceState(outState)\n    webView.saveState(outState)\n  }\n\n  @Deprecated("Use onBackPressedDispatcher")\n  @Suppress("DEPRECATION")\n  override fun onBackPressed() {\n    if (::webView.isInitialized && webView.canGoBack()) webView.goBack()\n    else super.onBackPressed()\n  }\n\n  override fun onResume() {\n    super.onResume()\n    if (::webView.isInitialized) webView.onResume()\n  }\n\n  override fun onPause() {\n    if (::webView.isInitialized) webView.onPause()\n    super.onPause()\n  }\n\n  override fun onDestroy() {\n    if (::webView.isInitialized) {\n      webView.removeJavascriptInterface("NativeBridge")\n      webView.destroy()\n    }\n    super.onDestroy()\n  }\n}\n`],
    [`app/src/main/java/${pp}/JsBridge.kt`, `package ${v.packageName}\n\nimport android.content.Context\nimport android.webkit.JavascriptInterface\nimport android.widget.Toast\n\nclass JsBridge(private val ctx: Context) {\n  @JavascriptInterface\n  fun toast(msg: String) {\n    Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show()\n  }\n\n  @JavascriptInterface\n  fun appVersion(): String = "${v.versionName}"\n}\n`],
    ["app/src/main/res/layout/activity_main.xml", `<?xml version="1.0" encoding="utf-8"?>\n<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:layout_width="match_parent"\n    android:layout_height="match_parent"\n    android:background="#0A0A1A">\n\n    <WebView\n        android:id="@+id/webView"\n        android:layout_width="match_parent"\n        android:layout_height="match_parent"\n        android:overScrollMode="never" />\n</FrameLayout>\n`],
    ["app/src/main/assets/web/app/.gitkeep", ``],
    ["scripts/fix-asset-paths.sh", `#!/usr/bin/env bash\nset -euo pipefail\n\n# WebView asset-path doctrine (ENFORCED):\n# The Vite build may emit absolute asset URLs (src="/assets/..." href="/assets/...").\n# Under the asset-loader origin those resolve to an unmapped path and the app\n# renders blank. This step rewrites the BUILT web/dist/index.html to relative\n# ./assets/... paths, then FAILS the build if any absolute reference survives.\n# Idempotent: already-relative files pass through unchanged.\n#\n# Usage: bash scripts/fix-asset-paths.sh [dist-dir, default web/dist]\n# Must run AFTER \`npm run build\` and BEFORE scripts/copy-web-to-assets.sh.\n\nROOT="$(cd "$(dirname "$0")/.." && pwd)"\nDIST="\${1:-$ROOT/web/dist}"\nINDEX="$DIST/index.html"\n\nif [ ! -f "$INDEX" ]; then\n  echo "ERROR: built index.html not found at $INDEX (run 'npm run build' in web/ first)." >&2\n  exit 1\nfi\n\nsed -i \\\n  -e 's#src="/assets/#src="./assets/#g' \\\n  -e "s#src='/assets/#src='./assets/#g" \\\n  -e 's#href="/assets/#href="./assets/#g' \\\n  -e "s#href='/assets/#href='./assets/#g" \\\n  "$INDEX"\n\nif grep -Eo '(src|href)="\\/assets\\/[^"]*"' "$INDEX" | grep -q .; then\n  echo "ERROR: absolute /assets/ references remain in $INDEX:" >&2\n  grep -Eo '(src|href)="\\/assets\\/[^"]*"' "$INDEX" >&2\n  exit 1\nfi\n\necho "OK: $INDEX uses relative ./assets/ paths (or has no /assets/ refs)."\n`],
    ["scripts/copy-web-to-assets.sh", `#!/usr/bin/env bash\nset -euo pipefail\n\n# Frozen path contract:\n#   web/dist/* -> android/app/src/main/assets/web/app/\n# MainActivity loads: https://appassets.androidplatform.net/assets/web/app/index.html\n\nROOT="$(cd "$(dirname "$0")/.." && pwd)"\nAPP_DST="$ROOT/android/app/src/main/assets/web/app"\n\nmkdir -p "$APP_DST"\n\nif [ ! -d "$ROOT/web/dist" ]; then\n  echo "ERROR: web/dist not found. Run 'npm run build' in web/ first (CI builds it)." >&2\n  exit 1\nfi\nif [ -z "$(ls -A "$ROOT/web/dist")" ]; then\n  echo "ERROR: web/dist is empty. Run 'npm run build' in web/ first." >&2\n  exit 1\nfi\ncp -r "$ROOT/web/dist/." "$APP_DST/"\n\necho "OK: web/dist -> $APP_DST"\n`],
    ["web/src/tokens.css", `:root {\n  --bg-deep: #08080c;\n  --bg: #0c0c12;\n  --bg-raised: #13131a;\n  --bg-card: #16161f;\n  --bg-hover: #1c1c28;\n  --bg-input: #0e0e16;\n  --border: #1e1e2c;\n  --border-subtle: #151520;\n  --text: #f0f0f5;\n  --text-secondary: #9090a8;\n  --text-muted: #50506a;\n  --text-dim: #3a3a52;\n  --blue: #4f8eff;\n  --blue-glow: rgba(79,142,255,0.15);\n  --blue-soft: rgba(79,142,255,0.08);\n  --indigo: #7c5cff;\n  --indigo-glow: rgba(124,92,255,0.15);\n  --violet: #b06cff;\n  --violet-glow: rgba(176,108,255,0.12);\n  --emerald: #34d399;\n  --emerald-glow: rgba(52,211,153,0.12);\n  --emerald-soft: rgba(52,211,153,0.08);\n  --amber: #fbbf24;\n  --amber-glow: rgba(251,191,36,0.12);\n  --rose: #fb7185;\n  --rose-glow: rgba(251,113,133,0.12);\n  --rose-soft: rgba(251,113,133,0.08);\n  --cyan: #22d3ee;\n  --cyan-glow: rgba(34,211,238,0.12);\n  --orange: #f97316;\n  --success: var(--emerald);\n  --error: var(--rose);\n  --warning: var(--amber);\n  --r: 14px;\n  --r-sm: 10px;\n  --r-xs: 7px;\n  --r-pill: 100px;\n  --font: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;\n  --mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;\n}\n`],
    ["app/src/main/res/values/strings.xml", `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="app_name">${v.appName}</string>\n</resources>\n`],
    ["app/src/main/res/values/colors.xml", `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="primary">#FF1A1A2E</color>\n  <color name="primary_dark">#FF0F0F23</color>\n  <color name="accent">#FF6C63FF</color>\n  <color name="accent_light">#FF8B83FF</color>\n  <color name="surface">#FF16213E</color>\n  <color name="surface_light">#FF1E2D50</color>\n  <color name="on_surface">#FFE8E8E8</color>\n  <color name="on_surface_secondary">#FF9BA3B5</color>\n  <color name="success">#FF00D2FF</color>\n  <color name="warning">#FFFF6B6B</color>\n  <color name="error">#FFFF4757</color>\n  <color name="splash_bg">#FF0F0F23</color>\n</resources>\n`],
    ["app/src/main/res/values/themes.xml", `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <style name="Theme.MT" parent="Theme.MaterialComponents.DayNight.NoActionBar">\n    <item name="colorPrimary">@color/primary</item>\n    <item name="colorPrimaryDark">@color/primary_dark</item>\n    <item name="colorAccent">@color/accent</item>\n    <item name="android:windowBackground">@color/splash_bg</item>\n    <item name="android:statusBarColor">@color/primary_dark</item>\n    <item name="android:navigationBarColor">@color/primary_dark</item>\n    <item name="android:windowLightStatusBar">false</item>\n    <item name="android:windowLightNavigationBar">false</item>\n  </style>\n\n  <style name="Theme.MT.Splash" parent="Theme.MT">\n    <item name="android:windowBackground">@color/splash_bg</item>\n  </style>\n</resources>\n`],
    [".github/workflows/build-web-and-apk.yml", workflowYml()],
    ["web/package.json", `{\n  "name": "web-ui",\n  "private": true,\n  "version": "${v.versionName}",\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build",\n    "preview": "vite preview"\n  }\n}\n`],
    ["web/vite.config.ts", `import { defineConfig } from "vite";\n\n// REQUIRED: base './' so built index.html uses ./assets/ (never /assets/).\nexport default defineConfig({\n  base: "./",\n  build: { outDir: "dist", assetsDir: "assets" },\n});\n`],
    ["web/index.html", `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${v.appName}</title>\n    <!-- TODO: React entry wired by coder/ui-designer. Keep ./assets/ refs only. -->\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="./assets/index.js"></script>\n  </body>\n</html>\n`],
  ];
}

function create(raw: CreateArgs): { created: string[]; skipped: string[]; workflowPath: string } {
  const v = validate(raw);
  if (isNonEmptyDir(v.projectDir) && !v.overwrite) {
    fail(`projectDir non-empty and overwrite=false: ${v.projectDir}`);
  }
  mkdirSync(v.projectDir, { recursive: true });
  const created: string[] = [];
  const skipped: string[] = [];
  for (const [rel, content] of files(v)) {
    const abs = join(v.projectDir, rel);
    if (abs !== resolve(abs) || !resolve(abs).startsWith(v.projectDir + "/")) fail(`path escape: ${rel}`);
    if (existsSync(abs) && !v.overwrite) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    created.push(rel);
  }
  return { created, skipped, workflowPath: ".github/workflows/build-web-and-apk.yml" };
}

// ---------------------------------------------------------------- MCP plumbing
type MCPRequest = { jsonrpc?: string; id?: number | string | null; method?: string; params?: any };

const TOOLS = [
  {
    name: "create_base_project",
    description: "Scaffold MT-pattern Kotlin WebView host base (Theme.MT, immersive bars, asset-loader, bridge, asset scripts, single workflow). Writes only inside projectDir.",
    inputSchema: {
      type: "object",
      required: ["projectDir", "packageName", "appName", "versionName"],
      properties: {
        projectDir: { type: "string", description: "Absolute target dir" },
        packageName: { type: "string", description: "e.g. com.example.app" },
        appName: { type: "string" },
        versionName: { type: "string" },
        versionCode: { type: "integer" },
        minSdk: { type: "integer" },
        targetSdk: { type: "integer" },
        compileSdk: { type: "integer" },
        abiFilters: { type: "array", items: { type: "string" } },
        overwrite: { type: "boolean" },
      },
    },
  },
];

function callTool(name: string, args: any): { text: string; isError: boolean } {
  try {
    if (name !== "create_base_project") return { text: `unknown tool: ${name}`, isError: true };
    const abiFilters =
      args?.abiFilters ?? args?.abi_filters ?? (args?.abi ? String(args.abi).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined);
    const r = create({
      projectDir: args?.projectDir,
      packageName: args?.packageName,
      appName: args?.appName ?? args?.app_name,
      versionName: args?.versionName ?? args?.version,
      versionCode: args?.versionCode,
      minSdk: args?.minSdk ?? args?.min_sdk,
      targetSdk: args?.targetSdk ?? args?.target_sdk,
      compileSdk: args?.compileSdk ?? args?.compile_sdk,
      abiFilters,
      overwrite: args?.overwrite ?? false,
    });
    return { text: JSON.stringify({ ok: true, ...r }, null, 2), isError: false };
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
    if (id === undefined || id === null) return;
    if (method === "initialize") {
      send({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? "2024-11-05", capabilities: { tools: { listChanged: false } }, serverInfo: { name: SERVER_NAME, version: VERSION } } });
    } else if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
    } else if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    } else if (method === "tools/call") {
      const res = callTool(params?.name, params?.arguments);
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: res.text }], isError: res.isError } });
    } else if (method === "resources/list") {
      send({ jsonrpc: "2.0", id, result: { resources: [] } });
    } else if (method === "prompts/list") {
      send({ jsonrpc: "2.0", id, result: { prompts: [] } });
    } else {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
    }
  });
  await new Promise(() => {});
}

function cli(argv: string[]): number {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(k);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const cmd = argv[0];
  if (cmd !== "create") {
    console.log("usage: webapp-base-creator.ts create --projectDir /abs --packageName com.example.app --appName \"Name\" --versionName 1.0.0 [--versionCode 1] [--minSdk 24] [--targetSdk 34] [--compileSdk 34] [--abi arm64-v8a] [--overwrite true|false]");
    return 2;
  }
  const abiRaw = get("--abi") ?? get("--abiFilters") ?? "arm64-v8a";
  try {
    const r = create({
      projectDir: get("--projectDir")!,
      packageName: get("--packageName")!,
      appName: get("--appName")!,
      versionName: get("--versionName")!,
      versionCode: get("--versionCode") ? Number(get("--versionCode")) : 1,
      minSdk: get("--minSdk") ? Number(get("--minSdk")) : 24,
      targetSdk: get("--targetSdk") ? Number(get("--targetSdk")) : 34,
      compileSdk: get("--compileSdk") ? Number(get("--compileSdk")) : 34,
      abiFilters: abiRaw.split(",").map((s) => s.trim()).filter(Boolean),
      overwrite: (get("--overwrite") ?? "false") === "true",
    });
    console.log(JSON.stringify({ ok: true, ...r }, null, 2));
    return 0;
  } catch (e: any) {
    console.error(`error: ${e.message}`);
    return 1;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--mcp") await runMcp();
  else process.exitCode = cli(argv);
}

main();
