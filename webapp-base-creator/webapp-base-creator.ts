#!/usr/bin/env bun
/**
 * webapp-base-creator — bun-based CLI + MCP server (zero deps).
 *
 * Scaffolds the Kotlin WebView host base for webapp-android-builder:
 * Gradle configs, AndroidManifest, MainActivity + JsBridge,
 * assets/www placeholder, MT-theme TODO res values, and the single
 * build-web-and-apk.yml workflow skeleton.
 *
 * Structure is MT-inspired (WebView host + assets/www) but generic:
 * no MT file is copied; theme values are TODO placeholders until the
 * builder inspects the user-confirmed MT source.
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
          node-version: "20"
          cache: npm
          cache-dependency-path: web/package-lock.json

      - name: Build React UI (base './' => ./assets/)
        working-directory: web
        run: |
          npm ci
          npm run build
          test -f dist/index.html || (echo "dist/index.html missing" && exit 1)
          if grep -q 'src="/assets/\\|href="/assets/' dist/index.html; then
            echo "absolute /assets/ refs forbidden (must be ./assets/)" && exit 1
          fi
          grep -q './assets/' dist/index.html || (echo "./assets/ refs not found" && exit 1)

      - name: Move dist into Android assets
        run: |
          rm -rf app/src/main/assets/www/*
          mkdir -p app/src/main/assets/www
          mv web/dist/* app/src/main/assets/www/
          test -f app/src/main/assets/www/index.html || (echo "assets/www/index.html missing" && exit 1)

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"

      - uses: gradle/actions/setup-gradle@v3

      - name: Build APK
        run: chmod +x gradlew && ./gradlew :app:assembleDebug --stacktrace

      - uses: actions/upload-artifact@v4
        with:
          name: app-debug
          path: app/build/outputs/apk/debug/*.apk
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
    ["app/build.gradle.kts", `plugins {\n  id("com.android.application")\n  id("org.jetbrains.kotlin.android")\n}\n\nandroid {\n  namespace = "${v.packageName}"\n  compileSdk = ${v.compileSdk}\n\n  defaultConfig {\n    applicationId = "${v.packageName}"\n    minSdk = ${v.minSdk}\n    targetSdk = ${v.targetSdk}\n    versionCode = ${v.versionCode}\n    versionName = "${v.versionName}"\n    ndk { abiFilters += listOf(${abi}) }\n  }\n\n  buildTypes {\n    release {\n      isMinifyEnabled = false\n    }\n  }\n  compileOptions {\n    sourceCompatibility = JavaVersion.VERSION_17\n    targetCompatibility = JavaVersion.VERSION_17\n  }\n  kotlinOptions { jvmTarget = "17" }\n}\n\ndependencies {\n  implementation("androidx.core:core-ktx:1.13.1")\n  implementation("androidx.appcompat:appcompat:1.7.0")\n}\n`],
    ["app/src/main/AndroidManifest.xml", `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <uses-permission android:name="android.permission.INTERNET" />\n  <application\n    android:label="${v.appName}"\n    android:theme="@style/Theme.WebApp"\n    android:usesCleartextTraffic="false">\n    <activity\n      android:name=".MainActivity"\n      android:exported="true"\n      android:configChanges="orientation|screenSize|keyboardHidden">\n      <intent-filter>\n        <action android:name="android.intent.action.MAIN" />\n        <category android:name="android.intent.category.LAUNCHER" />\n      </intent-filter>\n    </activity>\n  </application>\n</manifest>\n`],
    [`app/src/main/java/${pp}/MainActivity.kt`, `package ${v.packageName}\n\nimport android.annotation.SuppressLint\nimport android.os.Bundle\nimport android.webkit.WebSettings\nimport android.webkit.WebView\nimport android.webkit.WebViewClient\nimport androidx.appcompat.app.AppCompatActivity\n\nclass MainActivity : AppCompatActivity() {\n  private lateinit var web: WebView\n\n  @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(savedInstanceState)\n    web = WebView(this)\n    setContentView(web)\n    web.settings.apply {\n      javaScriptEnabled = true\n      domStorageEnabled = true\n      mediaPlaybackRequiresUserGesture = false\n      cacheMode = WebSettings.LOAD_DEFAULT\n      allowFileAccess = true\n    }\n    web.webViewClient = WebViewClient()\n    web.addJavascriptInterface(JsBridge(this), "NativeBridge")\n    web.loadUrl("file:///android_asset/www/index.html")\n  }\n\n  override fun onBackPressed() {\n    if (::web.isInitialized && web.canGoBack()) web.goBack()\n    else super.onBackPressed()\n  }\n}\n`],
    [`app/src/main/java/${pp}/JsBridge.kt`, `package ${v.packageName}\n\nimport android.content.Context\nimport android.webkit.JavascriptInterface\nimport android.widget.Toast\n\nclass JsBridge(private val ctx: Context) {\n  @JavascriptInterface\n  fun toast(msg: String) {\n    Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show()\n  }\n\n  @JavascriptInterface\n  fun appVersion(): String = "${v.versionName}"\n}\n`],
    ["app/src/main/assets/www/.gitkeep", ``],
    ["app/src/main/res/values/strings.xml", `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="app_name">${v.appName}</string>\n</resources>\n`],
    ["app/src/main/res/values/colors.xml", `<?xml version="1.0" encoding="utf-8"?>\n<!-- TODO(MT-theme): replace with palette from user-confirmed MT source. Do not invent. -->\n<resources>\n  <color name="brand_primary">#6750A4</color>\n  <color name="brand_on_primary">#FFFFFF</color>\n  <color name="brand_surface">#FFFBFE</color>\n</resources>\n`],
    ["app/src/main/res/values/themes.xml", `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <style name="Theme.WebApp" parent="Theme.AppCompat.DayNight.NoActionBar">\n    <!-- TODO(MT-theme): align with inspected MT theme (dark surfaces, accent). -->\n  </style>\n</resources>\n`],
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
    description: "Scaffold Kotlin WebView host base (Gradle, manifest, bridge, assets/www, single workflow). Writes only inside projectDir.",
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
