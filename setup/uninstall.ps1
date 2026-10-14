param([switch]$Silent)
# Desinstallation de VideoGrab. Les videos telechargees ne sont pas supprimees.

$dest = Join-Path $env:LOCALAPPDATA 'Programs\VideoGrab'

Write-Host '=== Desinstallation de VideoGrab ===' -ForegroundColor Magenta
if (-not $Silent) {
    $answer = Read-Host 'Supprimer VideoGrab de cet ordinateur ? (O/N)'
    if ($answer -notmatch '^[oOyY]') { exit 0 }
}

# Ferme VideoGrab s'il est ouvert
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" |
    Where-Object { $_.CommandLine -like "*$dest*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

foreach ($dir in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
    Remove-Item (Join-Path $dir 'VideoGrab.lnk') -Force -ErrorAction SilentlyContinue
}
Remove-Item (Join-Path $env:LOCALAPPDATA 'VideoGrab') -Recurse -Force -ErrorAction SilentlyContinue

# Le dossier contient ce script : on le supprime juste apres sa fermeture
Start-Process cmd -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$dest`"" -WindowStyle Hidden

Write-Host "VideoGrab a ete desinstalle. Vos videos (Videos\VideoGrab) sont conservees." -ForegroundColor Green
if (-not $Silent) { Start-Sleep 2 }
