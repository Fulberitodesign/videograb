// Prepare les outils embarques dans le logiciel (dossier bin/) pour la plateforme cible :
// yt-dlp (version officielle la plus recente), ffmpeg et ffprobe.
// Variables optionnelles : VG_PLATFORM (win32 | darwin), VG_ARCH (x64 | arm64).
const fs = require("fs");
const path = require("path");
const https = require("https");

const platform = process.env.VG_PLATFORM || process.platform;
const arch = process.env.VG_ARCH || process.arch;
const exe = platform === "win32" ? ".exe" : "";
const out = path.join(__dirname, "..", "bin");

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "videograb-build" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 8) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} pour ${url}`));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    }).on("error", reject);
  });
}

function latestYtdlpTag() {
  return new Promise((resolve, reject) => {
    https.get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest",
      { headers: { "User-Agent": "videograb-build", Accept: "application/vnd.github+json" } }, res => {
        let body = "";
        res.on("data", c => (body += c));
        res.on("end", () => {
          try { resolve(JSON.parse(body).tag_name); } catch (e) { reject(e); }
        });
      }).on("error", reject);
  });
}

(async () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  // ffmpeg : binaire installe par le paquet ffmpeg-static pour cette plateforme / architecture
  const ffmpegSrc = require("ffmpeg-static");
  if (!ffmpegSrc || !fs.existsSync(ffmpegSrc)) throw new Error("ffmpeg-static introuvable (npm install ?)");
  fs.copyFileSync(ffmpegSrc, path.join(out, "ffmpeg" + exe));

  // ffprobe : le paquet ffprobe-static contient toutes les plateformes
  const probeDir = path.dirname(require.resolve("ffprobe-static/package.json"));
  fs.copyFileSync(path.join(probeDir, "bin", platform, arch, "ffprobe" + exe), path.join(out, "ffprobe" + exe));

  // yt-dlp : binaire autonome officiel (aucune installation de Python necessaire)
  const tag = await latestYtdlpTag();
  const asset = platform === "win32" ? "yt-dlp.exe" : "yt-dlp_macos";
  await download(`https://github.com/yt-dlp/yt-dlp/releases/download/${tag}/${asset}`, path.join(out, "yt-dlp" + exe));
  fs.writeFileSync(path.join(out, "yt-dlp.version"), tag);

  if (platform !== "win32") for (const f of fs.readdirSync(out)) fs.chmodSync(path.join(out, f), 0o755);
  console.log(`bin/ pret pour ${platform}-${arch} : yt-dlp ${tag}, ffmpeg, ffprobe`);
})().catch(err => {
  console.error("Echec de la preparation des binaires :", err.message);
  process.exit(1);
});
