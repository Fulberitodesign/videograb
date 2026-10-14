@echo off
title Installation de VideoGrab
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\install.ps1" %*
