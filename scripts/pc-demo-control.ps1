param([ValidateSet('start','stop','status','restart-services')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $repoRoot
$demoRoot = Join-Path $repoRoot 'artifacts/pc-demo'
$processFile = Join-Path $demoRoot 'processes.json'
$runtimeFile = Join-Path $demoRoot 'runtime.json'
$nodeBin = (Get-Command node.exe).Source
function Get-DemoProcess($idValue, $service) {
  if (-not $idValue) { return $null }
  $item = Get-CimInstance Win32_Process -Filter "ProcessId=$idValue"
  if (-not $item) { return $null }
  $expected = if ($service -eq 'tunnel') { '*cloudflared.exe*tunnel*--url*http://127.0.0.1:3045*' } else { "*pc-demo.mjs*$service*" }
  if ($item.CommandLine -notlike $expected) { throw "Process identity changed for $service; refusing to control it" }
  return $item
}
$record = if (Test-Path -LiteralPath $processFile) { Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
function Start-DemoService($service) {
  $process = Start-Process -FilePath $nodeBin -ArgumentList @('scripts/pc-demo.mjs',$service) -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $demoRoot "$service.log") -RedirectStandardError (Join-Path $demoRoot "$service-error.log") -PassThru
  $record.$service = $process.Id
  $record | ConvertTo-Json | Set-Content -LiteralPath $processFile
}
if ($Action -eq 'status') {
  foreach ($service in @('api','worker','tunnel')) { [pscustomobject]@{Service=$service;Running=[bool](Get-DemoProcess $record.$service $service)} }
  return
}
if ($Action -eq 'stop') {
  foreach ($service in @('tunnel','worker','api')) { if (Get-DemoProcess $record.$service $service) { Stop-Process -Id $record.$service } }
  Write-Output 'Stopped only PC demo processes. Shared PostgreSQL was left running.'
  return
}
if ($Action -eq 'restart-services') {
  foreach ($service in @('api','worker')) { if (Get-DemoProcess $record.$service $service) { Stop-Process -Id $record.$service }; Start-DemoService $service }
  Write-Output 'Restarted only demo API and worker. The existing tunnel and Vercel deployment are unchanged.'
  return
}
foreach ($service in @('api','worker','tunnel')) { if (Get-DemoProcess $record.$service $service) { throw 'Demo is already running; use status or stop first' } }
if (-not (Test-Path -LiteralPath $runtimeFile)) { throw 'Run the isolated setup first' }
$tunnelBin = Join-Path $demoRoot 'tools/cloudflared.exe'
if ((Get-FileHash -LiteralPath $tunnelBin -Algorithm SHA256).Hash.ToLower() -ne '76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2') { throw 'Tunnel binary checksum changed; verify official release before use' }
$pgRoot = Join-Path $repoRoot 'artifacts/pg18-user-2026-10-25'
function Invoke-DemoPgCtl([string[]]$PgArguments) {
  # Wait for pg_ctl itself, not its long-lived PostgreSQL descendants or pipes.
  # Capture stderr separately so a stale-PID warning is not a PowerShell error.
  $arguments = @($PgArguments | ForEach-Object { '"' + $_ + '"' })
  $pgControl = Start-Process -FilePath (Join-Path $pgRoot 'pgsql/bin/pg_ctl.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $demoRoot 'postgres-control.log') -RedirectStandardError (Join-Path $demoRoot 'postgres-control-error.log')
  # Retain the handle before the short-lived process exits (Windows PowerShell 5).
  $retainedHandle = $pgControl.Handle
  if (-not $pgControl.WaitForExit(90000)) { throw 'PostgreSQL control timed out; inspect the local logs before retrying' }
  return $pgControl.ExitCode
}
if ((Invoke-DemoPgCtl @('status','-D',(Join-Path $pgRoot 'data'))) -ne 0) {
  $started = Invoke-DemoPgCtl @('start','-D',(Join-Path $pgRoot 'data'),'-l',(Join-Path $pgRoot 'logs/pc-demo-start.log'),'-w')
  if ($started -ne 0) { throw 'Local PostgreSQL did not start; inspect postgres-control.log and the PostgreSQL startup log' }
}
$record = [pscustomobject]@{api=$null;worker=$null;tunnel=$null}
try {
  Start-DemoService 'api'
  $tunnel = Start-Process -FilePath $tunnelBin -ArgumentList @('tunnel','--url','http://127.0.0.1:3045','--no-autoupdate','--protocol','http2','--metrics','127.0.0.1:20459') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $demoRoot 'tunnel.log') -RedirectStandardError (Join-Path $demoRoot 'tunnel-error.log') -PassThru
  $record.tunnel = $tunnel.Id
  $record | ConvertTo-Json | Set-Content -LiteralPath $processFile
  $deadline = (Get-Date).AddSeconds(60)
  $found = $null
  do {
    Start-Sleep -Milliseconds 500
    $logText = Get-Content (Join-Path $demoRoot 'tunnel-error.log') -Raw -ErrorAction SilentlyContinue
    if (-not [string]::IsNullOrEmpty($logText)) {
      $found = [regex]::Match($logText,'https://[a-z0-9-]+\.trycloudflare\.com')
    }
  } until ($found.Success -or (Get-Date) -gt $deadline)
  if (-not $found.Success) { throw 'Tunnel did not return an address; inspect local tunnel log' }
  $settings = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
  $settings.tunnelOrigin = $found.Value
  $settings | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $runtimeFile
  if (Get-DemoProcess $record.api 'api') { Stop-Process -Id $record.api }
  Start-DemoService 'api'
  Start-DemoService 'worker'
  & $nodeBin scripts/pc-demo-vercel-output.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Static output preparation failed' }
  & (Join-Path $PSScriptRoot 'pc-demo-deploy.ps1')
  & $nodeBin scripts/pc-demo-smoke.mjs --public
  if ($LASTEXITCODE -ne 0) { throw 'Public verification failed; inspect deployment before use' }
} catch {
  $record | ConvertTo-Json | Set-Content -LiteralPath $processFile
  throw
}
