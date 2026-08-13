#!/usr/bin/env pwsh
# 打包 4 个项目 + PG 导出，上传到 192.168.1.2:/mnt/llgj/apps/gxy
$ErrorActionPreference = 'Stop'
$REMOTE = 'root@192.168.1.2'
$BASE = '/mnt/llgj/apps/gxy'
$STAGE = 'd:\GuiCare\_stage_gxy'

Write-Host '=== 清理暂存区 ==='
if (Test-Path $STAGE) { Remove-Item $STAGE -Recurse -Force }
New-Item -ItemType Directory -Path $STAGE -Force | Out-Null

# ── flatTalk ──────────────────────────────────────────
Write-Host '=== 暂存 flatTalk ==='
$ftDst = Join-Path $STAGE 'flatTalk'
New-Item -ItemType Directory -Path $ftDst -Force | Out-Null
$ftExclude = @(
  'node_modules', '.git', 'build', 'ssl', '_stage_gxy',
  'flatTalk-20260731.tar.gz', 'flatTalk2-data.zip', 'flatTalk2-deploy.tar.gz',
  'flatTalk2-scripts.zip', 'flatTalk2-src.zip', 'AI对接包-wgp-v3.zip'
)
Get-ChildItem 'd:\GuiCare\flatTalk' -Force | Where-Object {
  $n = $_.Name
  ($ftExclude -notcontains $n) -and
  ($n -notmatch '^_') -and
  ($n -notmatch '\.(zip|tar\.gz|rar|pid|err|out|log)$') -and
  ($n -ne '.env')
} | ForEach-Object {
  Copy-Item $_.FullName -Destination $ftDst -Recurse -Force -ErrorAction SilentlyContinue
}
# 清掉 skills 里的 preview 产物与源拷贝，减小体积
foreach ($p in @('src\skills\*\templates\preview', 'assets\source-copies')) {
  Get-ChildItem (Join-Path $ftDst $p) -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}
# scripts 下只保留 deploy 与正式脚本，去掉下划线调试脚本
Get-ChildItem (Join-Path $ftDst 'scripts') -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^_' } | Remove-Item -Force -ErrorAction SilentlyContinue

# ── LIS-System ────────────────────────────────────────
Write-Host '=== 暂存 LIS-System ==='
$lisDst = Join-Path $STAGE 'LIS-System'
New-Item -ItemType Directory -Path $lisDst -Force | Out-Null
Get-ChildItem 'd:\GuiCare\LIS-System' -Force | Where-Object {
  $n = $_.Name
  ($n -notin @('.venv', '.git', 'build', '__pycache__')) -and
  ($n -notmatch '\.(pid|err|out|log)$') -and
  ($n -ne '.env')
} | ForEach-Object {
  Copy-Item $_.FullName -Destination $lisDst -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Tag-System ────────────────────────────────────────
Write-Host '=== 暂存 Tag-System ==='
$tagDst = Join-Path $STAGE 'Tag-System'
New-Item -ItemType Directory -Path $tagDst -Force | Out-Null
Get-ChildItem 'd:\GuiCare\Tag-System' -Force | Where-Object {
  $n = $_.Name
  ($n -notin @('.venv', '.git', '__pycache__', 'node_modules')) -and
  ($n -notmatch '\.(pid|err|out|log|zip|xlsx|docx)$') -and
  ($n -notin @('.env', '.env.remote'))
} | ForEach-Object {
  Copy-Item $_.FullName -Destination $tagDst -Recurse -Force -ErrorAction SilentlyContinue
}
Get-ChildItem (Join-Path $tagDst 'frontend') -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -in @('node_modules', 'dist') -or $_.Name -match '\.(pid|err|out)$' } |
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# ── PG 导出 ───────────────────────────────────────────
Write-Host '=== 暂存 PG 导出 ==='
Copy-Item 'd:\GuiCare\flatTalk\build\pgdump' -Destination (Join-Path $STAGE 'pgdump') -Recurse -Force

$size = [math]::Round(((Get-ChildItem $STAGE -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)
$count = (Get-ChildItem $STAGE -Recurse -File).Count
Write-Host "暂存完成: $count 文件, $size MB"

# ── 打包 ──────────────────────────────────────────────
Write-Host '=== 打包 tar.gz ==='
$tarPath = 'd:\GuiCare\_gxy_deploy.tar.gz'
if (Test-Path $tarPath) { Remove-Item $tarPath -Force }
tar -czf $tarPath -C $STAGE .
$tarMB = [math]::Round((Get-Item $tarPath).Length / 1MB, 2)
Write-Host "包大小: $tarMB MB"

# ── 上传 ──────────────────────────────────────────────
Write-Host '=== 上传 ==='
ssh $REMOTE "mkdir -p $BASE"
scp $tarPath "${REMOTE}:/tmp/gxy_deploy.tar.gz"
ssh $REMOTE "cd $BASE && tar -xzf /tmp/gxy_deploy.tar.gz && ls -1 && du -sh ."
Write-Host '=== 上传完成 ==='
