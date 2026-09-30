using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace DccEnterprise
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            string scriptDir = AppDomain.CurrentDomain.BaseDirectory;
            string logFile = Path.Combine(scriptDir, "launcher_csharp.log");

            try
            {
                File.AppendAllText(logFile, string.Format("{0:HH:mm:ss.fff} | DccLauncher started with {1} args: {2}\r\n", 
                    DateTime.Now, args != null ? args.Length : 0, args != null ? string.Join("; ", args) : ""));

                string guiScript = Path.GetFullPath(Path.Combine(scriptDir, "..", "agents", "windows-uploader", "DccUploadWindow.ps1"));
                
                if (!File.Exists(guiScript))
                {
                    guiScript = Path.GetFullPath(Path.Combine(scriptDir, "DccUploadWindow.ps1"));
                }

                if (!File.Exists(guiScript))
                {
                    MessageBox.Show("DccUploadWindow.ps1 not found at:\n" + guiScript, "DCC Ingest Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                string queueDir = Path.Combine(Path.GetTempPath(), "DCC_Upload_Queue");
                if (!Directory.Exists(queueDir))
                {
                    Directory.CreateDirectory(queueDir);
                }
                string queueFile = Path.Combine(queueDir, "queue.txt");

                // Append any passed arguments (files or folders) safely
                if (args != null && args.Length > 0)
                {
                    using (var fs = new FileStream(queueFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
                    using (var sw = new StreamWriter(fs, Encoding.UTF8))
                    {
                        foreach (var a in args)
                        {
                            if (!string.IsNullOrWhiteSpace(a))
                            {
                                string clean = a.Trim('"').Trim();
                                if (File.Exists(clean) || Directory.Exists(clean))
                                {
                                    sw.WriteLine(clean);
                                    File.AppendAllText(logFile, "  Queued: " + clean + "\r\n");
                                }
                            }
                        }
                    }
                }

                // Master mutex for debouncing Explorer multi-selection
                bool isMaster = false;
                using (var mutex = new Mutex(true, "Local\\DCC_ContextMenu_Uploader_Master_Mutex", out isMaster))
                {
                    if (!isMaster)
                    {
                        File.AppendAllText(logFile, "  Exiting as companion process.\r\n");
                        return;
                    }

                    File.AppendAllText(logFile, "  Master process waiting 350ms...\r\n");
                    Thread.Sleep(350);

                    if (!File.Exists(queueFile))
                    {
                        File.AppendAllText(logFile, "  Queue file not found, exiting.\r\n");
                        return;
                    }

                    string powershellPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
                    if (!File.Exists(powershellPath))
                    {
                        powershellPath = "powershell.exe";
                    }

                    var psi = new ProcessStartInfo();
                    psi.FileName = powershellPath;
                    psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -STA -File \"" + guiScript + "\" -QueueFile \"" + queueFile + "\"";
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true; // Completely eliminates console window
                    psi.WindowStyle = ProcessWindowStyle.Normal;

                    File.AppendAllText(logFile, string.Format("  Launching: {0} {1}\r\n", psi.FileName, psi.Arguments));
                    Process.Start(psi);
                }
            }
            catch (Exception ex)
            {
                File.AppendAllText(logFile, "ERROR: " + ex.ToString() + "\r\n");
                MessageBox.Show(ex.Message, "DCC Launcher Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
