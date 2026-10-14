"""VideoGrab - telechargeur de videos et d'extraits pour le montage (B-roll).
Cree par Fulbert Adeniyi.

Petit serveur local (127.0.0.1) + interface web ouverte dans une fenetre
d'application Edge/Chrome. Telechargement via yt-dlp, decoupe via ffmpeg.
Fonctionne sur Windows et macOS.
"""
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import glob
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import yt_dlp
from yt_dlp.utils import Popen as YtPopen, download_range_func

IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
HOME = os.path.expanduser("~")
HERE = os.path.dirname(os.path.abspath(__file__))
if IS_MAC:
    DATA = os.path.join(HOME, "Library", "Application Support", "VideoGrab")
    # Une app lancee depuis le Finder n'a pas le PATH de Homebrew
    os.environ["PATH"] = os.pathsep.join(["/opt/homebrew/bin", "/usr/local/bin", os.environ.get("PATH", "")])
else:
    DATA = os.path.join(os.environ.get("LOCALAPPDATA", HOME), "VideoGrab")
CONFIG = os.path.join(DATA, "config.json")
UI = os.path.join(HERE, "ui", "index.html")
ASSETS = {"logo.svg": "image/svg+xml", "logo.png": "image/png", "logo.ico": "image/x-icon"}
TOKEN = secrets.token_hex(16)  # protege l'API contre les requetes d'autres sites
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
PYTHON = sys.executable.replace("pythonw.exe", "python.exe")  # version console pour pip / tkinter


def find_ffmpeg():
    """ffmpeg du systeme, sinon celui fourni par le paquet imageio-ffmpeg."""
    if shutil.which("ffmpeg"):
        return None
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


FFMPEG = find_ffmpeg()

try:  # certificats a jour (le Python de python.org sur Mac n'en a pas par defaut)
    import ssl
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = None
settings = {"outdir": os.path.join(HOME, "Movies" if IS_MAC else "Videos", "VideoGrab"), "browser": ""}
jobs = {}
controls = {}       # id -> {"cancel": Event, "procs": [...], "stems": set()}
thread_ctl = {}     # thread id -> controle du telechargement qui tourne dans ce thread
previews = {}
last_ping = time.time()


class Cancelled(Exception):
    pass


# Garde une trace des processus ffmpeg lances par yt-dlp pour pouvoir les arreter.
_popen_init = YtPopen.__init__


def _tracked_popen_init(self, *args, **kwargs):
    _popen_init(self, *args, **kwargs)
    ctl = thread_ctl.get(threading.get_ident())
    if ctl is not None:
        ctl["procs"].append(self)


YtPopen.__init__ = _tracked_popen_init


def load_settings():
    try:
        with open(CONFIG, encoding="utf-8") as f:
            settings.update(json.load(f))
    except (OSError, ValueError):
        pass


def save_settings():
    os.makedirs(DATA, exist_ok=True)
    with open(CONFIG, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)


def clean_error(msg):
    msg = re.sub(r"\x1b\[[0-9;]*m", "", str(msg))
    return re.sub(r"^(ERROR:\s*)?(\[[^\]]+\]\s*)?([\w-]+:\s)?", "", msg).strip()


def ydl_base():
    opts = {"quiet": True, "no_warnings": True, "noplaylist": True}
    if FFMPEG:
        opts["ffmpeg_location"] = FFMPEG
    if settings.get("browser"):
        opts["cookiesfrombrowser"] = (settings["browser"],)
    return opts


def label_time(sec):
    sec = int(sec)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}h{m:02d}m{s:02d}s" if h else f"{m}m{s:02d}s"


# ---------------------------------------------------------------- API
def api_info(b):
    url = (b.get("url") or "").strip()
    if not url:
        raise ValueError("Colle un lien video.")
    with yt_dlp.YoutubeDL(ydl_base()) as ydl:
        info = ydl.extract_info(url, download=False)
    if info.get("_type") == "playlist":
        entries = [e for e in info.get("entries") or [] if e]
        if not entries:
            raise ValueError("Aucune video trouvee a ce lien.")
        info = entries[0]

    # Choix d'un flux lisible directement par le navigateur pour l'apercu
    def playable(f):
        return (f.get("url") and f.get("protocol", "https") in ("http", "https")
                and f.get("vcodec") != "none" and f.get("ext") in ("mp4", "webm")
                and not str(f.get("vcodec") or "").startswith(("hev", "hvc")))

    def score(f):
        h = f.get("height") or 0
        return (f.get("acodec") != "none", h if h <= 720 else 720 - h / 10)

    def register(f):
        token = uuid.uuid4().hex
        previews[token] = (f["url"], f.get("http_headers") or info.get("http_headers") or {})
        return token

    formats = info.get("formats") or [info]
    cands = [f for f in formats if playable(f)]
    token = audio_token = None
    if cands:
        best = max(cands, key=score)
        token = register(best)
        if best.get("acodec") == "none":
            # YouTube ne propose plus de flux image+son : on lit la piste audio a part
            audios = [f for f in formats if f.get("url") and f.get("vcodec") == "none"
                      and f.get("acodec") not in (None, "none")
                      and f.get("protocol", "https") in ("http", "https")
                      and f.get("ext") in ("m4a", "mp4", "webm", "mp3")]
            if audios:
                audio_token = register(max(audios, key=lambda f: (
                    "drc" not in str(f.get("format_id")), f.get("ext") == "m4a", f.get("abr") or 0)))
    return {
        "url": info.get("webpage_url") or url,
        "title": info.get("title") or "Sans titre",
        "uploader": info.get("uploader") or info.get("channel") or info.get("extractor_key") or "",
        "duration": info.get("duration") or 0,
        "thumbnail": info.get("thumbnail") or "",
        "preview": token,
        "preview_audio_track": audio_token,
        "max_height": max([f.get("height") or 0 for f in info.get("formats") or []] or [0]),
    }


def build_opts(b, job):
    q = b.get("quality", "1080")
    clip = b.get("mode") == "clip"
    start = float(b.get("start") or 0)
    end = b.get("end")
    end = float(end) if end not in (None, "") else None

    name = "%(title).90B [%(id)s]"
    if clip:
        name += f" CLIP {label_time(start)}-{label_time(end) if end is not None else 'fin'}"
    os.makedirs(settings["outdir"], exist_ok=True)

    ctl = controls[job["id"]]

    def progress(d):
        if ctl["cancel"].is_set():
            raise Cancelled()
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            job["progress"] = d.get("downloaded_bytes", 0) * 100 / total if total else None
            parts = [(d.get("_percent_str") or "").strip(), (d.get("_speed_str") or "").strip()]
            if d.get("_eta_str"):
                parts.append("reste " + d["_eta_str"].strip())
            job["status"] = " · ".join(p for p in parts if p) or ("Decoupe de l'extrait..." if clip else "Telechargement...")
        elif d["status"] == "finished":
            job["status"] = "Finalisation..."

    def pp(d):
        if ctl["cancel"].is_set():
            raise Cancelled()
        if d["status"] == "started":
            job["status"] = "Finalisation (ffmpeg)..."
            job["progress"] = None
        elif d["status"] == "finished" and d.get("info_dict", {}).get("filepath"):
            job["file"] = d["info_dict"]["filepath"]

    opts = ydl_base()
    opts.update({
        "outtmpl": os.path.join(settings["outdir"], name + ".%(ext)s"),
        "windowsfilenames": True,
        "progress_hooks": [progress],
        "postprocessor_hooks": [pp],
        "concurrent_fragment_downloads": 4,
        "retries": 5,
    })
    if q in ("mp3", "wav"):
        opts["format"] = "ba/b"
        opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": q, "preferredquality": "320"}]
    else:
        lim = f"[height<={q}]" if q.isdigit() else ""
        avc = b.get("h264", True)
        if b.get("mute"):
            opts["format"] = (f"bv*{lim}[vcodec^=avc1]/" if avc else "") + f"bv*{lim}/b{lim}/b"
            opts["postprocessors"] = [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}]
        elif avc:
            opts["format"] = (f"bv*{lim}[vcodec^=avc1]+ba[acodec^=mp4a]/"
                              f"bv*{lim}[vcodec^=avc1]+ba/bv*{lim}+ba/b{lim}/b")
        else:
            opts["format"] = f"bv*{lim}+ba/b{lim}/b"
        opts["merge_output_format"] = "mp4"
    if clip:
        opts["download_ranges"] = download_range_func(None, [(start, end if end is not None else float("inf"))])
        opts["force_keyframes_at_cuts"] = bool(b.get("precise", True))
    return opts


def run_job(job, b):
    ctl = controls[job["id"]]
    thread_ctl[threading.get_ident()] = ctl
    try:
        with yt_dlp.YoutubeDL(build_opts(b, job)) as ydl:
            def remember(info, *, incomplete=False):
                # retient le nom du fichier pour nettoyer les morceaux en cas d'annulation
                ctl["stems"].add(os.path.splitext(ydl.prepare_filename(info))[0])
                if b.get("mode") == "clip":
                    job["status"] = "Decoupe de l'extrait (ffmpeg)..."
                return "Annule" if ctl["cancel"].is_set() else None
            ydl.params["match_filter"] = remember
            ydl.download([b["url"]])
        if ctl["cancel"].is_set():
            raise Cancelled()
        job.update(state="done", progress=100, status="Termine")
    except Exception as e:
        if ctl["cancel"].is_set():
            job.update(state="cancelled", progress=0, status="Annule")
            remove_partials(ctl)
        else:
            job.update(state="error", progress=0, status=clean_error(e))
    finally:
        thread_ctl.pop(threading.get_ident(), None)
        ctl["procs"].clear()


PARTIAL = re.compile(r"(\.part|\.ytdl|\.temp\.|\.f\d+[\w-]*\.\w+$)")


def remove_partials(ctl):
    time.sleep(0.5)  # laisse ffmpeg liberer les fichiers
    for stem in ctl["stems"]:
        for path in glob.glob(glob.escape(stem) + "*"):
            if PARTIAL.search(os.path.basename(path)[len(os.path.basename(stem)):]):
                try:
                    os.remove(path)
                except OSError:
                    pass


def api_cancel(b):
    job, ctl = jobs.get(b.get("id")), controls.get(b.get("id"))
    if job and ctl and job["state"] == "running":
        ctl["cancel"].set()
        job["status"] = "Annulation..."
        for p in list(ctl["procs"]):
            if p.poll() is None:
                p.kill()
    return {}


def api_dismiss(b):
    job = jobs.get(b.get("id"))
    if job and job["state"] != "running":
        jobs.pop(job["id"], None)
        controls.pop(job["id"], None)
    return {}


def api_download(b):
    jid = uuid.uuid4().hex[:8]
    job = {"id": jid, "title": b.get("title") or b["url"], "thumb": b.get("thumbnail") or "",
           "label": b.get("label") or "", "status": "Preparation...", "progress": None,
           "state": "running", "file": None}
    jobs[jid] = job
    controls[jid] = {"cancel": threading.Event(), "procs": [], "stems": set()}
    threading.Thread(target=run_job, args=(job, b), daemon=True).start()
    return {"id": jid}


def api_reveal(b):
    job = jobs.get(b.get("id") or "")
    path = job.get("file") if job else None
    if path and os.path.exists(path):
        if IS_MAC:
            subprocess.Popen(["open", "-R", path])
        else:
            subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
    else:
        os.makedirs(settings["outdir"], exist_ok=True)
        if IS_MAC:
            subprocess.Popen(["open", settings["outdir"]])
        else:
            os.startfile(settings["outdir"])
    return {}


def api_pick_folder(b):
    if IS_MAC:
        script = ('POSIX path of (choose folder with prompt "Dossier de telechargement" '
                  'default location (POSIX file "%s"))' % settings["outdir"].replace('"', ""))
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    else:
        code = ("import tkinter as t,tkinter.filedialog as f,sys;r=t.Tk();r.withdraw();"
                "r.attributes('-topmost',1);sys.stdout.write(f.askdirectory(initialdir=sys.argv[1]) or '')")
        r = subprocess.run([PYTHON, "-c", code, settings["outdir"]], capture_output=True, text=True,
                           creationflags=NO_WINDOW)
    if r.stdout.strip():
        settings["outdir"] = os.path.normpath(r.stdout.strip())
        save_settings()
    return settings


def api_settings(b):
    if "browser" in b:
        settings["browser"] = b["browser"] or ""
        save_settings()
    return settings


def api_update(b):
    r = subprocess.run([PYTHON, "-m", "pip", "install", "-U", "yt-dlp[default]"],
                       capture_output=True, text=True, creationflags=NO_WINDOW)
    if r.returncode:
        raise RuntimeError("Echec de la mise a jour : " + (r.stderr.strip().splitlines() or ["?"])[-1])
    return {"message": "yt-dlp est a jour. Ferme et relance VideoGrab pour l'appliquer."}


def api_ping(b):
    global last_ping
    last_ping = time.time()
    return {}


ROUTES = {"/api/info": api_info, "/api/download": api_download, "/api/reveal": api_reveal,
          "/api/pick-folder": api_pick_folder, "/api/settings": api_settings,
          "/api/update": api_update, "/api/ping": api_ping,
          "/api/cancel": api_cancel, "/api/dismiss": api_dismiss}


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            with open(UI, encoding="utf-8") as f:
                data = f.read().replace("{{TOKEN}}", TOKEN).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        elif path.startswith("/assets/") and path[len("/assets/"):] in ASSETS:
            name = path[len("/assets/"):]
            with open(os.path.join(HERE, "ui", name), "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ASSETS[name])
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "max-age=86400")
            self.end_headers()
            self.wfile.write(data)
        elif path.startswith("/preview/"):
            self.proxy(path[len("/preview/"):])
        elif path == "/api/jobs" and self.headers.get("X-Token") == TOKEN:
            self.send_json(list(jobs.values()))
        elif path == "/api/settings" and self.headers.get("X-Token") == TOKEN:
            self.send_json(settings)
        else:
            self.send_error(404)

    def do_POST(self):
        fn = ROUTES.get(self.path)
        if not fn or self.headers.get("X-Token") != TOKEN:
            return self.send_error(403)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            self.send_json(fn(body))
        except Exception as e:
            self.send_json({"error": clean_error(e)}, 400)

    def proxy(self, token):
        """Relaie le flux video (avec les en-tetes requis par le site) pour l'apercu."""
        src = previews.get(token)
        if not src:
            return self.send_error(404)
        url, headers = src
        headers = dict(headers)
        if self.headers.get("Range"):
            headers["Range"] = self.headers["Range"]
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20, context=SSL_CTX)
        except urllib.error.HTTPError as e:
            r = e
        except OSError:
            return self.send_error(502)
        try:
            self.send_response(r.getcode())
            for k in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
                if r.headers.get(k):
                    self.send_header(k, r.headers[k])
            self.end_headers()
            while chunk := r.read(256 * 1024):
                self.wfile.write(chunk)
        except OSError:
            pass  # le navigateur interrompt souvent la lecture (seek) : normal
        finally:
            r.close()


def find_browser():
    """Navigateur Chromium capable d'ouvrir l'interface en fenetre d'application."""
    if IS_MAC:
        apps = ["Google Chrome.app/Contents/MacOS/Google Chrome",
                "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                "Brave Browser.app/Contents/MacOS/Brave Browser"]
        candidates = [os.path.join(root, a) for a in apps for root in ("/Applications", HOME + "/Applications")]
    else:
        candidates = [os.path.expandvars(p) for p in (
            r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
            r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
            r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
            r"%LocalAppData%\Google\Chrome\Application\chrome.exe")]
    return next((p for p in candidates if os.path.exists(p)), None)


def main():
    load_settings()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    exe = find_browser()
    if exe:
        profile = os.path.join(DATA, "window")
        subprocess.Popen([exe, f"--app={url}", f"--user-data-dir={profile}", "--window-size=1100,900",
                          "--no-first-run", "--no-default-browser-check",
                          "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
                          "--disable-backgrounding-occluded-windows"]).wait()
    else:
        webbrowser.open(url)
    # Reste actif tant que la fenetre envoie des signaux ou qu'un telechargement tourne
    while time.time() - last_ping < 60 or any(j["state"] == "running" for j in jobs.values()):
        time.sleep(2)
    srv.shutdown()


if __name__ == "__main__":
    main()
