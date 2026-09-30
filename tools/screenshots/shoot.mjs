// Takes the README screenshots from a running OnPresence with the demo
// content loaded (docs/demo/demo-content.json). Drives a headless
// Chrome/Edge over the DevTools protocol; needs Node 22+ and no npm packages.
//
//   BASE=http://localhost:8080 ADMIN_USER=admin ADMIN_PASSWORD=... node tools/screenshots/shoot.mjs
//
// Output: docs/images/*.webp
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:8080";
const OUT = resolve(import.meta.dirname, "../../docs/images");
const PORT = 9333;

const BROWSERS = [
  process.env.BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);

// name, path, width, height, admin?, extra wait (ms)
const SHOTS = [
  ["card", "/", 1440, 900, false, 5000],
  ["card-mobile", "/", 390, 844, false, 5000],
  ["vault", "/vault", 1440, 1000, false, 1200],
  ["dashboard-appearance", "/admin/appearance", 1440, 900, true, 5000],
  ["dashboard-vault", "/admin/vault", 1440, 900, true, 1200],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const exe = BROWSERS.find((p) => existsSync(p));
  if (!exe) throw new Error("No Chrome/Edge found; set BROWSER=/path/to/chrome");
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "onpresence-shots-"));
  const proc = spawn(exe, [`--remote-debugging-port=${PORT}`, "--headless=new", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    const cdp = await connect();
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const page = (method, params = {}) => cdp.send(method, params, sessionId);
    await page("Page.enable");
    await page("Runtime.enable");

    let signedIn = false;
    for (const [name, path, width, height, admin, wait] of SHOTS) {
      const mobile = width < 600;
      await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile });
      if (admin && !signedIn) {
        await navigate(page, cdp, `${BASE}/admin`);
        const res = await page("Runtime.evaluate", {
          awaitPromise: true,
          expression: `fetch("/api/v1/auth/login", {method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({username: ${JSON.stringify(process.env.ADMIN_USER ?? "admin")}, password: ${JSON.stringify(process.env.ADMIN_PASSWORD ?? "")}})}).then(r => r.status)`,
        });
        if (res.result.value !== 200) throw new Error(`login failed (${res.result.value}); set ADMIN_PASSWORD`);
        signedIn = true;
      }
      await navigate(page, cdp, BASE + path);
      await sleep(wait);
      const shot = await page("Page.captureScreenshot", { format: "webp", quality: 88 });
      writeFileSync(join(OUT, `${name}.webp`), Buffer.from(shot.data, "base64"));
      console.log("wrote docs/images/" + name + ".webp");
    }
    cdp.close();
  } finally {
    proc.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
  }
}

async function navigate(page, cdp, url) {
  const loaded = cdp.once("Page.loadEventFired");
  await page("Page.navigate", { url });
  await loaded;
  await page("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
}

async function connect() {
  let info;
  for (let i = 0; i < 50 && !info; i++) {
    try {
      info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch {
      await sleep(200);
    }
  }
  if (!info) throw new Error("browser did not start");
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  const waiters = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : ok(msg.result);
    } else if (msg.method && waiters.has(msg.method)) {
      waiters.get(msg.method)();
      waiters.delete(msg.method);
    }
  };
  return {
    send(method, params = {}, sessionId) {
      const msgId = ++id;
      ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
      return new Promise((ok, reject) => pending.set(msgId, { resolve: ok, reject }));
    },
    once(method) {
      return new Promise((ok) => waiters.set(method, ok));
    },
    close: () => ws.close(),
  };
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
