' DCC Enterprise - Silent Explorer Context Menu Launcher
' Runs PowerShell completely hidden with ZERO console flash.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psLauncher = scriptDir & "\dcc-upload-launcher.ps1"

args = ""
For Each arg In WScript.Arguments
    ' Escape double quotes
    cleanArg = Replace(arg, """", """""")
    args = args & " """ & cleanArg & """"
Next

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File """ & psLauncher & """" & args

' 0 = Hide console window completely (SW_HIDE), False = do not wait for exit
shell.Run cmd, 0, False
