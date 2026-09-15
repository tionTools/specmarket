[CmdletBinding()]
param(
    [ValidateSet('Validate', 'Start', 'Status', 'SmokeSuccess', 'SmokeFailure')]
    [string]$Mode = 'Validate',
    [string]$ProjectRoot,
    [string]$RunId
)

$ErrorActionPreference = 'Stop'
$EnvRoot = 'C:\specmarket-android-env'

function Get-RunPath([string]$Id) { Join-Path $EnvRoot "runs\\$Id" }
function Get-Status([string]$Id) {
    $run = Get-RunPath $Id
    if (-not (Test-Path -LiteralPath $run)) { throw "Unknown RunId: $Id" }
    $state = Get-Content -LiteralPath "$run\\state" -ErrorAction SilentlyContinue
    if ($state -notin @('SUCCESS', 'SUCCESS_LOCAL_CI_SIGNING_REQUIRED', 'FAILED')) { $state = 'RUNNING' }
    [pscustomobject]@{ RunId = $Id; State = $state; Stage = (Get-Content -LiteralPath "$run\\stage" -ErrorAction SilentlyContinue); Summary = (Get-Content -LiteralPath "$run\\summary" -ErrorAction SilentlyContinue) }
}
function Start-Check([string]$Root, [string]$SmokeKind) {
    if (-not $SmokeKind -and (-not $Root -or -not (Test-Path -LiteralPath (Join-Path $Root 'android')))) { throw 'ProjectRoot must contain android' }
    New-Item -ItemType Directory -Force "$EnvRoot\\runs", "$EnvRoot\\snapshots", "$EnvRoot\\gradle-home", "$EnvRoot\\tmp" | Out-Null
    $id = '{0}-{1}' -f (Get-Date -Format 'yyyyMMddHHmmssfff'), $PID
    $run = Get-RunPath $id
    New-Item -ItemType Directory -Force $run | Out-Null
    Set-Content -LiteralPath "$run\\state" -Value 'RUNNING' -Encoding ascii
    $worker = Join-Path $PSScriptRoot 'android-check-worker.ps1'
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RunId "{1}"' -f $worker, $id
    if ($Root) { $arguments += ' -ProjectRoot "{0}"' -f $Root }
    if ($SmokeKind) { $arguments += ' -SmokeKind "{0}"' -f $SmokeKind }
    $process = Start-Process -FilePath (Get-Command powershell.exe -ErrorAction Stop).Source -ArgumentList $arguments -RedirectStandardOutput "$run\\worker.out.log" -RedirectStandardError "$run\\worker.err.log" -PassThru -WindowStyle Hidden
    Set-Content -LiteralPath "$run\\pid" -Value $process.Id -Encoding ascii
    [pscustomobject]@{ RunId = $id; State = 'RUNNING'; Pid = $process.Id }
}
switch ($Mode) {
    'Validate' {
        $parseErrors = $null
        $workerErrors = $null
        $null = [Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$null, [ref]$parseErrors)
        $worker = Join-Path $PSScriptRoot 'android-check-worker.ps1'
        $null = [Management.Automation.Language.Parser]::ParseFile($worker, [ref]$null, [ref]$workerErrors)
        if ($parseErrors.Count -or $workerErrors.Count) { throw 'PowerShell parser errors found' }
        'PASS'
    }
    'Start' { Start-Check $ProjectRoot $null | Format-List }
    'Status' { Get-Status $RunId | Format-List }
    default {
        $kind = if ($Mode -eq 'SmokeSuccess') { 'success' } else { 'failure' }
        $run = Start-Check $null $kind
        for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Milliseconds 200; $status = Get-Status $run.RunId; if ($status.State -ne 'RUNNING') { break } }
        if (($kind -eq 'success' -and $status.State -eq 'SUCCESS') -or ($kind -eq 'failure' -and $status.State -eq 'FAILED')) { 'PASS'; exit 0 }
        throw "Smoke $kind did not reach its expected terminal state"
    }
}

