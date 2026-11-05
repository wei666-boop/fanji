# 在桌面和开始菜单创建「番迹」快捷方式。
# 使用项目旁边的 Python 启动器运行 appcore/desktop_app.py。

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$launcher = Join-Path $root "appcore\desktop_app.py"
$icon = Join-Path $root "static\fanji.ico"

if (-not (Test-Path $launcher)) {
    throw "没有找到 appcore/desktop_app.py"
}
if (-not (Test-Path $icon)) {
    throw "没有找到 static/fanji.ico"
}

$pythonw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $pythonw) {
    $python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
    if ($python) {
        $pythonw = Join-Path (Split-Path $python) "pythonw.exe"
    }
}
if (-not $pythonw -or -not (Test-Path $pythonw)) {
    throw "没有找到 pythonw.exe。请先安装 Python 3.10+，并加入 PATH。"
}

$targets = @(
    [Environment]::GetFolderPath("Desktop"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs")
)

$shell = New-Object -ComObject WScript.Shell
try {
    foreach ($folder in $targets) {
        if (-not $folder -or -not (Test-Path $folder)) { continue }
        $path = Join-Path $folder "番迹.lnk"
        $shortcut = $shell.CreateShortcut($path)
        $shortcut.TargetPath = $pythonw
        $shortcut.Arguments = "`"$launcher`""
        $shortcut.WorkingDirectory = $root
        $shortcut.IconLocation = "$icon,0"
        $shortcut.Description = "番迹 · 本地动漫手帐"
        $shortcut.WindowStyle = 7
        $shortcut.Save()
        Write-Host "已创建：$path"
    }
} finally {
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
}

Write-Host "完成。双击桌面或开始菜单里的「番迹」即可启动。"
