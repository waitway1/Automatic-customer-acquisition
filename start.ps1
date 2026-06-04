$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Here
$Python = "C:\1\python\python.exe"
if (-not (Test-Path $Python)) {
  $Python = "python"
}
& $Python .\app.py
