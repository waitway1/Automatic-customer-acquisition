@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = (Resolve-Path '.').Path; " ^
  "$port = 8765; " ^
  "$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; " ^
  "if (-not $listening) { " ^
  "  $python = Join-Path $root 'python\python.exe'; " ^
  "  if (-not (Test-Path $python)) { $python = 'python' } " ^
  "  New-Item -ItemType Directory -Force -Path (Join-Path $root 'runtime') | Out-Null; " ^
  "  $p = Start-Process -FilePath $python -ArgumentList 'app.py' -WorkingDirectory $root -WindowStyle Hidden -PassThru; " ^
  "  Set-Content -Path (Join-Path $root 'runtime\server.pid') -Value $p.Id -Encoding ASCII; " ^
  "  Start-Sleep -Seconds 2; " ^
  "} " ^
  "Start-Process 'http://127.0.0.1:8765';"

endlocal
