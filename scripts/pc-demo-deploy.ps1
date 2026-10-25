$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $repoRoot
$demoRoot = Join-Path $repoRoot 'artifacts/pc-demo'
$cacheRoot = Join-Path $env:LOCALAPPDATA 'npm-cache/_npx'
$cli = $null
if (Test-Path -LiteralPath $cacheRoot) {
  foreach ($entry in (Get-ChildItem -LiteralPath $cacheRoot -Directory)) {
    $packagePath = Join-Path $entry.FullName 'node_modules/vercel/package.json'
    if (Test-Path -LiteralPath $packagePath) {
      $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
      $candidate = Join-Path $entry.FullName 'node_modules/vercel/dist/vc.js'
      if ($package.name -eq 'vercel' -and $package.version -eq '65.2.0' -and (Test-Path -LiteralPath $candidate)) { $cli = $candidate; break }
    }
  }
}
$deployArgs = @('deploy','--prebuilt','--prod','--yes','--cwd','artifacts/pc-demo/vercel','--scope','hunters-17ac')
if ($cli) {
  $executable = (Get-Command node.exe).Source
  $arguments = @('"' + $cli + '"') + $deployArgs
} else {
  $executable = $env:ComSpec
  $arguments = @('/d','/c','npx.cmd --yes vercel@65.2.0 ' + ($deployArgs -join ' '))
}
# Vercel prints normal progress on stderr. Capture it without treating it as failure.
$deployment = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $demoRoot 'vercel-deploy.log') -RedirectStandardError (Join-Path $demoRoot 'vercel-deploy-error.log')
$retainedHandle = $deployment.Handle
if (-not $deployment.WaitForExit(600000)) { throw 'Vercel deployment is still running; inspect the deployment logs before retrying' }
if ($deployment.ExitCode -ne 0) { throw 'Vercel deployment failed. See artifacts/pc-demo/vercel-deploy-error.log; sign in again if requested.' }
Write-Output 'Vercel connection updated.'
