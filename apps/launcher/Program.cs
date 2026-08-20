using System.Diagnostics;
using System.Text;

namespace DshLauncher;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new LauncherForm());
    }
}

internal sealed record ProfileInfo(string Name, string Description, bool Installed);

internal sealed class LauncherForm : Form
{
    private readonly ComboBox profileBox = new();
    private readonly TextBox workspaceBox = new();
    private readonly TextBox runtimeBox = new();
    private readonly TextBox logBox = new();
    private readonly Button launchButton = new();
    private readonly Label statusLabel = new();
    private Process? process;

    public LauncherForm()
    {
        Text = "DeepSeek Harness Launcher";
        Width = 760;
        Height = 560;
        MinimumSize = new Size(640, 460);
        StartPosition = FormStartPosition.CenterScreen;

        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 2, RowCount = 7 };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        for (var i = 1; i < 6; i++) root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        Controls.Add(root);

        var heading = new Label { Text = "DeepSeek Harness", Dock = DockStyle.Fill, Font = new Font(Font.FontFamily, 20, FontStyle.Bold), AutoSize = true };
        root.Controls.Add(heading, 0, 0);
        root.SetColumnSpan(heading, 2);

        AddLabel(root, "Profile", 1);
        profileBox.Dock = DockStyle.Fill;
        profileBox.DropDownStyle = ComboBoxStyle.DropDownList;
        root.Controls.Add(profileBox, 1, 1);

        AddLabel(root, "工作目录", 2);
        var workspacePanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        workspacePanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        workspacePanel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 90));
        workspaceBox.Dock = DockStyle.Fill;
        workspaceBox.Text = Environment.CurrentDirectory;
        workspacePanel.Controls.Add(workspaceBox, 0, 0);
        var browse = new Button { Text = "选择…", Dock = DockStyle.Fill };
        browse.Click += (_, _) => BrowseWorkspace();
        workspacePanel.Controls.Add(browse, 1, 0);
        root.Controls.Add(workspacePanel, 1, 2);

        AddLabel(root, "DSH Runtime", 3);
        var runtimePanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        runtimePanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        runtimePanel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 90));
        runtimeBox.Dock = DockStyle.Fill;
        runtimeBox.Text = DiscoverRuntime();
        runtimePanel.Controls.Add(runtimeBox, 0, 0);
        var runtimeBrowse = new Button { Text = "选择…", Dock = DockStyle.Fill };
        runtimeBrowse.Click += (_, _) => BrowseRuntime();
        runtimePanel.Controls.Add(runtimeBrowse, 1, 0);
        root.Controls.Add(runtimePanel, 1, 3);

        AddLabel(root, "状态", 4);
        statusLabel.Text = "就绪";
        statusLabel.Dock = DockStyle.Fill;
        root.Controls.Add(statusLabel, 1, 4);

        var actionPanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        actionPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        actionPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 140));
        launchButton.Text = "启动 Profile";
        launchButton.Dock = DockStyle.Fill;
        launchButton.Height = 34;
        launchButton.Click += (_, _) => LaunchSelectedProfile();
        actionPanel.Controls.Add(launchButton, 0, 0);
        var configureButton = new Button { Text = "Profile 配置", Dock = DockStyle.Fill };
        configureButton.Click += (_, _) => OpenProfileConfig();
        actionPanel.Controls.Add(configureButton, 1, 0);
        root.Controls.Add(actionPanel, 1, 5);

        AddLabel(root, "启动日志", 6);
        logBox.Multiline = true;
        logBox.ReadOnly = true;
        logBox.ScrollBars = ScrollBars.Both;
        logBox.Dock = DockStyle.Fill;
        root.Controls.Add(logBox, 1, 6);

        LoadProfiles();
        FormClosing += (_, _) => StopProcess();
    }

    private void AddLabel(TableLayoutPanel root, string text, int row)
    {
        root.Controls.Add(new Label { Text = text, Anchor = AnchorStyles.Left, AutoSize = true }, 0, row);
    }

    private void LoadProfiles()
    {
        var profiles = new List<ProfileInfo>
        {
            new("desktop", "Desktop 工作台", HasProfile("desktop")),
            new("web", "浏览器工作台", HasProfile("web")),
            new("headless", "无界面任务模式", HasProfile("headless")),
            new("governance", "Governance Multi-Agent", HasProfile("governance")),
        };
        profileBox.Items.Clear();
        foreach (var profile in profiles) profileBox.Items.Add(new ProfileItem(profile));
        profileBox.SelectedIndex = profiles.FindIndex(profile => profile.Installed && profile.Name == "desktop");
        if (profileBox.SelectedIndex < 0) profileBox.SelectedIndex = profiles.FindIndex(profile => profile.Installed);
        if (profileBox.SelectedIndex < 0) profileBox.SelectedIndex = 0;
    }

    private bool HasProfile(string name) => Directory.Exists(Path.Combine(GetDshHome(), "profiles", name));

    private string GetDshHome() => Environment.GetEnvironmentVariable("DSH_HOME") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh");

    private string DiscoverRuntime()
    {
        var configured = Environment.GetEnvironmentVariable("DSH_RUNTIME");
        if (!string.IsNullOrWhiteSpace(configured)) return configured;
        if (OperatingSystem.IsWindows() && File.Exists(Path.Combine(Environment.CurrentDirectory, "apps", "cli", "src", "bin.ts")))
            return "pnpm.cmd dsh";
        return FindOnPath(OperatingSystem.IsWindows() ? "dsh.cmd" : "dsh") ?? (OperatingSystem.IsWindows() ? "dsh.cmd" : "dsh");
    }

    private void BrowseWorkspace()
    {
        using var dialog = new FolderBrowserDialog { SelectedPath = Directory.Exists(workspaceBox.Text) ? workspaceBox.Text : Environment.CurrentDirectory };
        if (dialog.ShowDialog(this) == DialogResult.OK) workspaceBox.Text = dialog.SelectedPath;
    }

    private void OpenProfileConfig()
    {
        if (profileBox.SelectedItem is not ProfileItem item) return;
        var profileDirectory = Path.Combine(GetDshHome(), "profiles", item.Profile.Name);
        Directory.CreateDirectory(profileDirectory);
        Process.Start(new ProcessStartInfo("explorer.exe", profileDirectory) { UseShellExecute = true });
        AppendLog($"已打开 Profile 配置目录：{profileDirectory}");
    }

    private void BrowseRuntime()
    {
        using var dialog = new OpenFileDialog { Filter = "DSH Runtime|dsh.exe;dsh.cmd;dsh.bat|All files|*.*", CheckFileExists = true };
        if (dialog.ShowDialog(this) == DialogResult.OK) runtimeBox.Text = dialog.FileName;
    }

    private void LaunchSelectedProfile()
    {
        if (HasRunningProcess())
        {
            MessageBox.Show(this, "当前已有 Profile 正在运行。", "DSH Launcher", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (profileBox.SelectedItem is not ProfileItem item) return;
        if (!Directory.Exists(workspaceBox.Text))
        {
            MessageBox.Show(this, "工作目录不存在。", "DSH Launcher", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var sourceCheckout = File.Exists(Path.Combine(workspaceBox.Text, "apps", "cli", "src", "bin.ts"));
        var sourceMode = sourceCheckout && (runtimeBox.Text.Trim().Equals("dsh.cmd", StringComparison.OrdinalIgnoreCase)
            || runtimeBox.Text.Trim().Equals("dsh", StringComparison.OrdinalIgnoreCase)
            || runtimeBox.Text.Trim().Equals("pnpm dsh", StringComparison.OrdinalIgnoreCase)
            || runtimeBox.Text.Trim().Equals("pnpm.cmd dsh", StringComparison.OrdinalIgnoreCase));
        var runtime = sourceMode ? FindOnPath("pnpm.cmd") : ResolveRuntime(runtimeBox.Text.Trim(), workspaceBox.Text);
        if (runtime is null)
        {
            const string message = "找不到 DSH Runtime。请安装 DSH，或使用“选择…”指定 dsh.cmd/dsh.exe；源码仓库可使用 pnpm.cmd dsh；也可以设置 DSH_RUNTIME。";
            SetRunning(false, "Runtime 未找到");
            AppendLog(message);
            MessageBox.Show(this, message, "DSH Launcher", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = runtime,
            WorkingDirectory = workspaceBox.Text,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        if (sourceMode || runtimeBox.Text.Trim().Equals("pnpm.cmd dsh", StringComparison.OrdinalIgnoreCase)) startInfo.ArgumentList.Add("dsh");
        startInfo.ArgumentList.Add("--profile");
        startInfo.ArgumentList.Add(item.Profile.Name);

        try
        {
            var startedProcess = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            startedProcess.OutputDataReceived += (_, args) => AppendLog(args.Data);
            startedProcess.ErrorDataReceived += (_, args) => AppendLog(args.Data);
            startedProcess.Exited += (_, _) => BeginInvoke(() => SetRunning(false, $"进程已退出，代码 {startedProcess.ExitCode}"));
            if (!startedProcess.Start()) throw new InvalidOperationException("无法启动 DSH Runtime");
            process = startedProcess;
            startedProcess.BeginOutputReadLine();
            startedProcess.BeginErrorReadLine();
            SetRunning(true, $"已启动 {item.Profile.Name}");
        }
        catch (Exception error)
        {
            process = null;
            SetRunning(false, "启动失败");
            AppendLog(error.Message);
            MessageBox.Show(this, error.Message, "DSH Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private bool HasRunningProcess()
    {
        if (process is null) return false;
        try
        {
            return !process.HasExited;
        }
        catch (InvalidOperationException)
        {
            process.Dispose();
            process = null;
            return false;
        }
    }

    private static string? ResolveRuntime(string value, string workspace)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (value.Equals("pnpm dsh", StringComparison.OrdinalIgnoreCase) || value.Equals("pnpm.cmd dsh", StringComparison.OrdinalIgnoreCase))
            return FindOnPath("pnpm.cmd");
        if (File.Exists(value)) return Path.GetFullPath(value);
        var workspaceRuntime = Path.Combine(workspace, "node_modules", ".bin", value);
        if (File.Exists(workspaceRuntime)) return workspaceRuntime;
        return FindOnPath(value);
    }

    private static string? FindOnPath(string command)
    {
        try
        {
            using var lookup = Process.Start(new ProcessStartInfo
            {
                FileName = "where.exe",
                Arguments = command,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            });
            if (lookup is null) return null;
            var result = lookup.StandardOutput.ReadLine()?.Trim();
            lookup.WaitForExit(2000);
            return string.IsNullOrWhiteSpace(result) ? null : result;
        }
        catch (Exception) { return null; }
    }

    private void SetRunning(bool running, string status)
    {
        if (InvokeRequired) { BeginInvoke(() => SetRunning(running, status)); return; }
        launchButton.Enabled = !running;
        statusLabel.Text = status;
    }

    private void AppendLog(string? line)
    {
        if (string.IsNullOrEmpty(line)) return;
        if (InvokeRequired) { BeginInvoke(() => AppendLog(line)); return; }
        logBox.AppendText(line + Environment.NewLine);
    }

    private void StopProcess()
    {
        if (process is not { HasExited: false }) return;
        try { process.Kill(entireProcessTree: true); } catch { /* shutdown is best effort */ }
    }

    private sealed class ProfileItem
    {
        public ProfileInfo Profile { get; }

        public ProfileItem(ProfileInfo profile) => Profile = profile;

        public override string ToString() => $"{Profile.Name} — {Profile.Description}{(Profile.Installed ? "" : "（未初始化）")}";
    }
}
