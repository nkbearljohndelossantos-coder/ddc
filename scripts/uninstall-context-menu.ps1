<#
.SYNOPSIS
    DCC Enterprise - Windows Explorer Context Menu Uninstaller
    Removes "Upload to DCC" from Windows 10 & 11 Explorer right-click menu cleanly.
#>

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   DCC Enterprise - Context Menu Uninstaller                     " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Remove Registry Keys using .NET Registry API
try {
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('Software\Classes\*\shell\UploadToDCC', $false)
    Write-Host "[OK] Removed Context Menu for All Files" -ForegroundColor Green
} catch {
    Write-Warning "Files key removal notice: $($_.Exception.Message)"
}

try {
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('Software\Classes\Directory\shell\UploadToDCC', $false)
    Write-Host "[OK] Removed Context Menu for Folders" -ForegroundColor Green
} catch {
    Write-Warning "Directory key removal notice: $($_.Exception.Message)"
}

try {
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('Software\Classes\Directory\Background\shell\UploadToDCC', $false)
    Write-Host "[OK] Removed Context Menu for Directory Background" -ForegroundColor Green
} catch {
    Write-Warning "Directory Background key removal notice: $($_.Exception.Message)"
}

# 2. Clean temporary queue if present
$QueueDir = Join-Path $env:TEMP "DCC_Upload_Queue"
if (Test-Path $QueueDir) {
    Remove-Item -Path $QueueDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Cleaned temporary queue directory: $QueueDir" -ForegroundColor Green
}

Write-Host ""
Write-Host "Uninstallation Complete! 'Upload to DCC' context menu entries have been removed." -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
