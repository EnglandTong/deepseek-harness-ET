# dsh-launcher

Windows launcher for selecting and starting an existing DeepSeek Harness Profile. The launcher is intentionally a thin host: Profile composition, Plugin loading, Session persistence, and Web/Desktop behavior remain owned by DSH.

Build a self-contained executable from the repository root:

```powershell
dotnet publish apps/launcher/DshLauncher.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false
```

The executable is emitted under `apps/launcher/bin/Release/net8.0-windows/win-x64/publish/dsh-launcher.exe`.

Set `DSH_RUNTIME` when `dsh.cmd` is not on `PATH`, and set `DSH_HOME` when the Harness home is not the default `%USERPROFILE%\\.dsh`.
