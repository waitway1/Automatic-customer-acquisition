$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Here
$Python = Join-Path $Here "python\python.exe"
if (-not (Test-Path $Python)) {
  $Python = "python"
}
& $Python .\app.py
