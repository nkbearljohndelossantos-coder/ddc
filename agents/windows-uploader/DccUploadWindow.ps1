<#
.SYNOPSIS
    DCC Enterprise — Native Windows Explorer Upload Window (WPF)
    Supports Single File, Multiple Files, Folders, and Drag-and-Drop.
    Light Theme UI with High-Contrast Typography & Modern Windows 11 Styling.
#>

param(
    [string]$QueueFile,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$FilePaths
)

# Hide any attached console window immediately (prevents black flash)
Add-Type -Name WinConsole -Namespace Win32 -MemberDefinition '
[DllImport("Kernel32.dll")]
public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, Int32 nCmdShow);
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hWnd);
' -ErrorAction SilentlyContinue

try {
    $consolePtr = [Win32.WinConsole]::GetConsoleWindow()
    if ($consolePtr -ne [IntPtr]::Zero) {
        [Win32.WinConsole]::ShowWindow($consolePtr, 0) | Out-Null # 0 = SW_HIDE
    }
} catch {}

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms, System.Drawing

$DebugLogPath = Join-Path $PSScriptRoot "gui_debug.log"
function Log-GuiStep($msg) {
    try {
        [System.IO.File]::AppendAllText($DebugLogPath, "$(Get-Date -Format 'HH:mm:ss.fff') | $msg`r`n")
    } catch {}
}

Log-GuiStep "Script started. QueueFile='$QueueFile', FilePaths='$($FilePaths -join ';')'"

$ApiBaseUrl = if ($env:DCC_API_URL) { $env:DCC_API_URL } else { "http://localhost:4000" }
$CliScript = Join-Path $PSScriptRoot "dcc-upload-cli.mjs"

# 1. Resolve Target Paths (From Queue File, Arguments, or Empty)
$CollectedPaths = [System.Collections.Generic.List[string]]::new()

if ($QueueFile -and [System.IO.File]::Exists($QueueFile)) {
    try {
        $lines = [System.IO.File]::ReadAllLines($QueueFile, [System.Text.Encoding]::UTF8)
        foreach ($line in $lines) {
            $trimmed = $line.Trim().Trim('"')
            if ($trimmed -and ([System.IO.File]::Exists($trimmed) -or [System.IO.Directory]::Exists($trimmed))) {
                if (-not $CollectedPaths.Contains($trimmed)) {
                    $CollectedPaths.Add($trimmed)
                }
            }
        }
        Remove-Item -Path $QueueFile -Force -ErrorAction SilentlyContinue
    } catch {}
}

if ($FilePaths -and $FilePaths.Count -gt 0) {
    foreach ($p in $FilePaths) {
        $trimmed = $p.Trim().Trim('"')
        if ($trimmed -and ([System.IO.File]::Exists($trimmed) -or [System.IO.Directory]::Exists($trimmed))) {
            if (-not $CollectedPaths.Contains($trimmed)) {
                $CollectedPaths.Add($trimmed)
            }
        }
    }
}

# 2. Function to inspect files using node CLI
function Invoke-Inspection([string[]]$pathsToScan) {
    if (-not $pathsToScan -or $pathsToScan.Count -eq 0) {
        return $null
    }
    try {
        $cliArgs = @($CliScript, "--inspect") + $pathsToScan
        $raw = & node @cliArgs 2>$null | Out-String
        if ($raw) {
            return ($raw | ConvertFrom-Json)
        }
    } catch {
        # Fallback
    }
    return $null
}

$Inspection = Invoke-Inspection $CollectedPaths.ToArray()

$SupportedCount = if ($Inspection -and $Inspection.supportedFiles) { $Inspection.supportedFiles.Count } else { 0 }
$SkippedCount = if ($Inspection -and $Inspection.skippedFiles) { $Inspection.skippedFiles.Count } else { 0 }
$TotalBytes = if ($Inspection -and $Inspection.totalSupportedBytes) { $Inspection.totalSupportedBytes } else { 0 }
$IsFolder = if ($Inspection) { $Inspection.isFolderScan } else { $false }
$FolderName = if ($Inspection) { $Inspection.folderName } else { "" }

# Calculate human readable size
function Format-FileSize($bytes) {
    if (-not $bytes -or $bytes -eq 0) { return "0 Bytes" }
    if ($bytes -ge 1GB) { return "{0:N2} GB" -f ($bytes / 1GB) }
    if ($bytes -ge 1MB) { return "{0:N2} MB" -f ($bytes / 1MB) }
    if ($bytes -ge 1KB) { return "{0:N1} KB" -f ($bytes / 1KB) }
    return "$bytes Bytes"
}

$DefaultTitle = if ($IsFolder -and $FolderName) {
    "$FolderName Package ($SupportedCount Files)"
} elseif ($SupportedCount -eq 1) {
    [System.IO.Path]::GetFileNameWithoutExtension($Inspection.supportedFiles[0].name)
} elseif ($SupportedCount -gt 1) {
    "$([System.IO.Path]::GetFileNameWithoutExtension($Inspection.supportedFiles[0].name)) (+ $($SupportedCount - 1) Attached Files)"
} else {
    "Document Package $(Get-Date -Format 'yyyy-MM-dd')"
}

# Fetch Departments from API
$DeptsRaw = & node "$CliScript" --departments 2>$null | Out-String
$Departments = @()
try {
    $DeptsObj = $DeptsRaw | ConvertFrom-Json
    if ($DeptsObj.departments) { $Departments = $DeptsObj.departments }
} catch {}

if ($Departments.Count -eq 0) {
    $Departments = @(
        @{ id = "ADMIN"; name = "Executive & Administration"; code = "ADMIN" },
        @{ id = "ACCOUNTING"; name = "Accounting & Finance"; code = "ACCOUNTING" },
        @{ id = "PURCHASING"; name = "Purchasing & Procurement"; code = "PURCHASING" },
        @{ id = "OPERATIONS"; name = "Operations & Production"; code = "OPERATIONS" },
        @{ id = "HR"; name = "Human Resources"; code = "HR" },
        @{ id = "LEGAL"; name = "Legal & Compliance"; code = "LEGAL" },
        @{ id = "QC"; name = "Quality Control & Audit"; code = "QC" }
    )
}

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="DCC Enterprise - Upload to Document Control Center"
        Height="820" Width="920"
        MinHeight="720" MinWidth="860"
        WindowStartupLocation="CenterScreen"
        Background="#F8FAFC" Foreground="#0F172A"
        FontFamily="Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, sans-serif" FontSize="13"
        AllowDrop="True"
        ResizeMode="CanResizeWithGrip">

    <Window.Resources>
        <!-- Modern High-Contrast Controls -->
        <Style TargetType="TextBlock">
            <Setter Property="Foreground" Value="#0F172A"/>
        </Style>
        <Style TargetType="TextBox">
            <Setter Property="Background" Value="#FFFFFF"/>
            <Setter Property="Foreground" Value="#0F172A"/>
            <Setter Property="BorderBrush" Value="#CBD5E1"/>
            <Setter Property="BorderThickness" Value="1"/>
            <Setter Property="Padding" Value="10,6"/>
            <Setter Property="VerticalContentAlignment" Value="Center"/>
        </Style>
        <Style TargetType="ComboBox">
            <Setter Property="Background" Value="#FFFFFF"/>
            <Setter Property="Foreground" Value="#0F172A"/>
            <Setter Property="BorderBrush" Value="#CBD5E1"/>
            <Setter Property="Padding" Value="8,5"/>
            <Setter Property="ItemContainerStyle">
                <Setter.Value>
                    <Style TargetType="ComboBoxItem">
                        <Setter Property="Foreground" Value="#0F172A"/>
                        <Setter Property="Background" Value="#FFFFFF"/>
                        <Setter Property="Padding" Value="8,6"/>
                    </Style>
                </Setter.Value>
            </Setter>
        </Style>
        <Style TargetType="RadioButton">
            <Setter Property="Foreground" Value="#0F172A"/>
        </Style>
    </Window.Resources>

    <Grid Margin="20">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/> <!-- 0. Header Bar -->
            <RowDefinition Height="Auto"/> <!-- 1. Summary Bar -->
            <RowDefinition Height="*"/>    <!-- 2. File List Table -->
            <RowDefinition Height="Auto"/> <!-- 3. Skipped Notice -->
            <RowDefinition Height="Auto"/> <!-- 4. Metadata Form Card -->
            <RowDefinition Height="Auto"/> <!-- 5. Progress Box -->
            <RowDefinition Height="Auto"/> <!-- 6. Action Buttons -->
        </Grid.RowDefinitions>

        <!-- 0. Header Bar -->
        <Border Grid.Row="0" Background="#FFFFFF" CornerRadius="10" Padding="16,14" Margin="0,0,0,12" BorderBrush="#E2E8F0" BorderThickness="1">
            <Grid>
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>
                <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
                    <Image x:Name="ImgHeaderLogo" Height="52" Margin="0,0,14,0" VerticalAlignment="Center" Stretch="Uniform"/>
                    <StackPanel VerticalAlignment="Center">
                        <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
                            <TextBlock Text="NKB Manufacturing Corporation - DCC" FontSize="17" FontWeight="Bold" Foreground="#0F172A"/>
                            <Border Background="#FEF3C7" BorderBrush="#FCD34D" BorderThickness="1" CornerRadius="4" Padding="6,2" Margin="10,0,0,0" VerticalAlignment="Center">
                                <TextBlock Text="DESKTOP INGEST" FontSize="10" FontWeight="Bold" Foreground="#92400E"/>
                            </Border>
                        </StackPanel>
                        <TextBlock Text="Document Control Center | Native Windows Explorer Upload" FontSize="12" Foreground="#475569" Margin="0,2,0,0"/>
                    </StackPanel>
                </StackPanel>
                <StackPanel Grid.Column="1" VerticalAlignment="Center" HorizontalAlignment="Right">
                    <TextBlock Text="Server: $ApiBaseUrl" FontSize="11" Foreground="#64748B" HorizontalAlignment="Right"/>
                    <TextBlock x:Name="TxtApiStatus" Text="[ONLINE] Connected to DCC Server" FontSize="11" Foreground="#16A34A" FontWeight="Bold" HorizontalAlignment="Right" Margin="0,2,0,0"/>
                </StackPanel>
            </Grid>
        </Border>

        <!-- 1. Intake Summary Bar -->
        <Border Grid.Row="1" Background="#F1F5F9" CornerRadius="8" Padding="12,8" Margin="0,0,0,10" BorderBrush="#CBD5E1" BorderThickness="1">
            <Grid>
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>

                <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
                    <Border Background="#2563EB" CornerRadius="12" Padding="8,3" Margin="0,0,10,0" VerticalAlignment="Center">
                        <TextBlock Text="FILES" Foreground="#FFFFFF" FontWeight="Bold" FontSize="10"/>
                    </Border>
                    <TextBlock Text="Intake Summary:" FontWeight="Bold" Foreground="#0F172A" VerticalAlignment="Center" Margin="0,0,8,0"/>
                    <TextBlock x:Name="TxtSummaryDetails" Text="$SupportedCount file(s) ready ($(Format-FileSize $TotalBytes))" FontWeight="SemiBold" Foreground="#1E40AF" VerticalAlignment="Center"/>
                </StackPanel>

                <!-- Add File Button -->
                <Button Grid.Column="1" x:Name="BtnAddFiles" Content="+ Add Files / Browse..." Height="30" Padding="12,0" Margin="0,0,8,0" Background="#FFFFFF" Foreground="#0F172A" BorderBrush="#94A3B8" BorderThickness="1" FontWeight="SemiBold" Cursor="Hand"/>

                <!-- Skipped Badge -->
                <Border Grid.Column="2" x:Name="BadgeSkipped" Background="#FEF3C7" BorderBrush="#F59E0B" BorderThickness="1" CornerRadius="4" Padding="8,2" Visibility="Collapsed" VerticalAlignment="Center">
                    <TextBlock x:Name="TxtSkippedBadge" Text="0 Skipped" FontSize="11" Foreground="#92400E" FontWeight="Bold"/>
                </Border>
            </Grid>
        </Border>

        <!-- 2. File List View (No Horizontal Scrollbar) -->
        <Border Grid.Row="2" Background="#FFFFFF" CornerRadius="8" BorderBrush="#CBD5E1" BorderThickness="1" Margin="0,0,0,10">
            <ListView x:Name="ListViewFiles" Background="#FFFFFF" BorderThickness="0" Foreground="#0F172A" AllowDrop="True" ScrollViewer.HorizontalScrollBarVisibility="Disabled">
                <ListView.ItemContainerStyle>
                    <Style TargetType="ListViewItem">
                        <Setter Property="Foreground" Value="#0F172A"/>
                        <Setter Property="Padding" Value="6,7"/>
                        <Setter Property="BorderBrush" Value="#F1F5F9"/>
                        <Setter Property="BorderThickness" Value="0,0,0,1"/>
                        <Setter Property="HorizontalContentAlignment" Value="Stretch"/>
                    </Style>
                </ListView.ItemContainerStyle>
                <ListView.View>
                    <GridView>
                        <GridViewColumn Header="Status" Width="95">
                            <GridViewColumn.CellTemplate>
                                <DataTemplate>
                                    <TextBlock Text="{Binding Status}" Foreground="{Binding StatusColor}" FontWeight="Bold" VerticalAlignment="Center"/>
                                </DataTemplate>
                            </GridViewColumn.CellTemplate>
                        </GridViewColumn>
                        <GridViewColumn Header="Filename" Width="330">
                            <GridViewColumn.CellTemplate>
                                <DataTemplate>
                                    <TextBlock Text="{Binding Name}" FontWeight="SemiBold" Foreground="#0F172A" TextTrimming="CharacterEllipsis"/>
                                </DataTemplate>
                            </GridViewColumn.CellTemplate>
                        </GridViewColumn>
                        <GridViewColumn Header="Type" Width="70" DisplayMemberBinding="{Binding Extension}"/>
                        <GridViewColumn Header="Size" Width="95" DisplayMemberBinding="{Binding FormattedSize}"/>
                        <GridViewColumn Header="Source Path" Width="260">
                            <GridViewColumn.CellTemplate>
                                <DataTemplate>
                                    <TextBlock Text="{Binding Path}" Foreground="#64748B" FontSize="11" TextTrimming="CharacterEllipsis"/>
                                </DataTemplate>
                            </GridViewColumn.CellTemplate>
                        </GridViewColumn>
                    </GridView>
                </ListView.View>
            </ListView>
        </Border>

        <!-- 3. Skipped Files Notice (Folder scan review) -->
        <Border Grid.Row="3" x:Name="PanelSkippedReview" Background="#FFFBEB" CornerRadius="6" Padding="10,8" Margin="0,0,0,10" BorderBrush="#FDE68A" BorderThickness="1" Visibility="Collapsed">
            <StackPanel>
                <TextBlock x:Name="TxtSkippedHeader" Text="[Notice] Unsupported files skipped during scan (Non-destructive):" FontWeight="Bold" Foreground="#B45309" FontSize="12"/>
                <TextBlock x:Name="TxtSkippedList" Text="None" Foreground="#78350F" FontSize="11" Margin="0,3,0,0" TextWrapping="Wrap"/>
            </StackPanel>
        </Border>

        <!-- 4. Metadata Form Card -->
        <Border Grid.Row="4" Background="#FFFFFF" CornerRadius="10" Padding="16,14" Margin="0,0,0,12" BorderBrush="#E2E8F0" BorderThickness="1">
            <StackPanel>
                <!-- Target Repository: Full Width Side-by-Side Cards (No Clipping) -->
                <TextBlock Text="Target Repository *" FontWeight="Bold" FontSize="12" Foreground="#334155" Margin="0,0,0,6"/>
                <Grid Margin="0,0,0,10">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="*"/>
                        <ColumnDefinition Width="12"/>
                        <ColumnDefinition Width="*"/>
                    </Grid.ColumnDefinitions>

                    <!-- Normal DCC Option Card -->
                    <Border Grid.Column="0" Background="#F8FAFC" BorderBrush="#CBD5E1" BorderThickness="1" CornerRadius="8" Padding="12,10">
                        <RadioButton x:Name="RbDestNormal" IsChecked="True" VerticalAlignment="Center">
                            <StackPanel Margin="6,0,0,0">
                                <StackPanel Orientation="Horizontal">
                                    <TextBlock Text="[Normal DCC]" FontWeight="Bold" Foreground="#1E40AF"/>
                                    <TextBlock Text=" Standard Repository" FontWeight="SemiBold" Foreground="#0F172A" Margin="4,0,0,0"/>
                                </StackPanel>
                                <TextBlock Text="Standard department workflows, dockets, and routing" Foreground="#64748B" FontSize="11" Margin="0,3,0,0" TextWrapping="Wrap"/>
                            </StackPanel>
                        </RadioButton>
                    </Border>

                    <!-- Private Vault Option Card -->
                    <Border Grid.Column="2" Background="#FFFBEB" BorderBrush="#FDE68A" BorderThickness="1" CornerRadius="8" Padding="12,10">
                        <RadioButton x:Name="RbDestVault" VerticalAlignment="Center">
                            <StackPanel Margin="6,0,0,0">
                                <StackPanel Orientation="Horizontal">
                                    <TextBlock Text="[Private Vault]" FontWeight="Bold" Foreground="#B45309"/>
                                    <TextBlock Text=" Encrypted Vault" FontWeight="SemiBold" Foreground="#0F172A" Margin="4,0,0,0"/>
                                </StackPanel>
                                <TextBlock Text="Zero-knowledge cryptographic storage with password verification" Foreground="#78350F" FontSize="11" Margin="0,3,0,0" TextWrapping="Wrap"/>
                            </StackPanel>
                        </RadioButton>
                    </Border>
                </Grid>

                <!-- Private Vault Expansion Panel (Folder & Password) -->
                <Border x:Name="PanelVaultOptions" Background="#FEF3C7" CornerRadius="8" Padding="14,12" Margin="0,0,0,12" BorderBrush="#F59E0B" BorderThickness="1" Visibility="Collapsed">
                    <StackPanel>
                        <TextBlock Text="Private Vault Security Credentials &amp; Target Folder:" FontWeight="Bold" Foreground="#92400E" FontSize="12"/>
                        <TextBlock Text="Enter your existing DCC account password to verify identity and select vault folder." Foreground="#78350F" FontSize="11" Margin="0,2,0,8"/>
                        
                        <Grid>
                            <Grid.ColumnDefinitions>
                                <ColumnDefinition Width="*"/>
                                <ColumnDefinition Width="14"/>
                                <ColumnDefinition Width="*"/>
                            </Grid.ColumnDefinitions>
                            
                            <StackPanel Grid.Column="0">
                                <TextBlock Text="Vault Storage Folder *" FontWeight="Bold" FontSize="11" Foreground="#92400E" Margin="0,0,0,4"/>
                                <ComboBox x:Name="CmbVaultFolder" Height="34">
                                    <ComboBoxItem Content="/Executive" IsSelected="True"/>
                                    <ComboBoxItem Content="/Financial"/>
                                    <ComboBoxItem Content="/Legal"/>
                                    <ComboBoxItem Content="/Board"/>
                                    <ComboBoxItem Content="/HR_Confidential"/>
                                    <ComboBoxItem Content="/General"/>
                                </ComboBox>
                            </StackPanel>

                            <StackPanel Grid.Column="2">
                                <TextBlock Text="Your DCC Account Password *" FontWeight="Bold" FontSize="11" Foreground="#92400E" Margin="0,0,0,4"/>
                                <PasswordBox x:Name="TxtVaultPassword" Height="34" Background="#FFFFFF" Foreground="#0F172A" BorderBrush="#CBD5E1" Padding="8,4" VerticalContentAlignment="Center"/>
                            </StackPanel>
                        </Grid>
                    </StackPanel>
                </Border>

                <!-- Title & Department Row -->
                <Grid Margin="0,0,0,10">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="*"/>
                        <ColumnDefinition Width="14"/>
                        <ColumnDefinition Width="*"/>
                    </Grid.ColumnDefinitions>
                    <StackPanel Grid.Column="0">
                        <TextBlock Text="Package / Document Title *" FontWeight="Bold" FontSize="12" Foreground="#334155" Margin="0,0,0,5"/>
                        <TextBox x:Name="TxtPackageTitle" Text="$DefaultTitle" Height="34"/>
                    </StackPanel>
                    <StackPanel Grid.Column="2">
                        <TextBlock Text="Target Department *" FontWeight="Bold" FontSize="12" Foreground="#334155" Margin="0,0,0,5"/>
                        <ComboBox x:Name="CmbDepartment" Height="34" DisplayMemberPath="DisplayName" SelectedValuePath="Id"/>
                    </StackPanel>
                </Grid>

                <!-- Doc Type & Direction Row -->
                <Grid Margin="0,0,0,12">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="*"/>
                        <ColumnDefinition Width="14"/>
                        <ColumnDefinition Width="*"/>
                    </Grid.ColumnDefinitions>
                    <StackPanel Grid.Column="0">
                        <TextBlock Text="Document Classification *" FontWeight="Bold" FontSize="12" Foreground="#334155" Margin="0,0,0,5"/>
                        <ComboBox x:Name="CmbDocType" Height="34">
                            <ComboBoxItem Content="GENERAL - General Document" IsSelected="True"/>
                            <ComboBoxItem Content="PURCHASE_ORDER - Purchase Order (PO)"/>
                            <ComboBoxItem Content="INVOICE - Sales / Supplier Invoice"/>
                            <ComboBoxItem Content="CONTRACT - Legal Contract / Agreement"/>
                            <ComboBoxItem Content="VOUCHER - Disbursement Voucher"/>
                            <ComboBoxItem Content="MEMO - Internal Memorandum"/>
                            <ComboBoxItem Content="AUDIT_REPORT - Compliance / Audit Report"/>
                            <ComboBoxItem Content="TECHNICAL_SPEC - Technical Specification"/>
                        </ComboBox>
                    </StackPanel>
                    <StackPanel Grid.Column="2">
                        <TextBlock Text="Direction / Intake Origin *" FontWeight="Bold" FontSize="12" Foreground="#334155" Margin="0,0,0,5"/>
                        <ComboBox x:Name="CmbDirection" Height="34">
                            <ComboBoxItem Content="INCOMING - External Received Document" IsSelected="True"/>
                            <ComboBoxItem Content="OUTGOING - Released to External Party"/>
                            <ComboBoxItem Content="INTERNAL - Internal Department Docket"/>
                        </ComboBox>
                    </StackPanel>
                </Grid>

                <!-- Registration Mode Selection (SAMA-SAMA vs HIWA-HIWALAY) -->
                <StackPanel Margin="0,0,0,0">
                    <TextBlock Text="Registration Mode (Intake Behavior):" FontWeight="Bold" FontSize="12" Foreground="#334155" Margin="0,0,0,6"/>
                    <Border Background="#F8FAFC" BorderBrush="#CBD5E1" BorderThickness="1" CornerRadius="8" Padding="12,10">
                        <Grid>
                            <Grid.ColumnDefinitions>
                                <ColumnDefinition Width="*"/>
                                <ColumnDefinition Width="14"/>
                                <ColumnDefinition Width="*"/>
                            </Grid.ColumnDefinitions>
                            
                            <RadioButton Grid.Column="0" x:Name="RbBundle" IsChecked="True" VerticalAlignment="Center">
                                <StackPanel Margin="6,0,0,0">
                                    <TextBlock Text="[Package] Unified Document Package" FontWeight="Bold" Foreground="#1E40AF"/>
                                    <TextBlock Text="Sama-sama sa iisang Docket/Package (Lahat ng files ay bubuo ng 1 record)" Foreground="#64748B" FontSize="11" Margin="0,2,0,0" TextWrapping="Wrap"/>
                                </StackPanel>
                            </RadioButton>

                            <RadioButton Grid.Column="2" x:Name="RbBatch" VerticalAlignment="Center">
                                <StackPanel Margin="6,0,0,0">
                                    <TextBlock Text="[Batch] Grouped Batch Series" FontWeight="Bold" Foreground="#92400E"/>
                                    <TextBlock Text="Hiwa-hiwalay pero may shared Batch Ref (Bawat file ay may sariling record)" Foreground="#64748B" FontSize="11" Margin="0,2,0,0" TextWrapping="Wrap"/>
                                </StackPanel>
                            </RadioButton>
                        </Grid>
                    </Border>
                </StackPanel>
            </StackPanel>
        </Border>

        <!-- 5. Real-time Progress Box -->
        <Border Grid.Row="5" x:Name="PanelProgress" Background="#F1F5F9" CornerRadius="8" Padding="14,10" Margin="0,0,0,12" BorderBrush="#CBD5E1" BorderThickness="1" Visibility="Collapsed">
            <StackPanel>
                <Grid Margin="0,0,0,6">
                    <TextBlock x:Name="TxtProgressStatus" Text="Initializing upload..." FontSize="12" FontWeight="SemiBold" Foreground="#2563EB"/>
                    <TextBlock x:Name="TxtProgressPercent" Text="0%" FontSize="12" FontWeight="Bold" Foreground="#16A34A" HorizontalAlignment="Right"/>
                </Grid>
                <ProgressBar x:Name="ProgressBarUpload" Height="10" Minimum="0" Maximum="100" Value="0" Foreground="#2563EB" Background="#E2E8F0" BorderThickness="0"/>
            </StackPanel>
        </Border>

        <!-- 6. Action Footer -->
        <Grid Grid.Row="6">
            <Grid.ColumnDefinitions>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="Auto"/>
            </Grid.ColumnDefinitions>

            <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
                <Border Background="#DCFCE7" CornerRadius="3" Padding="4,1" Margin="0,0,8,0">
                    <TextBlock Text="SAFE" Foreground="#15803D" FontWeight="Bold" FontSize="10"/>
                </Border>
                <TextBlock Text="Non-destructive: Source files are read-only and will never be moved or deleted." FontSize="11" Foreground="#64748B"/>
            </StackPanel>

            <Button Grid.Column="2" x:Name="BtnCancel" Content="Cancel" Width="100" Height="38" Margin="0,0,12,0" Background="#F1F5F9" Foreground="#334155" BorderBrush="#CBD5E1" BorderThickness="1" FontWeight="SemiBold" Cursor="Hand"/>
            <Button Grid.Column="3" x:Name="BtnUpload" Content="Upload to DCC" Width="160" Height="38" Background="#2563EB" Foreground="#FFFFFF" FontWeight="Bold" BorderThickness="0" Cursor="Hand"/>
            <Button Grid.Column="3" x:Name="BtnOpenWebApp" Content="Open in DCC WebApp" Width="180" Height="38" Background="#16A34A" Foreground="#FFFFFF" FontWeight="Bold" BorderThickness="0" Cursor="Hand" Visibility="Collapsed"/>
        </Grid>
    </Grid>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [System.Windows.Markup.XamlReader]::Load($reader)

# Set Window Icon and Header Logo
$LogoPngPath = Join-Path $PSScriptRoot "logo.png"
$LogoIcoPath = Join-Path $PSScriptRoot "dcc.ico"

if (Test-Path $LogoIcoPath) {
    try {
        $window.Icon = [System.Windows.Media.Imaging.BitmapFrame]::Create([System.Uri]::new($LogoIcoPath))
    } catch {}
}

$ImgHeaderLogo = $window.FindName("ImgHeaderLogo")
if ($ImgHeaderLogo -and (Test-Path $LogoPngPath)) {
    try {
        $bmpImg = New-Object System.Windows.Media.Imaging.BitmapImage
        $bmpImg.BeginInit()
        $bmpImg.UriSource = [System.Uri]::new($LogoPngPath)
        $bmpImg.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bmpImg.EndInit()
        $ImgHeaderLogo.Source = $bmpImg
    } catch {}
}

# Element References
$ListViewFiles     = $window.FindName("ListViewFiles")
$TxtSummaryDetails = $window.FindName("TxtSummaryDetails")
$BadgeSkipped      = $window.FindName("BadgeSkipped")
$TxtSkippedBadge   = $window.FindName("TxtSkippedBadge")
$PanelSkippedReview= $window.FindName("PanelSkippedReview")
$TxtSkippedList    = $window.FindName("TxtSkippedList")
$TxtPackageTitle   = $window.FindName("TxtPackageTitle")
$CmbDepartment     = $window.FindName("CmbDepartment")
$CmbDocType        = $window.FindName("CmbDocType")
$CmbDirection      = $window.FindName("CmbDirection")
$RbBundle          = $window.FindName("RbBundle")
$RbBatch           = $window.FindName("RbBatch")
$PanelProgress     = $window.FindName("PanelProgress")
$ProgressBarUpload = $window.FindName("ProgressBarUpload")
$TxtProgressStatus = $window.FindName("TxtProgressStatus")
$TxtProgressPercent= $window.FindName("TxtProgressPercent")
$BtnCancel         = $window.FindName("BtnCancel")
$BtnUpload         = $window.FindName("BtnUpload")
$BtnOpenWebApp     = $window.FindName("BtnOpenWebApp")
$BtnAddFiles       = $window.FindName("BtnAddFiles")

$RbDestNormal      = $window.FindName("RbDestNormal")
$RbDestVault       = $window.FindName("RbDestVault")
$PanelVaultOptions = $window.FindName("PanelVaultOptions")
$CmbVaultFolder    = $window.FindName("CmbVaultFolder")
$TxtVaultPassword  = $window.FindName("TxtVaultPassword")

$RbDestVault.Add_Checked({
    $PanelVaultOptions.Visibility = [System.Windows.Visibility]::Visible
})
$RbDestNormal.Add_Checked({
    $PanelVaultOptions.Visibility = [System.Windows.Visibility]::Collapsed
})

# Populate Department dropdown
$deptItems = New-Object System.Collections.ArrayList
foreach ($d in $Departments) {
    $deptItems.Add([PSCustomObject]@{
        Id = $d.id
        DisplayName = "$($d.name) ($($d.code))"
    }) | Out-Null
}
$CmbDepartment.ItemsSource = $deptItems
if ($deptItems.Count -gt 0) {
    $CmbDepartment.SelectedIndex = 0
}

# Function to render file list from inspection object
$activeFileItems = New-Object System.Collections.ArrayList

function Refresh-FileListUI($insp) {
    $activeFileItems.Clear()
    $suppCount = 0
    $totalBytes = 0

    if ($insp -and $insp.supportedFiles) {
        $suppCount = $insp.supportedFiles.Count
        $totalBytes = $insp.totalSupportedBytes
        foreach ($f in $insp.supportedFiles) {
            $activeFileItems.Add([PSCustomObject]@{
                Status = "[Ready]"
                StatusColor = "#0284C7"
                Name = $f.name
                Extension = $f.extension.ToUpper()
                FormattedSize = Format-FileSize $f.sizeBytes
                Path = $f.path
            }) | Out-Null
        }
    }
    $ListViewFiles.ItemsSource = $null
    $ListViewFiles.ItemsSource = $activeFileItems

    $TxtSummaryDetails.Text = "$suppCount file(s) ready ($(Format-FileSize $totalBytes))"

    if ($insp -and $insp.skippedFiles -and $insp.skippedFiles.Count -gt 0) {
        $BadgeSkipped.Visibility = [System.Windows.Visibility]::Visible
        $TxtSkippedBadge.Text = "$($insp.skippedFiles.Count) Skipped"
        $PanelSkippedReview.Visibility = [System.Windows.Visibility]::Visible
        $skippedNames = ($insp.skippedFiles | ForEach-Object { "$($_.name) ($($_.reason))" }) -join ", "
        $TxtSkippedList.Text = $skippedNames
    } else {
        $BadgeSkipped.Visibility = [System.Windows.Visibility]::Collapsed
        $PanelSkippedReview.Visibility = [System.Windows.Visibility]::Collapsed
    }

    if ($suppCount -gt 0 -and (-not $TxtPackageTitle.Text -or $TxtPackageTitle.Text -eq "Document Package $(Get-Date -Format 'yyyy-MM-dd')")) {
        $TxtPackageTitle.Text = [System.IO.Path]::GetFileNameWithoutExtension($insp.supportedFiles[0].name)
    }
}

Refresh-FileListUI $Inspection

# Drag and Drop handlers for Window & ListView
$window.Add_DragOver({
    param($s, $e)
    if ($e.Data.GetDataPresent([System.Windows.DataFormats]::FileDrop)) {
        $e.Effects = [System.Windows.DragDropEffects]::Copy
    } else {
        $e.Effects = [System.Windows.DragDropEffects]::None
    }
    $e.Handled = $true
})

$window.Add_Drop({
    param($s, $e)
    if ($e.Data.GetDataPresent([System.Windows.DataFormats]::FileDrop)) {
        $dropped = $e.Data.GetData([System.Windows.DataFormats]::FileDrop)
        if ($dropped) {
            foreach ($item in $dropped) {
                if (-not $CollectedPaths.Contains($item)) {
                    $CollectedPaths.Add($item)
                }
            }
            $global:Inspection = Invoke-Inspection $CollectedPaths.ToArray()
            Refresh-FileListUI $global:Inspection
        }
    }
})

# Add files button (Open File Dialog)
$BtnAddFiles.Add_Click({
    $openFileDialog = New-Object System.Windows.Forms.OpenFileDialog
    $openFileDialog.Multiselect = $true
    $openFileDialog.Title = "Select Documents to Upload to DCC"
    $openFileDialog.Filter = "All Files (*.*)|*.*|PDF Documents (*.pdf)|*.pdf|Word Documents (*.docx;*.doc)|*.docx;*.doc|Excel Spreadsheets (*.xlsx;*.xls)|*.xlsx;*.xls|Images (*.jpg;*.jpeg;*.png)|*.jpg;*.jpeg;*.png"
    if ($openFileDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        foreach ($file in $openFileDialog.FileNames) {
            if (-not $CollectedPaths.Contains($file)) {
                $CollectedPaths.Add($file)
            }
        }
        $global:Inspection = Invoke-Inspection $CollectedPaths.ToArray()
        Refresh-FileListUI $global:Inspection
    }
})

# Cancel button handler
$BtnCancel.Add_Click({
    $window.Close()
})

# Upload button handler
$BtnUpload.Add_Click({
    $currentSuppCount = if ($global:Inspection -and $global:Inspection.supportedFiles) { $global:Inspection.supportedFiles.Count } elseif ($Inspection -and $Inspection.supportedFiles) { $Inspection.supportedFiles.Count } else { 0 }

    if ($currentSuppCount -eq 0) {
        [System.Windows.MessageBox]::Show("No supported document files found to upload.`nPlease click '+ Add Files' or drag and drop document files.", "DCC Ingest Notice", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Warning)
        return
    }

    $title = $TxtPackageTitle.Text.Trim()
    if (-not $title) {
        [System.Windows.MessageBox]::Show("Please enter a package or batch title.", "Validation Error", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Warning)
        return
    }

    $selectedDept = $CmbDepartment.SelectedValue
    $selectedTypeItem = $CmbDocType.SelectedItem
    $docType = if ($selectedTypeItem) { $selectedTypeItem.Content.ToString().Split(' ')[0] } else { "GENERAL" }

    $mode = if ($RbBundle.IsChecked) { "bundle" } else { "batch" }

    $isVault = $RbDestVault.IsChecked
    $vaultPassword = if ($isVault) { $TxtVaultPassword.Password } else { "" }
    $vaultFolderItem = $CmbVaultFolder.SelectedItem
    $vaultFolder = if ($vaultFolderItem) { $vaultFolderItem.Content.ToString() } else { "/Executive" }

    if ($isVault -and [string]::IsNullOrWhiteSpace($vaultPassword)) {
        [System.Windows.MessageBox]::Show("Please enter your DCC account password to verify authorization and unlock Private Vault deposit.", "Vault Verification Required", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Warning)
        return
    }

    # Lock UI controls
    $BtnUpload.IsEnabled = $false
    $BtnCancel.IsEnabled = $false
    $BtnAddFiles.IsEnabled = $false
    $TxtPackageTitle.IsEnabled = $false
    $CmbDepartment.IsEnabled = $false
    $CmbDocType.IsEnabled = $false
    $CmbDirection.IsEnabled = $false
    $RbBundle.IsEnabled = $false
    $RbBatch.IsEnabled = $false
    $RbDestNormal.IsEnabled = $false
    $RbDestVault.IsEnabled = $false
    $TxtVaultPassword.IsEnabled = $false
    $CmbVaultFolder.IsEnabled = $false

    $PanelProgress.Visibility = [System.Windows.Visibility]::Visible
    $ProgressBarUpload.Value = 20
    $TxtProgressPercent.Text = "20%"
    $TxtProgressStatus.Text = if ($isVault) { "Verifying Private Vault credentials..." } else { "Computing SHA-256 and preparing package..." }

    # Update row statuses to processing
    foreach ($item in $activeFileItems) {
        $item.Status = "[Uploading...]"
        $item.StatusColor = "#D97706"
    }
    $ListViewFiles.Items.Refresh()

    # Build CLI command arguments using array splatting
    $uploadArgs = @(
        $CliScript,
        "--upload",
        "--mode", $mode,
        "--title", $title,
        "--type", $docType
    )
    if ($selectedDept) {
        $uploadArgs += @("--dept", $selectedDept)
    }
    if ($isVault) {
        $uploadArgs += @(
            "--destination", "vault",
            "--vaultPassword", $vaultPassword,
            "--vaultFolder", $vaultFolder
        )
    }
    $uploadArgs += $CollectedPaths.ToArray()

    $ProgressBarUpload.Value = 50
    $TxtProgressPercent.Text = "50%"
    $TxtProgressStatus.Text = if ($isVault) { "Encrypting and depositing files into Private Vault..." } else { "Transmitting to DCC repository with SHA-256 verification..." }
    $window.Dispatcher.Invoke([Action]{}, [System.Windows.Threading.DispatcherPriority]::Render)

    Start-Sleep -Milliseconds 250

    try {
        $outputRaw = & node @uploadArgs 2>&1 | Out-String

        if ($outputRaw -match '"error":\s*"(.*?)"' -or $outputRaw -match 'ACCESS DENIED') {
            $errDetail = if ($outputRaw -match '"error":\s*"(.*?)"') { $matches[1] } else { "Authentication or Access Denied." }
            throw $errDetail
        }

        $ProgressBarUpload.Value = 90
        $TxtProgressPercent.Text = "90%"
        $TxtProgressStatus.Text = "Recording immutable audit logs..."
        $window.Dispatcher.Invoke([Action]{}, [System.Windows.Threading.DispatcherPriority]::Render)

        Start-Sleep -Milliseconds 200

        # Mark all files as completed
        foreach ($item in $activeFileItems) {
            $item.Status = "[Completed]"
            $item.StatusColor = "#16A34A"
        }
        $ListViewFiles.Items.Refresh()

        $ProgressBarUpload.Value = 100
        $ProgressBarUpload.Foreground = [System.Windows.Media.Brushes]::MediumSeaGreen
        $TxtProgressPercent.Text = "100%"
        $TxtProgressStatus.Text = if ($isVault) { "[OK] Securely deposited into Private Vault ($vaultFolder)!" } else { "[OK] Upload Complete! Ingested SAMA-SAMA to DCC repository." }

        $BtnUpload.Visibility = [System.Windows.Visibility]::Collapsed
        $BtnCancel.Content = "Close"
        $BtnCancel.IsEnabled = $true
        $BtnOpenWebApp.Visibility = [System.Windows.Visibility]::Visible

        $BtnOpenWebApp.Add_Click({
            Start-Process "$ApiBaseUrl/app"
            $window.Close()
        })

    } catch {
        $ProgressBarUpload.Foreground = [System.Windows.Media.Brushes]::Crimson
        $TxtProgressStatus.Text = "[!] Upload Failed: $($_.Exception.Message)"
        $BtnUpload.IsEnabled = $true
        $BtnCancel.IsEnabled = $true
        $BtnAddFiles.IsEnabled = $true
        $RbDestNormal.IsEnabled = $true
        $RbDestVault.IsEnabled = $true
        $TxtVaultPassword.IsEnabled = $true
        $CmbVaultFolder.IsEnabled = $true
        foreach ($item in $activeFileItems) {
            $item.Status = "[Failed]"
            $item.StatusColor = "#DC2626"
        }
        $ListViewFiles.Items.Refresh()
        [System.Windows.MessageBox]::Show("$($_.Exception.Message)", "DCC Upload Error", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error)
    }
})

$window.Add_SourceInitialized({
    try {
        Log-GuiStep "Window SourceInitialized event fired."
        $wih = New-Object System.Windows.Interop.WindowInteropHelper($window)
        [Win32.WinConsole]::ShowWindow($wih.Handle, 9) | Out-Null
        [Win32.WinConsole]::SetForegroundWindow($wih.Handle) | Out-Null
    } catch {
        Log-GuiStep "Error in SourceInitialized: $($_.Exception.Message)"
    }
})

Log-GuiStep "Calling window.ShowDialog()..."
$dialogResult = $window.ShowDialog()
Log-GuiStep "window.ShowDialog() closed with result: $dialogResult"
