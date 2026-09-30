<#
.SYNOPSIS
    DCC Enterprise - Context Menu Debounce Launcher
    Aggregates multi-select Windows Explorer invocations into a single professional DCC Upload Window.
#>

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PassedArgs
)

try {
    $logPath = Join-Path $PSScriptRoot "launcher_debug.log"
    $argsStr = if ($PassedArgs) { $PassedArgs -join "; " } else { "none" }
    $msg = "Launcher started at $(Get-Date -Format 'HH:mm:ss') | Args: $argsStr`r`n"
    [System.IO.File]::AppendAllText($logPath, $msg)
} catch {}

$QueueDir = Join-Path $env:TEMP "DCC_Upload_Queue"
if (-not (Test-Path $QueueDir)) {
    New-Item -ItemType Directory -Path $QueueDir -Force | Out-Null
}

$QueueFile = Join-Path $QueueDir "queue.txt"

# 1. Append all arguments to queue file safely
if ($PassedArgs -and $PassedArgs.Count -gt 0) {
    foreach ($arg in $PassedArgs) {
        if ($arg -and $arg.Trim() -ne "") {
            $clean = $arg.Trim('"').Trim()
            if ($clean -and ([System.IO.File]::Exists($clean) -or [System.IO.Directory]::Exists($clean))) {
                # Append with file share write lock
                try {
                    [System.IO.File]::AppendAllText($QueueFile, "$clean`r`n", [System.Text.Encoding]::UTF8)
                } catch {
                    Start-Sleep -Milliseconds 50
                    [System.IO.File]::AppendAllText($QueueFile, "$clean`r`n", [System.Text.Encoding]::UTF8)
                }
            }
        }
    }
}

# 2. Acquire master mutex
$MutexCreated = $false
$Mutex = $null
try {
    $Mutex = New-Object System.Threading.Mutex($true, "Local\DCC_ContextMenu_Uploader_Master_Mutex", [ref]$MutexCreated)
} catch {
    # If error creating mutex, treat as companion and exit
    exit 0
}

if (-not $MutexCreated) {
    # Another companion process is already the master; exit immediately so master collects all paths!
    exit 0
}

# We are the master process! Wait 400ms for Explorer to finish launching companion processes
Start-Sleep -Milliseconds 450

# 3. Read all collected paths
$AllFiles = @()
if (Test-Path $QueueFile) {
    try {
        $lines = [System.IO.File]::ReadAllLines($QueueFile, [System.Text.Encoding]::UTF8)
        $AllFiles = $lines | Where-Object { $_ -and $_.Trim() -ne "" } | Select-Object -Unique
    } catch {}
}

# 4. Release master mutex
if ($Mutex) {
    try {
        $Mutex.ReleaseMutex()
        $Mutex.Dispose()
    } catch {}
}

# If no files collected, exit
if ($AllFiles.Count -eq 0) {
    Remove-Item -Path $QueueFile -Force -ErrorAction SilentlyContinue
    exit 0
}

# 5. Launch the DCC WPF Upload Window
$GuiScript = Join-Path $PSScriptRoot "..\agents\windows-uploader\DccUploadWindow.ps1"
if (-not (Test-Path $GuiScript)) {
    $GuiScript = Join-Path $PSScriptRoot "DccUploadWindow.ps1"
}
$resolvedGui = (Resolve-Path $GuiScript).Path

# Launch STA mode GUI window
Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -STA -File `"$resolvedGui`" -QueueFile `"$QueueFile`""

