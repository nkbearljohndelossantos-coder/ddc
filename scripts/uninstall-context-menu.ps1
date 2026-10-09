<#
.SYNOPSIS
    Records Management Section (RMS) — Context Menu & HotKey Uninstaller
    Removes Right-Click menu entries, SendTo shortcut, and Startup hotkey cleanly.
#>

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   Records Management Section — Context Menu Uninstaller         " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Remove Registry Keys
$keysToRemove = @(
    'Software\Classes\*\shell\UploadToRMS',
    'Software\Classes\Directory\shell\UploadToRMS',
    'Software\Classes\Directory\Background\shell\UploadToRMS',
    'Software\Classes\*\shell\UploadToDCC',
    'Software\Classes\Directory\shell\UploadToDCC',
    'Software\Classes\Directory\Background\shell\UploadToDCC'
)

foreach ($k in $keysToRemove) {
    try {
        [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($k, $false)
        Write-Host "[OK] Removed Registry Key: HKCU\$k" -ForegroundColor Green
    } catch {}
}

# 2. Remove SendTo Shortcut
try {
    $sendToDir = [Environment]::GetFolderPath('SendTo')
    $lnkPath = Join-Path $sendToDir "Upload to Cloud Storage (RMS).lnk"
    if (Test-Path $lnkPath) {
        Remove-Item -Path $lnkPath -Force
        Write-Host "[OK] Removed SendTo shortcut" -ForegroundColor Green
    }
} catch {}

# 3. Remove Startup Shortcut
try {
    $startupDir = [Environment]::GetFolderPath('Startup')
    $startupLnk = Join-Path $startupDir "RMS-Cloud-Uploader-HotKey.lnk"
    if (Test-Path $startupLnk) {
        Remove-Item -Path $startupLnk -Force
        Write-Host "[OK] Removed Startup HotKey shortcut" -ForegroundColor Green
    }
} catch {}

# 4. Clean temporary queue
$QueueDir = Join-Path $env:TEMP "DCC_Upload_Queue"
if (Test-Path $QueueDir) {
    Remove-Item -Path $QueueDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Uninstallation Complete! Context menus and shortcuts have been removed." -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
