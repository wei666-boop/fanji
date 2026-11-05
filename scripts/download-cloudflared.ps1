# 下载 Cloudflare cloudflared（官方 Windows amd64 二进制）。
# 仅临时分享功能需要；不下载也可以使用 localhost.run fallback。

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$binDir = Join-Path $root "appcore\bin"
$target = Join-Path $binDir "cloudflared.exe"
$url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

New-Item -ItemType Directory -Force -Path $binDir | Out-Null

if (Test-Path $target) {
    $size = (Get-Item $target).Length
    if ($size -gt 10MB) {
        Write-Host "cloudflared 已存在：$target"
        & $target --version
        exit 0
    }
}

Write-Host "正在下载 cloudflared..."
Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing -TimeoutSec 300

if ((Get-Item $target).Length -lt 10MB) {
    Remove-Item $target -Force
    throw "下载的文件不完整，请重试。"
}

Write-Host "已保存：$target"
& $target --version
