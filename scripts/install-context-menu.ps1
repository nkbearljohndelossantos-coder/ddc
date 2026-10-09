<#
.SYNOPSIS
    Records Management Section (RMS) — Windows Explorer Context Menu & Shortcut Key Installer
    Registers "Upload to Cloud Storage (Records Management Section)" in right-click menus,
    configures SendTo integration, and sets up the Ctrl+Shift+U global shortcut key daemon.
#>

[CmdletBinding()]
param(
    [string]$CustomApiUrl = "http://localhost:4000",
    [switch]$InstallHotKey = $true,
    [switch]$AutoStartWithWindows = $true
)

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   Records Management Section (RMS) — Windows Cloud Uploader v3  " -ForegroundColor Cyan
Write-Host "   Right-Click Menu + Global Shortcut Key (Ctrl+Shift+U) Setup   " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = (Get-Location).Path }
$ExeLauncher = Join-Path $ScriptDir "DccLauncher.exe"
$CsSource = Join-Path $ScriptDir "DccLauncher.cs"
$GuiPath = Join-Path $ScriptDir "..\agents\windows-uploader\DccUploadWindow.ps1"
if (-not (Test-Path $GuiPath)) {
    $GuiPath = Join-Path $ScriptDir "DccUploadWindow.ps1"
}

if (-not (Test-Path $ExeLauncher)) {
    Write-Host "[*] Compiling native silent launcher DccLauncher.exe..." -ForegroundColor Yellow
    $csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    if (Test-Path $csc) {
        & $csc /target:winexe /out:"$ExeLauncher" /r:System.Windows.Forms.dll /r:System.Drawing.dll "$CsSource" | Out-Null
    }
}

$FullExePath = if (Test-Path $ExeLauncher) { (Resolve-Path $ExeLauncher).Path } else { "" }
$LauncherPs1 = Join-Path $ScriptDir "dcc-upload-launcher.ps1"

# Command to execute on right-click
$FileCmd = if ($FullExePath) {
    '"' + $FullExePath + '" "%1"'
} else {
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Resolve-Path $LauncherPs1).Path + '" "%1"'
}

$DirCmd = if ($FullExePath) {
    '"' + $FullExePath + '" "%1"'
} else {
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Resolve-Path $LauncherPs1).Path + '" "%1"'
}

$BgCmd = if ($FullExePath) {
    '"' + $FullExePath + '" "%V"'
} else {
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Resolve-Path $LauncherPs1).Path + '" "%V"'
}

$IcoPath = if (Test-Path (Join-Path $ScriptDir "dcc.ico")) { (Resolve-Path (Join-Path $ScriptDir "dcc.ico")).Path } else { "" }

# 1. Register for All Files (*)
$k1 = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\*\shell\UploadToRMS')
$k1.SetValue('', 'Upload to Cloud Storage (Records Management Section)')
if ($IcoPath) { $k1.SetValue('Icon', $IcoPath) }
$k1c = $k1.CreateSubKey('command')
$k1c.SetValue('', $FileCmd)
$k1c.Close()
$k1.Close()
Write-Host "[OK] Registered Right-Click Menu for All Files -> Upload to Cloud Storage (RMS)" -ForegroundColor Green

# Also keep UploadToDCC key for backward compatibility
try {
    $kOld = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\*\shell\UploadToDCC')
    $kOld.SetValue('', 'Upload to Cloud Storage (Records Management Section)')
    if ($IcoPath) { $kOld.SetValue('Icon', $IcoPath) }
    $kOldc = $kOld.CreateSubKey('command')
    $kOldc.SetValue('', $FileCmd)
    $kOldc.Close()
    $kOld.Close()
} catch {}

# 2. Register for Folders (Directory)
$k2 = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\Directory\shell\UploadToRMS')
$k2.SetValue('', 'Upload Folder to Cloud Storage (Records Management Section)')
if ($IcoPath) { $k2.SetValue('Icon', $IcoPath) }
$k2c = $k2.CreateSubKey('command')
$k2c.SetValue('', $DirCmd)
$k2c.Close()
$k2.Close()
Write-Host "[OK] Registered Right-Click Menu for Folders" -ForegroundColor Green

# 3. Register for Folder Background (Directory\Background)
$k3 = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\Directory\Background\shell\UploadToRMS')
$k3.SetValue('', 'Upload Current Folder to Cloud Storage (Records Management Section)')
if ($IcoPath) { $k3.SetValue('Icon', $IcoPath) }
$k3c = $k3.CreateSubKey('command')
$k3c.SetValue('', $BgCmd)
$k3c.Close()
$k3.Close()
Write-Host "[OK] Registered Right-Click Menu for Directory Background" -ForegroundColor Green

# 4. Create Windows "SendTo" Shortcut (Right-Click -> Send to -> RMS Cloud Storage)
try {
    $sendToDir = [Environment]::GetFolderPath('SendTo')
    if (Test-Path $sendToDir) {
        $wsh = New-Object -ComObject WScript.Shell
        $lnkPath = Join-Path $sendToDir "Upload to Cloud Storage (RMS).lnk"
        $lnk = $wsh.CreateShortcut($lnkPath)
        if ($FullExePath) {
            $lnk.TargetPath = $FullExePath
        } else {
            $lnk.TargetPath = "powershell.exe"
            $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$LauncherPs1`""
        }
        if ($IcoPath) { $lnk.IconLocation = "$IcoPath,0" }
        $lnk.Description = "Upload selected local files to Records Management Section Cloud Storage"
        $lnk.Save()
        Write-Host "[OK] Created Windows 'Send to' Shortcut in $sendToDir" -ForegroundColor Green
    }
} catch {
    Write-Warning "SendTo shortcut creation notice: $($_.Exception.Message)"
}

# 5. Configure Global Shortcut Key Daemon (Ctrl+Shift+U)
$hotKeyDaemonPath = Join-Path $ScriptDir "RMS-HotKey-Daemon.ps1"
if (Test-Path $hotKeyDaemonPath) {
    Write-Host "[OK] Setting up Global Shortcut Key (Ctrl+Shift+U)..." -ForegroundColor Yellow

    if ($AutoStartWithWindows) {
        try {
            $startupDir = [Environment]::GetFolderPath('Startup')
            if (Test-Path $startupDir) {
                $wsh = New-Object -ComObject WScript.Shell
                $startupLnkPath = Join-Path $startupDir "RMS-Cloud-Uploader-HotKey.lnk"
                $startupLnk = $wsh.CreateShortcut($startupLnkPath)
                $startupLnk.TargetPath = "powershell.exe"
                $startupLnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$hotKeyDaemonPath`""
                if ($IcoPath) { $startupLnk.IconLocation = "$IcoPath,0" }
                $startupLnk.Description = "RMS Cloud Uploader Background Hotkey Daemon (Ctrl+Shift+U)"
                $startupLnk.WindowStyle = 7 # Minimized / Hidden
                $startupLnk.Save()
                Write-Host "[OK] Added HotKey Daemon to Windows Startup: $startupLnkPath" -ForegroundColor Green
            }
        } catch {
            Write-Warning "Startup shortcut notice: $($_.Exception.Message)"
        }
    }

    # Start the hotkey daemon now if not already running
    try {
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$hotKeyDaemonPath`""
        Write-Host "[OK] Started RMS HotKey Daemon in background (Press Ctrl+Shift+U anywhere in Windows!)" -ForegroundColor Green
    } catch {}
}

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   Installation Completed Successfully!                          " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "HOW TO UPLOAD FILES FROM LOCAL STORAGE TO CLOUD STORAGE:" -ForegroundColor Yellow
Write-Host "Method 1 (Right-Click):" -ForegroundColor White
Write-Host "  Select any document or folder -> Right-Click -> 'Upload to Cloud Storage (Records Management Section)'" -ForegroundColor Gray
Write-Host "Method 2 (Shortcut Key):" -ForegroundColor White
Write-Host "  Select files in Windows Explorer -> Press Ctrl+Shift+U on your keyboard!" -ForegroundColor Gray
Write-Host "Method 3 (Send To):" -ForegroundColor White
Write-Host "  Right-Click files -> Send to -> 'Upload to Cloud Storage (RMS)'" -ForegroundColor Gray
Write-Host "=================================================================" -ForegroundColor Cyan
