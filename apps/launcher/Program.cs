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
        runtimeBox.Dock = DockStyle.Fill;
        runtimeBox.Text = DiscoverRuntime();
        root.Controls.Add(runtimeBox, 1, 3);

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
        return OperatingSystem.IsWindows() ? "dsh.cmd" : "dsh";
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

    private void LaunchSelectedProfile()
    {
        if (process is { HasExited: false })
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

        var startInfo = new ProcessStartInfo
        {
            FileName = runtimeBox.Text.Trim(),
            WorkingDirectory = workspaceBox.Text,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        startInfo.ArgumentList.Add("--profile");
        startInfo.ArgumentList.Add(item.Profile.Name);

        try
        {
            process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            process.OutputDataReceived += (_, args) => AppendLog(args.Data);
            process.ErrorDataReceived += (_, args) => AppendLog(args.Data);
            process.Exited += (_, _) => BeginInvoke(() => SetRunning(false, $"进程已退出，代码 {process.ExitCode}"));
            if (!process.Start()) throw new InvalidOperationException("无法启动 DSH Runtime");
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            SetRunning(true, $"已启动 {item.Profile.Name}");
        }
        catch (Exception error)
        {
            SetRunning(false, "启动失败");
            AppendLog(error.Message);
            MessageBox.Show(this, error.Message, "DSH Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
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
