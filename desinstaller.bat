@echo off
title Desinstallation de VideoGrab
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\uninstall.ps1" %*
