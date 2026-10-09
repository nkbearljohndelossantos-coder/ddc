<#
.SYNOPSIS
    Records Management Section (RMS) — Global Windows Shortcut Key Daemon
    Listens for Ctrl+Shift+U globally in Windows.
    When triggered, inspects the active Windows Explorer window, extracts selected files from Local Storage,
    and opens the Cloud Uploader with Smart Auto-Tagging.
#>

param(
    [string]$TargetApiUrl = "http://localhost:4000",
    [switch]$RunInBackground = $false
)

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

# Win32 APIs for Global Hotkey Registration & Window Inspection
$win32Source = @"
using System;
using System.Runtime.InteropServices;

public class Win32HotKey {
    [DllImport("user32.dll")]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll")]
    public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("Kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
Add-Type -TypeDefinition $win32Source -ErrorAction SilentlyContinue

# Hide console window if running in background
try {
    $cPtr = [Win32HotKey]::GetConsoleWindow()
    if ($cPtr -ne [IntPtr]::Zero) {
        [Win32HotKey]::ShowWindow($cPtr, 0) | Out-Null
    }
} catch {}

# Hotkey Constants: MOD_CONTROL (0x0002) + MOD_SHIFT (0x0004) = 0x0006; 'U' = 0x55 (85)
$MOD_CTRL_SHIFT = 0x0006
$VK_U = 0x55
$HOTKEY_ID = 9527
$WM_HOTKEY = 0x0312

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = (Get-Location).Path }
$LauncherPs1 = Join-Path $ScriptDir "dcc-upload-launcher.ps1"
$GuiPs1 = Join-Path $ScriptDir "..\agents\windows-uploader\DccUploadWindow.ps1"
if (-not (Test-Path $GuiPs1)) {
    $GuiPs1 = Join-Path $ScriptDir "DccUploadWindow.ps1"
}

# Function: Extract selected items from active Windows Explorer window
function Get-ActiveExplorerSelectedFiles {
    $selected = [System.Collections.Generic.List[string]]::new()
    try {
        $fgHwnd = [Win32HotKey]::GetForegroundWindow()
        $shell = New-Object -ComObject Shell.Application
        $windows = $shell.Windows()

        foreach ($win in $windows) {
            if ($win -and $win.HWND -eq $fgHwnd) {
                $doc = $win.Document
                if ($doc) {
                    $items = $doc.SelectedItems()
                    if ($items -and $items.Count -gt 0) {
                        for ($i = 0; $i -lt $items.Count; $i++) {
                            $item = $items.Item($i)
                            if ($item -and $item.Path) {
                                $selected.Add($item.Path)
                            }
                        }
                    }
                }
                break
            }
        }
    } catch {}
    return $selected
}

# Form class that handles WM_HOTKEY
$form = New-Object System.Windows.Forms.Form
$form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
$form.ShowInTaskbar = $false
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.Size = New-Object System.Drawing.Size(1, 1)

# System Tray Notification Icon
$trayIcon = New-Object System.Windows.Forms.NotifyIcon
$icoPath = Join-Path $ScriptDir "dcc.ico"
if (Test-Path $icoPath) {
    $trayIcon.Icon = New-Object System.Drawing.Icon($icoPath)
} else {
    $trayIcon.Icon = [System.Drawing.SystemIcons]::Application
}
$trayIcon.Text = "RMS Windows Cloud Uploader (HotKey: Ctrl+Shift+U)"
$trayIcon.Visible = $true

# Context menu for tray icon
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$itemStatus = $contextMenu.Items.Add("Records Management Section — Uploader")
$itemStatus.Enabled = $false
$contextMenu.Items.Add("-") | Out-Null
$itemOpen = $contextMenu.Items.Add("Open Cloud Uploader (Ctrl+Shift+U)")
$itemOpen.Add_Click({
    Trigger-UploaderAction @()
})
$itemLocalStorage = $contextMenu.Items.Add("Open Local Storage Folder (C:\DCC-LocalStorage)")
$itemLocalStorage.Add_Click({
    $localPath = "C:\DCC-LocalStorage"
    if (-not (Test-Path $localPath)) {
        New-Item -ItemType Directory -Path $localPath -Force | Out-Null
    }
    Start-Process explorer.exe $localPath
})
$contextMenu.Items.Add("-") | Out-Null
$itemExit = $contextMenu.Items.Add("Exit HotKey Daemon")
$itemExit.Add_Click({
    $trayIcon.Visible = $false
    [Win32HotKey]::UnregisterHotKey($form.Handle, $HOTKEY_ID) | Out-Null
    $form.Close()
    [System.Windows.Forms.Application]::Exit()
})
$trayIcon.ContextMenuStrip = $contextMenu

function Trigger-UploaderAction([string[]]$paths) {
    if (-not $paths -or $paths.Count -eq 0) {
        $paths = Get-ActiveExplorerSelectedFiles
    }

    $QueueDir = Join-Path $env:TEMP "DCC_Upload_Queue"
    if (-not (Test-Path $QueueDir)) {
        New-Item -ItemType Directory -Path $QueueDir -Force | Out-Null
    }
    $QueueFile = Join-Path $QueueDir "queue.txt"

    if ($paths -and $paths.Count -gt 0) {
        [System.IO.File]::WriteAllLines($QueueFile, $paths, [System.Text.Encoding]::UTF8)
        $trayIcon.ShowBalloonTip(2000, "RMS Cloud Uploader", "Uploading $($paths.Count) file(s) from Local Storage to Cloud Storage...", [System.Windows.Forms.ToolTipIcon]::Info)
    } else {
        # Default to opening uploader with Local Storage folder pre-navigated
        Remove-Item -Path $QueueFile -Force -ErrorAction SilentlyContinue
        $trayIcon.ShowBalloonTip(1500, "RMS Cloud Uploader", "Opening Cloud Uploader (Local Storage -> Cloud Storage)...", [System.Windows.Forms.ToolTipIcon]::Info)
    }

    $resolvedGui = if (Test-Path $GuiPs1) { (Resolve-Path $GuiPs1).Path } else { "" }
    if ($resolvedGui) {
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -STA -File `"$resolvedGui`" $(if (Test-Path $QueueFile) { "-QueueFile `"$QueueFile`"" } else { "" })"
    } elseif (Test-Path $LauncherPs1) {
        $resolvedLauncher = (Resolve-Path $LauncherPs1).Path
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$resolvedLauncher`" $(if ($paths) { "`"$($paths -join '`" `"')`"" } else { "" })"
    }
}

# Subclass WndProc via ScriptMethod or Reflection for WM_HOTKEY
$form.Add_HandleCreated({
    $registered = [Win32HotKey]::RegisterHotKey($form.Handle, $HOTKEY_ID, $MOD_CTRL_SHIFT, $VK_U)
    if ($registered) {
        $trayIcon.ShowBalloonTip(3000, "RMS Cloud Uploader Active", "Shortcut Key Ctrl+Shift+U is active! Select files in Explorer and press Ctrl+Shift+U to upload to Cloud Storage.", [System.Windows.Forms.ToolTipIcon]::Info)
    } else {
        $trayIcon.ShowBalloonTip(3000, "RMS Cloud Uploader Notice", "Hotkey Ctrl+Shift+U is already in use by another application. Right-click tray icon to upload.", [System.Windows.Forms.ToolTipIcon]::Warning)
    }
})

$form.Add_FormClosing({
    [Win32HotKey]::UnregisterHotKey($form.Handle, $HOTKEY_ID) | Out-Null
    $trayIcon.Visible = $false
})

# Hook Windows Message Loop
$appContext = New-Object System.Windows.Forms.ApplicationContext($form)

# Custom Message Filter for WM_HOTKEY
$filterSource = @"
using System;
using System.Windows.Forms;

public class HotKeyMessageFilter : IMessageFilter {
    public Action HotKeyTriggered;

    public bool PreFilterMessage(ref Message m) {
        const int WM_HOTKEY = 0x0312;
        if (m.Msg == WM_HOTKEY && (int)m.WParam == 9527) {
            if (HotKeyTriggered != null) {
                HotKeyTriggered();
            }
            return true;
        }
        return false;
    }
}
"@
Add-Type -TypeDefinition $filterSource -ReferencedAssemblies "System.Windows.Forms.dll" -ErrorAction SilentlyContinue

$msgFilter = New-Object HotKeyMessageFilter
$msgFilter.HotKeyTriggered = [Action]{
    Trigger-UploaderAction @()
}
[System.Windows.Forms.Application]::AddMessageFilter($msgFilter)

[System.Windows.Forms.Application]::Run($appContext)
