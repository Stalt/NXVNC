; ============================================================
; videowares WebVNC - Inno Setup Installer
; ============================================================

#define MyAppName "videowares WebVNC"
#define MyAppVersion "1.0.0"
#ifndef MyBuildNumber
  #define MyBuildNumber "00000"
#endif
#define MyFullVersion MyAppVersion + "." + MyBuildNumber
#define MyAppPublisher "videowares"
#define MyAppURL "https://github.com/Stalt/WebVNC"
#define MyAppExeName "WebVNC.exe"
#define MyAppSvcName "WebVNCSvc.exe"
#define MyServiceName "WebVNC"

[Setup]
AppId={{A1B2C3D4-5E6F-7A8B-9C0D-E1F2A3B4C5D6}
AppName={#MyAppName}
AppVersion={#MyFullVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=dist
OutputBaseFilename=WebVNCSetup_{#MyFullVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
UninstallDisplayName={#MyAppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "startservice"; Description: "Start the service now"; GroupDescription: "Service:"; Flags: checkedonce
Name: "autostarttray"; Description: "Start tray control panel on Windows login"; GroupDescription: "Tray:"; Flags: checkedonce
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "dist\WebVNC\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName} Control Panel"; Filename: "{app}\{#MyAppExeName}"; Comment: "Open the tray control panel"
Name: "{group}\Open Web Interface"; Filename: "https://localhost:6080"; Comment: "Open WebVNC in browser"
Name: "{group}\Service Manager"; Filename: "{app}\manage_service.bat"; Comment: "Manage the Windows Service"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "WebVNCTray"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue; Tasks: autostarttray

[Dirs]
Name: "{commonappdata}\WebVNC"; Permissions: everyone-full
Name: "{commonappdata}\WebVNC\data"; Permissions: everyone-full
Name: "{commonappdata}\WebVNC\data\tls"; Permissions: everyone-full
Name: "{commonappdata}\WebVNC\logs"; Permissions: everyone-full

[Run]
; Install Windows Service via NSSM
Filename: "{app}\nssm.exe"; Parameters: "install {#MyServiceName} ""{app}\{#MyAppSvcName}"""; StatusMsg: "Installing Windows Service..."; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} DisplayName ""videowares WebVNC"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} Description ""Web-based remote desktop client. Provides VNC access through a web browser."""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppDirectory ""{app}"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} Start SERVICE_AUTO_START"; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppStdout ""{commonappdata}\WebVNC\logs\service.log"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppStderr ""{commonappdata}\WebVNC\logs\service.log"""; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppStdoutCreationDisposition 4"; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppStderrCreationDisposition 4"; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppRotateFiles 1"; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppRotateOnline 1"; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppRotateBytes 10485760"; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "set {#MyServiceName} AppNoConsole 1"; Flags: runhidden waituntilterminated

; Start the service
Filename: "{app}\nssm.exe"; Parameters: "start {#MyServiceName}"; StatusMsg: "Starting service..."; Flags: runhidden waituntilterminated; Tasks: startservice

; Launch tray app
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName} control panel"; Flags: nowait postinstall skipifsilent shellexec

[UninstallRun]
Filename: "taskkill"; Parameters: "/f /im WebVNC.exe"; Flags: runhidden waituntilterminated; RunOnceId: "KillTray"
Filename: "taskkill"; Parameters: "/f /im WebVNCSvc.exe"; Flags: runhidden waituntilterminated; RunOnceId: "KillSvc"
Filename: "taskkill"; Parameters: "/f /im nssm.exe"; Flags: runhidden waituntilterminated; RunOnceId: "KillNssm"
Filename: "sc"; Parameters: "delete {#MyServiceName}"; Flags: runhidden waituntilterminated; RunOnceId: "ScDelete"

[UninstallDelete]
Type: files; Name: "{commonappdata}\WebVNC\logs\service.log"
Type: files; Name: "{commonappdata}\WebVNC\logs\service.log.1"
Type: files; Name: "{commonappdata}\WebVNC\logs\service.log.2"
Type: files; Name: "{commonappdata}\WebVNC\logs\service.log.3"
Type: dirifempty; Name: "{commonappdata}\WebVNC\logs"
Type: dirifempty; Name: "{commonappdata}\WebVNC\data"
Type: dirifempty; Name: "{commonappdata}\WebVNC"
Type: files; Name: "{localappdata}\WebVNC\tray.log"
Type: files; Name: "{localappdata}\WebVNC\tray.log.1"
Type: files; Name: "{localappdata}\WebVNC\tray.log.2"
Type: files; Name: "{localappdata}\WebVNC\tray.log.3"
Type: dirifempty; Name: "{localappdata}\WebVNC"

[Code]
procedure KillAllProcesses();
var
  ResultCode: Integer;
begin
  Exec('taskkill', '/f /im WebVNC.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('taskkill', '/f /im WebVNCSvc.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('taskkill', '/f /im nssm.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(1500);
  Exec('sc', ExpandConstant('delete {#MyServiceName}'), '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(1500);
end;

procedure WriteConfigJson();
var
  DataDir, LogDir, ConfigFile, Content: String;
begin
  DataDir := ExpandConstant('{commonappdata}\WebVNC\data');
  LogDir := ExpandConstant('{commonappdata}\WebVNC\logs');
  ConfigFile := ExpandConstant('{app}\config.json');

  if not FileExists(ConfigFile) then
  begin
    StringChangeEx(DataDir, '\', '\\', True);
    StringChangeEx(LogDir, '\', '\\', True);
    Content := '{' + #13#10;
    Content := Content + '  "dbPath": "' + DataDir + '\\webvnc.db",' + #13#10;
    Content := Content + '  "serviceLogPath": "' + LogDir + '\\service.log"' + #13#10;
    Content := Content + '}' + #13#10;
    SaveStringToFile(ConfigFile, Content, False);
    Log('Created config.json with data paths');
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
  begin
    KillAllProcesses();
  end;
  if CurStep = ssPostInstall then
  begin
    WriteConfigJson();
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    KillAllProcesses();
  end;
end;
