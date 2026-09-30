# DCC Background Agent — Windows Background Service Installer
# Registers the DCC Background Agent as a native Windows Startup Service / Task
# Runs under SYSTEM privileges, starts automatically with Windows boot, and runs without user login or open browser.

param(
    [string]$ApiUrl = "http://localhost:4000/api/v1",
    [string]$AgentToken = "dcc-enterprise-agent-default-secret",
    [string]$WatchFolder = "C:\DCC\Incoming",
    [string]$ProcessedFolder = "C:\DCC\Processed",
    [string]$FailedFolder = "C:\DCC\Failed"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  DCC BACKGROUND AGENT — WINDOWS PRODUCTION INSTALLER     " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Check Administrator Privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "[!] Administrator privileges required. Relaunching PowerShell as Administrator..."
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ApiUrl `"$ApiUrl`" -AgentToken `"$AgentToken`""
    exit
}

# 2. Check Node.js
$nodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    Write-Error "[X] Node.js is not found in system PATH. Please install Node.js (LTS) before installing the DCC Agent service."
    exit 1
}
Write-Host "[✔] Detected Node.js at: $nodePath" -ForegroundColor Green

# 3. Locate compiled agent script
$agentRootDir = Split-Path -Parent $PSScriptRoot
$daemonScript = Join-Path $agentRootDir "dist\daemon.js"

if (-not (Test-Path $daemonScript)) {
    Write-Host "[*] Compiling TypeScript source to JavaScript..." -ForegroundColor Yellow
    Push-Location $agentRootDir
    & npm run build
    Pop-Location
}

if (-not (Test-Path $daemonScript)) {
    Write-Error "[X] Could not find compiled agent at $daemonScript. Please run 'npm run build' in $agentRootDir."
    exit 1
}
Write-Host "[✔] Detected compiled agent daemon: $daemonScript" -ForegroundColor Green

# 4. Prepare Directories
$baseDccDir = "C:\DCC"
$logDir = Join-Path $baseDccDir "logs"
$dataDir = Join-Path $baseDccDir "data"

@($baseDccDir, $WatchFolder, $ProcessedFolder, $FailedFolder, $logDir, $dataDir) | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ -Force | Out-Null
        Write-Host "[✔] Created folder: $_" -ForegroundColor Gray
    }
}

# 5. Write Production Configuration File (C:\DCC\agent-config.json)
$configFile = Join-Path $baseDccDir "agent-config.json"
$configData = @{
    apiUrl = $ApiUrl
    agentId = "agent-$($env:COMPUTERNAME.ToLower())"
    agentName = "DCC-Agent-$($env:COMPUTERNAME)"
    authToken = $AgentToken
    watchFolder = $WatchFolder
    processedFolder = $ProcessedFolder
    failedFolder = $FailedFolder
    logFolder = $logDir
    queueFilePath = (Join-Path $dataDir "agent-queue.json")
    pollIntervalMs = 3000
    heartbeatIntervalMs = 10000
    maxRetries = 5
}
$configData | ConvertTo-Json -Depth 4 | Set-Content -Path $configFile -Encoding UTF8
Write-Host "[✔] Production configuration saved to: $configFile" -ForegroundColor Green

# 6. Register Windows Scheduled Service (Runs at Startup with SYSTEM / Highest Privileges)
$TaskName = "DCC_Background_Agent"

# Unregister if already present
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[*] Updating existing task $TaskName..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
    -Execute $nodePath `
    -Argument "`"$daemonScript`"" `
    -WorkingDirectory $agentRootDir

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -Priority 4

# Run with SYSTEM privileges so it starts at boot before any user login and without open browser
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -User "NT AUTHORITY\SYSTEM" `
    -RunLevel Highest | Out-Null

Write-Host "[✔] Windows Background Service registered as: $TaskName (Trigger: AtStartup, RunLevel: Highest)" -ForegroundColor Green

# 7. Start the Service Now
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

$taskState = (Get-ScheduledTask -TaskName $TaskName).State
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  INSTALLATION SUCCESSFUL!                                 " -ForegroundColor Green
Write-Host "  Service Name:    $TaskName                               " -ForegroundColor White
Write-Host "  Current State:   $taskState                              " -ForegroundColor White
Write-Host "  Watch Folder:    $WatchFolder                            " -ForegroundColor White
Write-Host "  Log File:        $logDir\agent.log                       " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "The DCC Background Agent will now run 24/7 in the background." -ForegroundColor White
Write-Host "It will automatically start whenever Windows boots, with no browser required." -ForegroundColor White
