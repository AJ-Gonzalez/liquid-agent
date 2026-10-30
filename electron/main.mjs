// The desktop shell: starts the same local server the browser version uses,
// then shows its page in a window. Nothing about the app changes — the window
// talks to 127.0.0.1 exactly like a browser tab, token and all — so there is
// only one UI to keep working.

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, settings } from "../server/core.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PREFERRED_PORT = 8170;
const APP_ORIGIN = () => `http://127.0.0.1:${port}`;

/** Permissions the page may ask for; everything else is denied. */
const PERMISSIONS = new Set(["media", "clipboard-read", "clipboard-sanitized-write", "notifications", "fullscreen"]);

let port = PREFERRED_PORT;
let win = null;
let child = null;
let reused = false;
let stopping = false;
let serverLog = [];

app.setName("Liquid Agent");
if (process.platform === "win32") app.setAppUserModelId("app.liquid-agent");

// One window per user: a second launch focuses the first instead of starting a
// second server and fighting over the model ports.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  main();
}

function log(line) {
  serverLog.push(line);
  if (serverLog.length > 120) serverLog.shift();
  process.stdout.write(`${line}\n`);
}

function logServer(text) {
  for (const line of text.split("\n")) if (line.trim()) log(line);
}

// ---- Finding or starting the server ----

async function isLiquid(p) {
  try {
    const res = await fetch(`http://127.0.0.1:${p}/healthz`, { signal: AbortSignal.timeout(400) });
    return res.ok && (await res.json()).app === "liquid-agent";
  } catch {
    return false;
  }
}

function portFree(p) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(p, "127.0.0.1");
  });
}

function randomPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
}

async function choosePort() {
  if (process.env.LIQUID_AGENT_PORT) return Number(process.env.LIQUID_AGENT_PORT);
  if (await isLiquid(PREFERRED_PORT)) return PREFERRED_PORT;
  if (await portFree(PREFERRED_PORT)) return PREFERRED_PORT;
  return randomPort();
}

function startServer(p) {
  const server = path.join(ROOT, "server", "index.js");
  child = spawn(process.execPath, [server], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", LIQUID_AGENT_PORT: String(p) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logServer(String(chunk)));
  child.stderr.on("data", (chunk) => logServer(String(chunk)));
  child.on("error", (error) => log(`server: ${error.message}`));
  child.on("exit", (code) => {
    log(`server: exited (${code ?? "signal"})`);
    if (!stopping && win) {
      dialog.showErrorBox("Liquid Agent stopped", `Its local server quit (${code ?? "signal"}).\n\n${serverLog.slice(-12).join("\n")}`);
    }
  });
}

async function waitForServer(p, timeout = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await isLiquid(p)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function stopServer() {
  if (reused || !child) return Promise.resolve();
  const running = child;
  child = null;
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 4000);
    running.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    running.kill("SIGTERM");
  });
}

// ---- The window ----

function paletteBackground(mode) {
  try {
    const file = path.join(ROOT, "themes", "palettes.json");
    const registry = JSON.parse(fs.readFileSync(file, "utf8"));
    const value = registry.palettes?.[registry.builtin]?.[mode]?.["--app-bg"];
    if (typeof value === "string") return value;
  } catch (error) {
    log(`theme: ${error.message}`);
  }
  return "#ffffff";
}

function createWindow(background) {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: background,
    title: "Liquid Agent",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(HERE, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });
  win.loadURL(APP_ORIGIN());
  return win;
}

function openExternal(url) {
  if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url).catch(() => {});
}

function sameOrigin(url) {
  try {
    return new URL(url).origin === APP_ORIGIN();
  } catch {
    return false;
  }
}

function hardenSession() {
  const allowed = (requestingOrigin) => requestingOrigin === APP_ORIGIN();

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(allowed(originOf(contents?.getURL() ?? "")) && PERMISSIONS.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return allowed(requestingOrigin) && PERMISSIONS.has(permission);
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (sameOrigin(url)) return;
      event.preventDefault();
      openExternal(url);
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  ipcMain.on("theme", (event, theme) => {
    if (!allowed(originOf(event.sender?.getURL() ?? ""))) return;
    if (theme?.source === "light" || theme?.source === "dark" || theme?.source === "system") nativeTheme.themeSource = theme.source;
    if (typeof theme?.background === "string" && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(theme.background)) {
      win?.setBackgroundColor(theme.background);
    }
  });
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

// ---- Lifecycle ----

async function main() {
  await app.whenReady();
  hardenSession();

  port = await choosePort();
  reused = await isLiquid(port);

  nativeTheme.themeSource = settings.theme ?? "system";
  const mode = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  const background = paletteBackground(mode);

  if (!reused) {
    startServer(port);
    const ready = await waitForServer(port);
    if (!ready) {
      dialog.showErrorBox("Liquid Agent couldn't start", `Its local server didn't answer on port ${port}.\n\n${serverLog.slice(-16).join("\n")}`);
      await stopServer();
      app.quit();
      return;
    }
  }

  createWindow(background);

  app.on("activate", () => {
    if (!win) createWindow(paletteBackground(nativeTheme.shouldUseDarkColors ? "dark" : "light"));
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    if (stopping) return;
    stopping = true;
    event.preventDefault();
    stopServer().finally(() => app.quit());
  });
}
