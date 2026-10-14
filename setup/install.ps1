param([switch]$Silent)
# Installation de VideoGrab pour l'utilisateur courant (aucun droit administrateur requis).
# Cree par Fulbert Adeniyi. Installation en une ligne (PowerShell) :
#   irm https://raw.githubusercontent.com/Fulberitodesign/videograb/main/setup/install.ps1 | iex

$dest = Join-Path $env:LOCALAPPDATA 'Programs\VideoGrab'

function Step($msg) { Write-Host "`n> $msg" -ForegroundColor Cyan }
function Finish($code) {
    if (-not $Silent) { Read-Host "`nAppuyez sur Entree pour fermer" | Out-Null }
    exit $code
}

Write-Host '=== Installation de VideoGrab ===' -ForegroundColor Magenta
Write-Host 'Cree par Fulbert Adeniyi'

# 0. Fichiers de l'application : dossier du script, sinon telechargement depuis GitHub
$src = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { $null }
if (-not $src -or -not (Test-Path (Join-Path $src 'videograb.py'))) {
    Step 'Telechargement de VideoGrab...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $tmp = Join-Path $env:TEMP ('videograb-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    Invoke-WebRequest 'https://github.com/Fulberitodesign/videograb/archive/refs/heads/main.zip' -OutFile "$tmp\videograb.zip" -UseBasicParsing
    Expand-Archive "$tmp\videograb.zip" $tmp -Force
    $src = Join-Path $tmp 'videograb-main'
}

# 1. Python
$version = $null
try { $version = (& python --version 2>&1) | Out-String } catch {}
if ($LASTEXITCODE -ne 0 -or "$version" -notmatch 'Python 3') {
    Step 'Python est introuvable : installation via winget...'
    winget install -e --id Python.Python.3.13 --scope user --accept-source-agreements --accept-package-agreements
    Write-Host "`nPython est installe. Fermez cette fenetre puis relancez installer.bat." -ForegroundColor Yellow
    Finish 1
}
Write-Host ("Python : " + $version.Trim())

# 2. yt-dlp
Step 'Installation / mise a jour de yt-dlp...'
& python -m pip install --upgrade --quiet --disable-pip-version-check 'yt-dlp[default]'
if ($LASTEXITCODE -ne 0) {
    Write-Host "Echec de l'installation de yt-dlp." -ForegroundColor Red
    Finish 1
}
Write-Host 'yt-dlp : OK'

# 3. ffmpeg
Step 'Verification de ffmpeg...'
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    Write-Host 'ffmpeg : OK'
} else {
    winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
    Write-Host "Si VideoGrab ne trouve pas ffmpeg, redemarrez l'ordinateur." -ForegroundColor Yellow
}

# 4. Copie des fichiers
Step "Copie des fichiers dans $dest"
New-Item -ItemType Directory -Force -Path "$dest\ui", "$dest\setup" | Out-Null
Copy-Item "$src\videograb.py", "$src\LISEZMOI.txt", "$src\desinstaller.bat" $dest -Force
Copy-Item "$src\ui\*" "$dest\ui" -Force
Copy-Item "$src\setup\*" "$dest\setup" -Force

# 5. Raccourcis
Step 'Creation des raccourcis (Bureau + menu Demarrer)'
$pythonw = Join-Path (Split-Path (& python -c "import sys; print(sys.executable)")) 'pythonw.exe'
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
    $lnk = $shell.CreateShortcut((Join-Path $dir 'VideoGrab.lnk'))
    $lnk.TargetPath       = $pythonw
    $lnk.Arguments        = "`"$dest\videograb.py`""
    $lnk.WorkingDirectory = $dest
    $lnk.IconLocation     = "$dest\ui\logo.ico,0"
    $lnk.Description      = 'Telecharger des videos et des extraits pour le montage'
    $lnk.Save()
}

Write-Host "`nVideoGrab est installe ! Lancez-le depuis le Bureau ou le menu Demarrer." -ForegroundColor Green
Finish 0
