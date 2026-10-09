@echo off
title RMS Global HotKey Daemon (Ctrl+Shift+U)
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0RMS-HotKey-Daemon.ps1"
