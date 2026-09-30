<#
.SYNOPSIS
    DCC Enterprise - Windows Explorer Context Menu Installer
    Registers "Upload to DCC" in Windows 10 & 11 Explorer right-click menu.
#>

[CmdletBinding()]
param(
    [string]$CustomApiUrl = "http://localhost:4000"
)

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   DCC Enterprise - Windows Explorer Context Menu Installer      " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

$ScriptDir = $PSScriptRoot
$ExeLauncher = Join-Path $ScriptDir "DccLauncher.exe"
$CsSource = Join-Path $ScriptDir "DccLauncher.cs"
$GuiPath = Join-Path $ScriptDir "..\agents\windows-uploader\DccUploadWindow.ps1"

if (-not (Test-Path $ExeLauncher)) {
    Write-Host "[*] Compiling native silent DccLauncher.exe..." -ForegroundColor Yellow
    $csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    & $csc /target:winexe /out:"$ExeLauncher" /r:System.Windows.Forms.dll /r:System.Drawing.dll "$CsSource" | Out-Null
}

if (-not (Test-Path $GuiPath)) {
    Write-Error "WPF GUI script not found at: $GuiPath"
    exit 1
}

$FullExePath = (Resolve-Path $ExeLauncher).Path
Write-Host "[OK] Using native silent GUI launcher: $FullExePath" -ForegroundColor Green

# Native Windows GUI application - Zero console flash, 100% silent launch
$FileCmd = '"' + $FullExePath + '" "%1"'
$DirCmd  = '"' + $FullExePath + '" "%1"'
$BgCmd   = '"' + $FullExePath + '" "%V"'

$IcoPath = if (Test-Path (Join-Path $ScriptDir "dcc.ico")) { (Resolve-Path (Join-Path $ScriptDir "dcc.ico")).Path } else { $FullExePath }

# 1. Register for All Files (*)
$k1 = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\*\shell\UploadToDCC')
$k1.SetValue('', 'Upload to DCC')
$k1.SetValue('Icon', $IcoPath)
$k1c = $k1.CreateSubKey('command')
$k1c.SetValue('', $FileCmd)
$k1c.Close()
$k1.Close()
Write-Host "[OK] Registered Context Menu for All Files (HKCU\Software\Classes\*\shell\UploadToDCC)" -ForegroundColor Green

# 2. Register for Folders (Directory)
$k2 = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\Directory\shell\UploadToDCC')
$k2.SetValue('', 'Upload to DCC')
$k2.SetValue('Icon', $IcoPath)
$k2c = $k2.CreateSubKey('command')
$k2c.SetValue('', $DirCmd)
$k2c.Close()
$k2.Close()
Write-Host "[OK] Registered Context Menu for Folders (HKCU\Software\Classes\Directory\shell\UploadToDCC)" -ForegroundColor Green

# 3. Register for Folder Background (Directory\Background)
$k3 = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\Directory\Background\shell\UploadToDCC')
$k3.SetValue('', 'Upload this Folder to DCC')
$k3.SetValue('Icon', $IcoPath)
$k3c = $k3.CreateSubKey('command')
$k3c.SetValue('', $BgCmd)
$k3c.Close()
$k3.Close()
Write-Host "[OK] Registered Context Menu for Directory Background (HKCU\Software\Classes\Directory\Background\shell\UploadToDCC)" -ForegroundColor Green

Write-Host ""
Write-Host "Installation Completed Successfully!" -ForegroundColor Cyan
Write-Host "How to use:" -ForegroundColor Yellow
Write-Host "1. In Windows Explorer or Desktop, select any document file, multiple files, or a folder."
Write-Host "2. Right-click and choose 'Upload to DCC'."
Write-Host "3. The DCC Ingest Window will open showing your files, SHA-256 validation, and upload options."
Write-Host "=================================================================" -ForegroundColor Cyan
