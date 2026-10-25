param(
  [ValidateSet('start','stop')][string]$Action = 'start',
  [switch]$NoBrowser,
  [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $repoRoot
$demoRoot = Join-Path $repoRoot 'artifacts/pc-demo'
$control = Join-Path $PSScriptRoot 'pc-demo-control.ps1'
$gate = New-Object System.Threading.Mutex($false, 'Local\UnderstoodPcDemoLauncher')
$acquired = $false
try {
  $acquired = $gate.WaitOne(0)
  if (-not $acquired) { Write-Host 'Understood is already starting or stopping. Please wait for its window.'; return }
  if ($Action -eq 'stop') {
    Write-Host 'Stopping Understood...'
    & $control stop
    Write-Host 'Understood stopped. Your data is saved.'
    return
  }
  $settings = Get-Content -LiteralPath (Join-Path $demoRoot 'runtime.json') -Raw | ConvertFrom-Json
  $publicUrl = [uri]$settings.publicOrigin
  if ($publicUrl.Scheme -ne 'https' -or $publicUrl.Host -notmatch '^[a-z0-9-]+\.vercel\.app$' -or $publicUrl.AbsolutePath -ne '/') { throw 'Invalid demo website address' }
  Write-Host 'Starting Understood...'
  $services = @(& $control status)
  $ready = $services.Count -eq 3 -and @($services | Where-Object { -not $_.Running }).Count -eq 0
  if ($ready) {
    try {
      $health = Invoke-RestMethod -Uri ($settings.publicOrigin + '/api/health') -TimeoutSec 20
      $ready = $health.status -eq 'ok' -and $health.backend -eq 'postgres-hosted-synthetic'
    } catch { $ready = $false }
  }
  if (-not $ready) {
    Write-Host 'Connecting your local services to Vercel. This can take a few minutes.'
    $log = Join-Path $demoRoot 'launcher-last-run.log'
    & $control stop *> $log
    & $control start *>> $log
    $health = Invoke-RestMethod -Uri ($settings.publicOrigin + '/api/health') -TimeoutSec 20
    if ($health.status -ne 'ok' -or $health.backend -ne 'postgres-hosted-synthetic') { throw 'The public API is not ready yet. Check launcher-last-run.log.' }
  }
  Write-Host 'Understood is ready.' -ForegroundColor Green
  Write-Host $settings.publicOrigin
  if (-not $NoBrowser) { Start-Process -FilePath ($settings.publicOrigin + '/#sign-in') }
} catch {
  Write-Host 'Understood could not start.' -ForegroundColor Red
  Write-Host $_.Exception.Message
  Write-Host 'Keep your Internet connection on. If Vercel asks you to sign in again, run: npx vercel login'
  Write-Host ('Details: ' + (Join-Path $demoRoot 'launcher-last-run.log'))
  if (-not $NoPause) { [void](Read-Host 'Press Enter to close') }
  exit 1
} finally {
  if ($acquired) { $gate.ReleaseMutex() }
  $gate.Dispose()
}
