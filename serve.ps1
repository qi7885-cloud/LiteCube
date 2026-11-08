# 轻立方 LiteCube — 零依赖 PowerShell 静态服务（无 Python 时的兜底）
param([int]$Port = 8123)
$root = (Get-Item $MyInvocation.MyCommand.Path).DirectoryName
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "轻立方已启动: http://localhost:$Port/app/index.html  (Ctrl+C 退出)"
$mime = @{
  ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8";  ".json" = "application/json"
  ".png"  = "image/png"; ".jpg" = "image/jpeg"; ".jpeg" = "image/jpeg"
  ".svg"  = "image/svg+xml"; ".glb" = "model/gltf-binary"; ".ico" = "image/x-icon"
}
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $path = $ctx.Request.Url.AbsolutePath
    if ($path -eq "/") { $path = "/app/index.html" }
    $file = [IO.Path]::GetFullPath((Join-Path $root ($path.Replace("/", "\"))))
    if ($file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $file -PathType Leaf)) {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
      $bytes = [IO.File]::ReadAllBytes($file)
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
  } catch {
    try { $ctx.Response.StatusCode = 500 } catch {}
  }
  try { $ctx.Response.Close() } catch {}
}
