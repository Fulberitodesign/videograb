<p align="center"><img src="ui/logo.svg" width="96" alt="Logo VideoGrab"></p>

<h1 align="center">VideoGrab</h1>

<p align="center">Téléchargez une vidéo complète ou <b>juste l'extrait</b> dont votre montage a besoin.<br>
YouTube, TikTok, Instagram, Vimeo, X et plus de 1000 sites · MP4 H.264 prêt pour le montage · Windows et macOS</p>

<p align="center"><i>Créé par <b>Fulbert Adeniyi</b></i></p>

<p align="center"><a href="https://videograb-fulbert.netlify.app/">Site</a> · <a href="https://github.com/Fulberitodesign/videograb/archive/refs/heads/main.zip">Télécharger</a></p>

---

## Fonctions

- **Extraits précis** : choisissez le début et la fin sur une timeline, en tapant les temps ou avec les touches `I` / `O`. Seul ce passage est téléchargé, coupé à l'image près.
- **Aperçu avec le son** et lecture de l'extrait en boucle avant de télécharger.
- **Prêt pour le montage** : MP4 H.264 + AAC par défaut (Premiere Pro, DaVinci Resolve, Final Cut, CapCut).
- **Qualité au choix** : 480p à 4K, vidéo sans le son (B-roll), audio seul MP3 / WAV.
- **Annulation** des téléchargements en cours, fichiers partiels supprimés.
- **100 % local** : aucun compte, rien n'est envoyé ailleurs.

## Raccourcis clavier

| Touche | Action |
|---|---|
| `Espace` | Lecture / pause |
| `I` / `O` | Début / fin de l'extrait à la position de lecture |
| `P` | Lire l'extrait en boucle |
| `←` `→` | ±1 s (`Maj` : ±5 s) |
| `,` `.` | Image précédente / suivante |
| `M` | Couper / remettre le son |

## Installation

### Windows 10 / 11
1. [Téléchargez le ZIP](https://github.com/Fulberitodesign/videograb/archive/refs/heads/main.zip) et décompressez-le.
2. Double-cliquez sur `installer.bat`. Il installe Python, yt-dlp et FFmpeg si besoin, copie l'application dans `%LOCALAPPDATA%\Programs\VideoGrab` et crée les raccourcis (Bureau + menu Démarrer).
3. Lancez **VideoGrab** depuis le raccourci.

Ou en une ligne dans PowerShell :
```powershell
irm https://raw.githubusercontent.com/Fulberitodesign/videograb/main/setup/install.ps1 | iex
```
Désinstaller : `desinstaller.bat` dans le dossier d'installation.

### macOS 11+ (puce Apple ou Intel)
Dans le Terminal :
```bash
curl -fsSL https://raw.githubusercontent.com/Fulberitodesign/videograb/main/setup/install-mac.sh | bash
```
L'application **VideoGrab.app** est créée dans `~/Applications` avec son icône. Python 3.10+ est requis (installé via Homebrew si disponible, sinon la page python.org s'ouvre). FFmpeg est installé via Homebrew ou, à défaut, fourni par `imageio-ffmpeg`.

Ou depuis le ZIP : clic droit sur `installer-mac.command` → Ouvrir.
Désinstaller : `~/Applications/VideoGrab.app/Contents/Resources/uninstall-mac.sh`.

Vos vidéos téléchargées sont toujours conservées.

## Fonctionnement

`videograb.py` démarre un petit serveur local (`127.0.0.1`, protégé par un jeton) et ouvre l'interface (`ui/index.html`) dans une fenêtre d'application Edge ou Chrome. Les téléchargements utilisent [yt-dlp](https://github.com/yt-dlp/yt-dlp) et [FFmpeg](https://ffmpeg.org).

Le site de présentation se trouve dans `docs/` (Netlify : https://videograb-fulbert.netlify.app).

## Droits

Ne téléchargez que des contenus que vous avez le droit d'utiliser : vos propres vidéos, des contenus sous licence libre ou avec l'accord de l'auteur. Respectez les conditions d'utilisation des plateformes. VideoGrab n'est affilié à aucune d'entre elles.

## Licence

[MIT](LICENSE) — © 2026 Fulbert Adeniyi
