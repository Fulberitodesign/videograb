// VideoGrab - logiciel de telechargement de videos et d'extraits pour le montage.
// Cree par Fulbert Adeniyi.
//
// Processus principal Electron : fenetre, telechargements (yt-dlp embarque), conversions
// (ffmpeg embarque) et reglages. L'interface (ui/index.html) l'appelle via window.vg.call().
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, clipboard, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const EXE = IS_WIN ? ".exe" : "";
const APP_ID = "com.fulbertadeniyi.videograb";

const RES_BIN = app.isPackaged ? path.join(process.resourcesPath, "bin") : path.join(__dirname, "bin");
const DATA = app.getPath("userData");
const USER_BIN = path.join(DATA, "bin"); // copie modifiable de yt-dlp (mise a jour avec -U)
const YTDLP = path.join(USER_BIN, "yt-dlp" + EXE);
const FFMPEG = path.join(RES_BIN, "ffmpeg" + EXE);
const FFPROBE = path.join(RES_BIN, "ffprobe" + EXE);
const SETTINGS_FILE = path.join(DATA, "settings.json");
const TMP_ROOT = path.join(app.getPath("temp"), "videograb");

const settings = { outdir: path.join(app.getPath("videos"), "VideoGrab"), browser: "", volume: 1, muted: false };
const jobs = new Map();      // id -> etat visible par l'interface
const controls = new Map();  // id -> { proc, tmp, partial, cancelled }
const previews = new Map();  // jeton -> { url, headers } pour l'apercu
let win = null;

protocol.registerSchemesAsPrivileged([
  { scheme: "vgmedia", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

// ------------------------------------------------------------------ utilitaires
function loadSettings() {
  try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"))); } catch { /* premiere ouverture */ }
}
function saveSettings() {
  const data = { ...settings };
  if (process.env.VG_OUTDIR) delete data.outdir; // un dossier de test n'est jamais enregistre
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

function labelTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s` : `${m}m${String(s).padStart(2, "0")}s`;
}

function cleanError(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const err = [...lines].reverse().find(l => l.startsWith("ERROR:")) || lines[lines.length - 1] || "Erreur inconnue";
  return err.replace(/^ERROR:\s*/, "").replace(/^\[[^\]]+\]\s*/, "").replace(/^[\w-]+:\s(?=\S)/, "");
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* deja supprime */ } }

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (IS_WIN) spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
  else { try { process.kill(-proc.pid, "SIGKILL"); } catch { proc.kill("SIGKILL"); } }
}

function uniquePath(dir, base, ext) {
  let p = path.join(dir, `${base}.${ext}`);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i}).${ext}`);
  return p;
}

// yt-dlp est copie dans les donnees de l'application pour pouvoir se mettre a jour tout seul.
function ensureYtdlp() {
  const bundled = path.join(RES_BIN, "yt-dlp" + EXE);
  const read = f => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return ""; } };
  const bundledVersion = read(path.join(RES_BIN, "yt-dlp.version"));
  const userVersion = read(path.join(USER_BIN, "yt-dlp.version"));
  if (fs.existsSync(YTDLP) && userVersion >= bundledVersion) return;
  fs.mkdirSync(USER_BIN, { recursive: true });
  fs.copyFileSync(bundled, YTDLP);
  fs.writeFileSync(path.join(USER_BIN, "yt-dlp.version"), bundledVersion);
  if (!IS_WIN) {
    fs.chmodSync(YTDLP, 0o755);
    if (IS_MAC) spawn("xattr", ["-d", "com.apple.quarantine", YTDLP]).on("error", () => { });
  }
}

// Lance yt-dlp avec le ffmpeg embarque et le Node d'Electron comme moteur JavaScript (YouTube).
function ytdlp(args) {
  const base = ["--ffmpeg-location", RES_BIN, "--js-runtimes", `node:${process.execPath}`, "--no-playlist", "--encoding", "utf-8"];
  if (settings.browser) base.push("--cookies-from-browser", settings.browser);
  return spawn(YTDLP, [...base, ...args], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    windowsHide: true,
    detached: !IS_WIN,
  });
}

function collect(proc, timeoutMs) {
  return new Promise((resolve, reject) => {
    let out = "", err = "";
    const timer = timeoutMs && setTimeout(() => { killTree(proc); reject(new Error("Le site met trop de temps a repondre.")); }, timeoutMs);
    proc.stdout.on("data", d => (out += d));
    proc.stderr.on("data", d => (err += d));
    proc.on("error", e => { clearTimeout(timer); reject(e); });
    proc.on("close", code => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(cleanError(err || out)));
    });
  });
}

function lineReader(stream, onLine) {
  let buf = "";
  stream.on("data", d => {
    buf += d.toString("utf8");
    const parts = buf.split(/\r?\n|\r/);
    buf = parts.pop();
    parts.forEach(l => l && onLine(l));
  });
  stream.on("end", () => buf && onLine(buf));
}

// ------------------------------------------------------------------ analyse d'un lien
async function apiInfo(b) {
  const url = String(b.url || "").trim();
  if (!url) throw new Error("Colle un lien video.");
  let info = JSON.parse(await collect(ytdlp(["-J", "--no-warnings", url]), 120000));
  if (info._type === "playlist") {
    info = (info.entries || []).find(Boolean);
    if (!info) throw new Error("Aucune video trouvee a ce lien.");
  }

  const formats = info.formats || [info];
  const playable = f => f.url && ["http", "https", undefined].includes(f.protocol) && f.vcodec !== "none"
    && ["mp4", "webm"].includes(f.ext) && !/^(hev|hvc)/.test(String(f.vcodec || ""));
  const score = f => { const h = f.height || 0; return [f.acodec !== "none" ? 1 : 0, h <= 720 ? h : 720 - h / 10]; };
  const better = (a, b) => { const x = score(a), y = score(b); return x[0] !== y[0] ? x[0] > y[0] : x[1] > y[1]; };
  const register = f => {
    const token = crypto.randomBytes(12).toString("hex");
    previews.set(token, { url: f.url, headers: f.http_headers || info.http_headers || {} });
    return token;
  };

  let preview = null, audioTrack = null;
  const cands = formats.filter(playable);
  if (cands.length) {
    const best = cands.reduce((a, c) => (better(c, a) ? c : a));
    preview = register(best);
    if (best.acodec === "none") {
      // YouTube ne propose plus de flux image + son : la piste son est lue a part
      const audios = formats.filter(f => f.url && f.vcodec === "none" && f.acodec && f.acodec !== "none"
        && ["http", "https", undefined].includes(f.protocol) && ["m4a", "mp4", "webm", "mp3"].includes(f.ext));
      const key = f => [String(f.format_id).includes("drc") ? 0 : 1, f.ext === "m4a" ? 1 : 0, f.abr || 0];
      if (audios.length) audioTrack = register(audios.reduce((a, c) => {
        const x = key(c), y = key(a);
        return x[0] !== y[0] ? (x[0] > y[0] ? c : a) : x[1] !== y[1] ? (x[1] > y[1] ? c : a) : x[2] > y[2] ? c : a;
      }));
    }
  }
  return {
    url: info.webpage_url || url,
    title: info.title || "Sans titre",
    uploader: info.uploader || info.channel || info.extractor_key || "",
    duration: info.duration || 0,
    thumbnail: info.thumbnail || "",
    preview,
    preview_audio_track: audioTrack,
    max_height: Math.max(0, ...formats.map(f => f.height || 0)),
  };
}

// ------------------------------------------------------------------ telechargement
function downloadArgs(b, tmp) {
  const q = String(b.quality || "1080");
  const clip = b.mode === "clip";
  const start = Number(b.start) || 0;
  const end = b.end === null || b.end === undefined || b.end === "" ? null : Number(b.end);

  // Le nom indique l'extrait et la qualite : deux versions differentes ne s'ecrasent jamais
  let name = "%(title).90B [%(id)s]";
  if (clip) name += ` CLIP ${labelTime(start)}-${end === null ? "fin" : labelTime(end)}`;
  if (q !== "mp3" && q !== "wav") name += (/^\d+$/.test(q) ? ` ${q}p` : " max") + (b.mute ? " sans son" : "");
  const args = [
    "-P", settings.outdir, "-P", `temp:${tmp}`, "-o", `${name}.%(ext)s`, "--windows-filenames",
    "--retries", "5", "--concurrent-fragments", "4",
    "--quiet", "--progress", "--newline",
    "--progress-template", "download:VGDL %(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress._speed_str)s|%(progress._eta_str)s",
    "--progress-template", "postprocess:VGPP %(progress.status)s|%(progress.postprocessor)s",
    "--print", "after_move:VGFILE %(filepath)s",
  ];

  if (q === "mp3" || q === "wav") {
    // Meilleure piste son, convertie : MP3 320 kb/s constant (sur pour le montage) ou WAV PCM 16 bits,
    // toujours en stereo (un son 5.1 donnerait un clip multicanal peu pratique au montage)
    args.push("-f", "ba/b", "-x", "--audio-format", q, "--postprocessor-args", "ExtractAudio:-ac 2");
    if (q === "mp3") args.push("--audio-quality", "320K");
  } else {
    const lim = /^\d+$/.test(q) ? `[height<=${q}]` : "";
    const avc = b.h264 !== false;
    if (b.mute) {
      args.push("-f", (avc ? `bv*${lim}[vcodec^=avc1]/` : "") + `bv*${lim}/b${lim}/b`, "--remux-video", "mp4");
    } else {
      args.push("-f", avc
        ? `bv*${lim}[vcodec^=avc1]+ba[acodec^=mp4a]/bv*${lim}[vcodec^=avc1]+ba/bv*${lim}+ba/b${lim}/b`
        : `bv*${lim}+ba/b${lim}/b`, "--merge-output-format", "mp4");
    }
  }
  if (clip) {
    args.push("--download-sections", `*${start}-${end === null ? "inf" : end}`);
    if (b.precise !== false) args.push("--force-keyframes-at-cuts");
  }
  args.push(String(b.url));
  return args;
}

const PP_LABELS = {
  ExtractAudio: q => `Conversion en ${q.toUpperCase()}...`,
  Merger: () => "Assemblage image + son...",
  VideoRemuxer: () => "Conversion en MP4...",
  FFmpegVideoRemuxer: () => "Conversion en MP4...",
  MoveFiles: () => "Finalisation...",
};

function apiDownload(b) {
  const id = crypto.randomBytes(4).toString("hex");
  const clip = b.mode === "clip";
  const job = {
    id, title: b.title || b.url, thumb: b.thumbnail || "", label: b.label || "",
    status: clip ? "Decoupe de l'extrait..." : "Preparation...", progress: null, state: "running", file: null,
  };
  jobs.set(id, job);
  fs.mkdirSync(settings.outdir, { recursive: true });
  const tmp = path.join(TMP_ROOT, id);
  fs.mkdirSync(tmp, { recursive: true });

  const proc = ytdlp(downloadArgs(b, tmp));
  const ctl = { proc, tmp, cancelled: false };
  controls.set(id, ctl);
  let stderr = "";

  lineReader(proc.stdout, line => {
    if (line.startsWith("VGDL ")) {
      const [status, done, total, estimate, speed, eta] = line.slice(5).split("|");
      const size = Number(total) || Number(estimate);
      if (status === "downloading") {
        job.progress = size ? Math.min(100, (Number(done) * 100) / size) : null;
        const parts = [];
        if (job.progress !== null) parts.push(`${job.progress.toFixed(0)} %`);
        if (speed && speed !== "NA") parts.push(speed.trim());
        if (eta && eta !== "NA") parts.push(`reste ${eta.trim()}`);
        job.status = parts.join(" · ") || (clip ? "Decoupe de l'extrait..." : "Telechargement...");
      } else if (status === "finished") {
        job.progress = null;
        job.status = "Finalisation...";
      }
    } else if (line.startsWith("VGPP ")) {
      const [status, pp] = line.slice(5).split("|");
      if (status === "started" && PP_LABELS[pp]) { job.progress = null; job.status = PP_LABELS[pp](String(b.quality)); }
    } else if (line.startsWith("VGFILE ")) {
      job.file = line.slice(7).trim().replace(/^\\\\\?\\/, ""); // retire le prefixe Windows des chemins longs
    }
  });
  proc.stderr.on("data", d => (stderr += d));

  proc.on("error", e => { job.state = "error"; job.status = e.message; });
  proc.on("close", code => {
    if (ctl.cancelled) Object.assign(job, { state: "cancelled", progress: 0, status: "Annule" });
    else if (code === 0 && job.file && fs.existsSync(job.file)) Object.assign(job, { state: "done", progress: 100, status: "Termine" });
    else Object.assign(job, { state: "error", progress: 0, status: cleanError(stderr || "Le telechargement a echoue.") });
    controls.delete(id);
    setTimeout(() => rmrf(tmp), 500);
  });
  return { id };
}

// ------------------------------------------------------------------ conversion d'une video (MP4...) en MP3 haute qualite
function probe(file) {
  return new Promise(resolve => {
    const p = spawn(FFPROBE, ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file], { windowsHide: true });
    let out = "";
    p.stdout.on("data", d => (out += d));
    p.on("error", () => resolve(null));
    p.on("close", () => { try { resolve(JSON.parse(out)); } catch { resolve(null); } });
  });
}

async function apiConvert(b) {
  const input = String(b.path || "");
  const format = "mp3";
  if (!input || !fs.existsSync(input)) throw new Error("Fichier introuvable.");
  const info = await probe(input);
  if (!info) throw new Error("Ce fichier n'est pas une video ou un son lisible.");
  if (!(info.streams || []).some(s => s.codec_type === "audio")) throw new Error("Ce fichier ne contient pas de son.");
  const duration = Number(info.format && info.format.duration) || 0;

  fs.mkdirSync(settings.outdir, { recursive: true });
  const base = path.parse(input).name;
  const output = uniquePath(settings.outdir, base, format);
  const partial = output + ".part";
  const id = crypto.randomBytes(4).toString("hex");
  const job = {
    id, title: path.basename(input), thumb: "logo.png", label: "MP3 haute qualité 320 kb/s",
    status: "Conversion...", progress: duration ? 0 : null, state: "running", file: null,
  };
  jobs.set(id, job);

  // MP3 haute qualite : 320 kb/s constant (le plus sur pour le montage), meilleur algorithme LAME,
  // frequence d'origine conservee, titre / artiste recopies dans les tags ID3
  const codec = ["-ac", "2", "-c:a", "libmp3lame", "-b:a", "320k", "-compression_level", "0",
    "-map_metadata", "0", "-id3v2_version", "3", "-f", "mp3"];
  const proc = spawn(FFMPEG, ["-y", "-hide_banner", "-nostdin", "-i", input, "-vn", "-map", "0:a:0", ...codec,
    "-progress", "pipe:1", "-nostats", partial], { windowsHide: true, detached: !IS_WIN });
  const ctl = { proc, cancelled: false };
  controls.set(id, ctl);
  let stderr = "";
  lineReader(proc.stdout, line => {
    const m = /^out_time_us=(\d+)/.exec(line);
    if (m && duration) {
      job.progress = Math.min(99, Number(m[1]) / 1e4 / duration);
      job.status = `${job.progress.toFixed(0)} %`;
    }
  });
  proc.stderr.on("data", d => (stderr += d));
  proc.on("close", code => {
    controls.delete(id);
    if (ctl.cancelled || code !== 0) {
      rmrf(partial);
      Object.assign(job, ctl.cancelled
        ? { state: "cancelled", progress: 0, status: "Annule" }
        : { state: "error", progress: 0, status: "Conversion impossible : " + (stderr.trim().split(/\r?\n/).pop() || "erreur ffmpeg") });
      return;
    }
    fs.renameSync(partial, output);
    Object.assign(job, { state: "done", progress: 100, status: "Termine", file: output });
  });
  return { id };
}

// ------------------------------------------------------------------ autres actions
function apiCancel(b) {
  const job = jobs.get(b.id), ctl = controls.get(b.id);
  if (job && ctl && job.state === "running") {
    ctl.cancelled = true;
    job.status = "Annulation...";
    killTree(ctl.proc);
  }
  return {};
}

function apiDismiss(b) {
  const job = jobs.get(b.id);
  if (job && job.state !== "running") jobs.delete(b.id);
  return {};
}

async function apiReveal(b) {
  const job = jobs.get(b.id || "");
  if (job && job.file && fs.existsSync(job.file)) shell.showItemInFolder(job.file);
  else { fs.mkdirSync(settings.outdir, { recursive: true }); await shell.openPath(settings.outdir); }
  return {};
}

async function apiPickFolder() {
  const r = await dialog.showOpenDialog(win, {
    title: "Dossier de telechargement", defaultPath: settings.outdir, properties: ["openDirectory", "createDirectory"],
  });
  if (!r.canceled && r.filePaths[0]) { settings.outdir = r.filePaths[0]; saveSettings(); }
  return settings;
}

async function apiPickFile() {
  const r = await dialog.showOpenDialog(win, {
    title: "Video a convertir en MP3 haute qualite", properties: ["openFile"],
    filters: [
      { name: "Videos (MP4, MOV...)", extensions: ["mp4", "m4v", "mov", "mkv", "avi", "webm", "mxf", "wmv", "flv", "mts", "m2ts"] },
      { name: "Tous les fichiers", extensions: ["*"] },
    ],
  });
  return { path: r.canceled ? null : r.filePaths[0] };
}

function apiSettings(b = {}) {
  if ("browser" in b) settings.browser = b.browser || "";
  if ("volume" in b) { settings.volume = Math.min(1, Math.max(0, Number(b.volume) || 0)); settings.muted = !!b.muted; }
  if ("browser" in b || "volume" in b) saveSettings();
  return settings;
}

async function apiUpdate() {
  const out = await collect(spawn(YTDLP, ["-U"], { windowsHide: true }), 180000);
  const m = /yt-dlp is up to date \(([^)]+)\)|Updated yt-dlp to ([^\s]+)/i.exec(out);
  const version = m ? (m[1] || m[2]).replace(/^stable@/, "") : "";
  if (version) fs.writeFileSync(path.join(USER_BIN, "yt-dlp.version"), version.split(" ")[0]);
  return { message: /up to date/i.test(out) ? `yt-dlp est deja a jour${version ? ` (${version})` : ""}.` : "yt-dlp a ete mis a jour." };
}

function apiAbout() {
  let ytdlpVersion = "";
  try { ytdlpVersion = fs.readFileSync(path.join(USER_BIN, "yt-dlp.version"), "utf8").trim(); } catch { /* inconnu */ }
  return { version: app.getVersion(), ytdlp: ytdlpVersion, platform: process.platform };
}

const ROUTES = {
  "/api/info": apiInfo,
  "/api/download": apiDownload,
  "/api/convert": apiConvert,
  "/api/cancel": apiCancel,
  "/api/dismiss": apiDismiss,
  "/api/reveal": apiReveal,
  "/api/pick-folder": apiPickFolder,
  "/api/pick-file": apiPickFile,
  "/api/settings": apiSettings,
  "/api/update": apiUpdate,
  "/api/about": apiAbout,
  "/api/jobs": () => [...jobs.values()],
  "/api/clipboard": () => ({ text: clipboard.readText() }),
  "/api/ping": () => ({}),
};

// ------------------------------------------------------------------ fenetre
function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 920, minWidth: 720, minHeight: 600,
    title: "VideoGrab",
    backgroundColor: "#07070e",
    icon: path.join(__dirname, "ui", "logo.png"),
    show: false,
    titleBarStyle: "hidden",
    ...(IS_MAC
      ? { trafficLightPosition: { x: 16, y: 14 } }
      : { titleBarOverlay: { color: "#07070e", symbolColor: "#f3f4fa", height: 38 } }),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, devTools: !app.isPackaged },
  });
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "ui", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", e => e.preventDefault()); // un fichier glisse ne doit pas remplacer l'interface

  win.on("close", e => {
    const running = [...jobs.values()].filter(j => j.state === "running").length;
    if (!running) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: "question", buttons: ["Quitter quand meme", "Rester"], defaultId: 1, cancelId: 1,
      title: "VideoGrab", message: `${running} telechargement(s) en cours.`, detail: "Ils seront annules si vous quittez.",
    });
    if (choice === 1) e.preventDefault();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(() => {
    if (IS_WIN) app.setAppUserModelId(APP_ID);
    if (!IS_MAC) Menu.setApplicationMenu(null);
    loadSettings();
    if (process.env.VG_OUTDIR) settings.outdir = process.env.VG_OUTDIR; // dossier de sortie pour les tests
    ensureYtdlp();
    rmrf(TMP_ROOT); // morceaux laisses par une session interrompue

    // Apercu : relaie le flux video avec les en-tetes exiges par le site
    protocol.handle("vgmedia", req => {
      const token = new URL(req.url).pathname.replace(/^\//, "");
      const src = previews.get(token);
      if (!src) return new Response("introuvable", { status: 404 });
      const headers = { ...src.headers };
      const range = req.headers.get("range");
      if (range) headers.Range = range;
      return net.fetch(src.url, { headers });
    });

    ipcMain.handle("api", async (_e, route, body) => {
      const fn = ROUTES[route];
      if (!fn) throw new Error("Action inconnue : " + route);
      return fn(body || {});
    });

    createWindow();
    app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    for (const ctl of controls.values()) { ctl.cancelled = true; killTree(ctl.proc); }
  });
}
