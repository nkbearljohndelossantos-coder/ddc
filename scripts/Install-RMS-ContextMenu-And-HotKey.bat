@echo off
title Records Management Section - Windows Cloud Uploader v3 Setup
echo =========================================================================
echo   RECORDS MANAGEMENT SECTION (RMS) - WINDOWS CLOUD UPLOADER v3 SETUP
echo   Enabling Right-Click Context Menu and Shortcut Key (Ctrl+Shift+U)
echo =========================================================================
echo.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-context-menu.ps1"
echo.
echo Setup finished. Press any key to exit.
pause >nul
