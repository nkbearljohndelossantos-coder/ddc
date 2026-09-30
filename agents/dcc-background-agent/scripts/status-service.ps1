# DCC Background Agent — Windows Service Status & Diagnostics
param()

$TaskName = "DCC_Background_Agent"
$logFile = "C:\DCC\logs\agent.log"
$configFile = "C:\DCC\agent-config.json"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  DCC BACKGROUND AGENT — STATUS & DIAGNOSTICS             " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Service State:   NOT INSTALLED" -ForegroundColor Red
    Write-Host "Run install-windows-service.ps1 to install the service." -ForegroundColor Gray
} else {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    $color = if ($task.State -eq 'Running') { 'Green' } else { 'Yellow' }
    Write-Host "Service State:   $($task.State)" -ForegroundColor $color
    Write-Host "Last Run Time:   $($info.LastRunTime)" -ForegroundColor White
    Write-Host "Last Result:     $($info.LastTaskResult)" -ForegroundColor White
}

if (Test-Path $configFile) {
    Write-Host "`n--- Production Configuration (C:\DCC\agent-config.json) ---" -ForegroundColor Cyan
    Get-Content $configFile | ConvertFrom-Json | Format-List
}

if (Test-Path $logFile) {
    Write-Host "`n--- Recent Activity Logs (Last 10 entries) ---" -ForegroundColor Cyan
    Get-Content $logFile -Tail 10
}
Write-Host "==========================================================" -ForegroundColor Cyan
