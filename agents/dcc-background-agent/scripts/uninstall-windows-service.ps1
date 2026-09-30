# DCC Background Agent — Windows Background Service Uninstaller
param()

$TaskName = "DCC_Background_Agent"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "[!] Administrator privileges required. Relaunching PowerShell as Administrator..."
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "[*] Stopping $TaskName..." -ForegroundColor Yellow
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1

    Write-Host "[*] Unregistering $TaskName..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "[✔] Service $TaskName uninstalled successfully." -ForegroundColor Green
} else {
    Write-Host "[i] Service $TaskName is not installed." -ForegroundColor Gray
}
