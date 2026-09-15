[CmdletBinding()]
param([Parameter(Mandatory)][string]$RunId, [string]$ProjectRoot, [ValidateSet('success', 'failure')][string]$SmokeKind)

$ErrorActionPreference = 'Stop'
$EnvRoot = 'C:\specmarket-android-env'
$Run = Join-Path $EnvRoot "runs\\$RunId"
function Set-Stage([string]$Value) { Set-Content -LiteralPath "$Run\\stage" -Value $Value -Encoding ascii }
function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
        finally { $sha.Dispose() }
    }
    finally { $stream.Dispose() }
}
function Invoke-Native([string]$Name, [string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory) {
    Set-Stage $Name; $out = "$Run\\$Name.out.log"; $err = "$Run\\$Name.err.log"
    $argumentLine = ($Arguments | ForEach-Object { '"{0}"' -f $_.Replace('"', '\"') }) -join ' '
    $p = Start-Process -FilePath $FilePath -ArgumentList $argumentLine -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -Wait -NoNewWindow
    Set-Content -LiteralPath "$Run\\$Name.exit" -Value $p.ExitCode -Encoding ascii
    if (($Name -eq 'snapshot' -and $p.ExitCode -gt 7) -or ($Name -ne 'snapshot' -and $p.ExitCode -ne 0)) { throw "$Name failed with exit code $($p.ExitCode)" }
}
function Get-AndroidSdk {
    foreach ($sdk in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, 'C:\Users\Public\Android\Sdk') | Where-Object { $_ } | Select-Object -Unique) {
        if ((Test-Path -LiteralPath (Join-Path $sdk 'platforms\\android-37.0')) -and (Test-Path -LiteralPath (Join-Path $sdk 'build-tools\\36.0.0\\apksigner.bat'))) { return $sdk }
    }
    throw 'Android SDK with platform android-37.0 and build-tools 36.0.0 is missing'
}
function Get-Jdk {
    foreach ($jdkHome in @($env:JAVA_HOME, 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot') | Where-Object { $_ } | Select-Object -Unique) {
        if (Test-Path -LiteralPath (Join-Path $jdkHome 'bin\\java.exe')) { return $jdkHome }
    }
    throw 'JDK 17 or newer is missing'
}
function Get-SourceManifest([string]$Root) {
    Get-ChildItem -LiteralPath $Root -File -Recurse | Where-Object { $_.FullName -notmatch '[\\/](build|\.gradle)[\\/]' } | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring($Root.Length).TrimStart([char]92)
        '{0}|{1}|{2}' -f $relative, $_.Length, (Get-Sha256 $_.FullName)
    }
}

Set-Content -LiteralPath "$Run\\state" -Value 'RUNNING' -Encoding ascii
try {
    if ($SmokeKind) { Set-Stage 'smoke'; if ($SmokeKind -eq 'failure') { throw 'intentional smoke failure' }; Set-Stage 'complete'; Set-Content -LiteralPath "$Run\\state" -Value 'SUCCESS' -Encoding ascii; exit 0 }
    $source = (Resolve-Path -LiteralPath (Join-Path $ProjectRoot 'android')).Path
    $snapshot = Join-Path $EnvRoot "snapshots\\$RunId\\android"
    New-Item -ItemType Directory -Force (Split-Path $snapshot), "$EnvRoot\\gradle-home", "$EnvRoot\\tmp" | Out-Null
    Invoke-Native 'snapshot' 'robocopy.exe' @($source, $snapshot, '/MIR', '/XD', 'build', '.gradle', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') $ProjectRoot
    $snapshot = (Resolve-Path -LiteralPath $snapshot).Path
    if ([int](Get-Content -LiteralPath "$Run\\snapshot.exit") -gt 7) { throw 'snapshot failed' }
    Set-Stage 'snapshot-sha256'
    $sourceManifest = @(Get-SourceManifest $source)
    $snapshotManifest = @(Get-SourceManifest $snapshot)
    Set-Content -LiteralPath "$Run\\source.sha256" -Value $sourceManifest -Encoding ascii
    Set-Content -LiteralPath "$Run\\snapshot.sha256" -Value $snapshotManifest -Encoding ascii
    if ([string]::Join("`n", $sourceManifest) -cne [string]::Join("`n", $snapshotManifest)) { throw 'snapshot SHA-256 verification failed' }
    Set-Content -LiteralPath "$Run\\snapshot.verified" -Value 'PASS' -Encoding ascii
    $jdk = Get-Jdk; $sdk = Get-AndroidSdk
    $env:JAVA_HOME = $jdk; $env:Path = "$jdk\\bin;$env:Path"; $env:ANDROID_HOME = $sdk; $env:ANDROID_SDK_ROOT = $sdk
    $env:GRADLE_USER_HOME = "$EnvRoot\\gradle-home"; $env:TEMP = "$EnvRoot\\tmp"; $env:TMP = "$EnvRoot\\tmp"; $env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$EnvRoot\\tmp"
    Invoke-Native 'java-version' (Join-Path $jdk 'bin\\java.exe') @('-version') $snapshot
    $javaText = (Get-Content -LiteralPath "$Run\\java-version.err.log" -Raw) + (Get-Content -LiteralPath "$Run\\java-version.out.log" -Raw)
    if ($javaText -notmatch 'version \"(1[7-9]|[2-9][0-9])') { throw 'JDK is older than 17' }
    $signingNames = @('ORDERS_RELEASE_STORE_FILE', 'ORDERS_RELEASE_STORE_PASS', 'ORDERS_RELEASE_ALIAS', 'ORDERS_RELEASE_KEY_PASS')
    $signingMode = if (@($signingNames | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }).Count -eq 0 -and (Test-Path -LiteralPath $env:ORDERS_RELEASE_STORE_FILE -PathType Leaf)) { 'LOCAL' } else { 'CI_ONLY' }
    Set-Content -LiteralPath "$snapshot\\local.properties" -Value "sdk.dir=$($sdk.Replace([char]92, [char]47).Replace(':', '\:'))" -Encoding ascii
    foreach ($task in @('testDebugUnitTest', 'lintDebug', 'assembleRelease')) { Invoke-Native $task (Join-Path $snapshot 'gradlew.bat') @($task, '--no-daemon', '--console=plain', '--stacktrace') $snapshot }
    $apk = Get-ChildItem -LiteralPath "$snapshot\\app\\build\\outputs\\apk\\release" -Filter '*.apk' -File | Select-Object -First 1
    if (-not $apk) { throw 'release APK is missing' }
    $artifactHash = Get-Sha256 $apk.FullName
    if ($signingMode -eq 'LOCAL') {
        Invoke-Native 'apksigner' (Join-Path $sdk 'build-tools\\36.0.0\\apksigner.bat') @('verify', '--print-certs', $apk.FullName) $snapshot
        $signatureStage = 'apksigner=0'; $state = 'SUCCESS'
    } else {
        $signatureStage = 'SKIPPED_LOCAL_NO_SIGNING_CREDENTIALS'; $state = 'SUCCESS_LOCAL_CI_SIGNING_REQUIRED'
    }
    Set-Stage 'complete'
    $summary = @(
        'snapshot verification=PASS'
        "JDK=$jdk"
        "Android SDK=$sdk"
        "testDebugUnitTest=$(Get-Content -LiteralPath "$Run\\testDebugUnitTest.exit")"
        "lintDebug=$(Get-Content -LiteralPath "$Run\\lintDebug.exit")"
        "assembleRelease=$(Get-Content -LiteralPath "$Run\\assembleRelease.exit")"
        "signing=$signingMode"
        "signature stage=$signatureStage"
        "artifact=$($apk.FullName)"
        "artifact SHA-256=$artifactHash"
    ) -join "`n"
    Set-Content -LiteralPath "$Run\\summary" -Value $summary -Encoding utf8
    Set-Content -LiteralPath "$Run\\state" -Value $state -Encoding ascii
} catch {
    $_ | Out-String | Set-Content -LiteralPath "$Run\\summary" -Encoding utf8
    Set-Content -LiteralPath "$Run\\state" -Value 'FAILED' -Encoding ascii
    exit 1
}
