# CRM-001-HOST host-runtime preflight. Read-only measurement: never enables a
# Windows feature, never starts/stops a service, never creates another
# checkout or .aos bus. Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/aos/preflight-host.ps1
#
# Exit codes (unambiguous, checked by .aos/verify.json):
#   0 = ready      (WSL2 + a registered distro + this exact checkout reachable from Linux
#                    + a healthy container runtime + an isolated no-port smoke check all verified)
#   1 = not-ready  (one or more prerequisites are concretely missing; see missingPrerequisites)
#   2 = error      (a measurement itself failed unexpectedly, e.g. git/wsl.exe not found at all)
[CmdletBinding()]
param(
  [string] $DistroName,
  [string] $OutFile,
  [switch] $SkipSmokeTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$missingPrerequisites = New-Object System.Collections.Generic.List[string]
$notes = New-Object System.Collections.Generic.List[string]

function Add-Missing([string] $Text) { $missingPrerequisites.Add($Text) | Out-Null }
function Add-Note([string] $Text) { $notes.Add($Text) | Out-Null }

# wsl.exe writes UTF-16LE to redirected stdout/stderr regardless of console
# code page; without this, accented text (Spanish WSL messages on this host)
# comes back mangled or replaced with '?'. Scoped to this call only so it
# does not affect any other output the script writes.
# A redirected native stderr line comes back as an ErrorRecord, not a plain
# string; a blank stderr line turns into an ErrorRecord with an empty
# message whose default ToString() falls back to the exception type name
# ("System.Management.Automation.RemoteException"). Extract the real text
# instead of letting that fallback leak into captured output.
function ConvertTo-PlainLine($Item) {
  if ($Item -is [System.Management.Automation.ErrorRecord]) {
    return $Item.Exception.Message
  }
  return $Item.ToString()
}

function Invoke-NativeUnicode {
  param([Parameter(Mandatory)] [string] $Exe, [string[]] $NativeArgs = @())
  # Native stderr lines become terminating errors under the caller's Stop
  # preference once redirected with 2>&1; scope Continue to this call only
  # (PowerShell's preference variables are dynamically scoped per-function).
  $ErrorActionPreference = 'Continue'
  $prevEncoding = [Console]::OutputEncoding
  try {
    [Console]::OutputEncoding = [System.Text.Encoding]::Unicode
    $rawLines = & $Exe @NativeArgs 2>&1
    $code = $LASTEXITCODE
  } finally {
    [Console]::OutputEncoding = $prevEncoding
  }
  $text = (@($rawLines) | ForEach-Object { ConvertTo-PlainLine $_ } | Where-Object { $_.Length -gt 0 }) -join "`n"
  [pscustomobject]@{ ExitCode = $code; Text = $text.Trim() }
}

function Invoke-Native {
  param([Parameter(Mandatory)] [string] $Exe, [string[]] $NativeArgs = @())
  $ErrorActionPreference = 'Continue'
  $rawLines = & $Exe @NativeArgs 2>&1
  $code = $LASTEXITCODE
  $text = (@($rawLines) | ForEach-Object { ConvertTo-PlainLine $_ } | Where-Object { $_.Length -gt 0 }) -join "`n"
  [pscustomobject]@{ ExitCode = $code; Text = $text.Trim() }
}

function Get-InstallStateName([int] $State) {
  switch ($State) {
    1 { 'Enabled' }
    2 { 'Disabled' }
    3 { 'Absent' }
    4 { 'Unknown' }
    default { "Unrecognized($State)" }
  }
}

# Parses `wsl -l -v` table output (locale-dependent header, always 3 columns:
# name / state / version, optionally prefixed with '*' for the default distro).
function ConvertFrom-WslListVerbose {
  param([string] $Text)
  $result = New-Object System.Collections.Generic.List[object]
  if ([string]::IsNullOrWhiteSpace($Text)) { return $result }
  $lines = $Text -split "`n" | Where-Object { $_.Trim().Length -gt 0 }
  foreach ($line in ($lines | Select-Object -Skip 1)) {
    $isDefault = $line.TrimStart().StartsWith('*')
    $clean = $line.TrimStart('*', ' ').Trim()
    $fields = [regex]::Split($clean, '\s{2,}')
    if ($fields.Count -ge 3) {
      $result.Add([pscustomobject]@{
        Name      = $fields[0].Trim()
        State     = $fields[1].Trim()
        Version   = $fields[2].Trim()
        IsDefault = $isDefault
      }) | Out-Null
    }
  }
  return $result
}

$status = 'error'
$result = [ordered]@{}

try {
  # ---- checkout / bus identity (never creates anything) ----
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $windowsHeadSha = (Invoke-Native -Exe 'git' -NativeArgs @('-C', $repoRoot, 'rev-parse', 'HEAD')).Text
  $busPresent = Test-Path (Join-Path $repoRoot '.aos')
  $result.checkout = [ordered]@{
    windowsPath = $repoRoot
    headSha     = $windowsHeadSha
    busPresent  = $busPresent
  }
  if (-not $busPresent) { Add-Missing 'this checkout has no .aos bus at its root; do not create a second one, escalate instead' }

  # ---- OS / elevation ----
  $os = Get-CimInstance -ClassName Win32_OperatingSystem
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  $isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $result.os = [ordered]@{
    caption     = $os.Caption
    version     = [System.Environment]::OSVersion.Version.ToString()
    buildNumber = [int]$os.BuildNumber
    isElevated  = $isElevated
  }
  if ([int]$os.BuildNumber -lt 19041) {
    Add-Missing "Windows build $($os.BuildNumber) is below 19041; wsl --install (single-command path) is not supported, see docs/aos/bootstrap/HOST_RUNTIME.md for the manual path"
  }

  # ---- firmware virtualization / SLAT / DEP (locale-independent CIM properties) ----
  $cpu = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1
  $computerSystem = Get-CimInstance -ClassName Win32_ComputerSystem
  $result.virtualization = [ordered]@{
    firmwareVirtualizationEnabled = [bool]$cpu.VirtualizationFirmwareEnabled
    secondLevelAddressTranslation = [bool]$cpu.SecondLevelAddressTranslationExtensions
    dataExecutionPreventionAvailable = [bool]$os.DataExecutionPrevention_Available
    hypervisorCurrentlyPresent    = [bool]$computerSystem.HypervisorPresent
  }
  if (-not $cpu.VirtualizationFirmwareEnabled) {
    Add-Missing 'CPU virtualization extensions are reported disabled in firmware (BIOS/UEFI); enable them before any WSL2/Hyper-V feature will work'
  }
  if (-not $cpu.SecondLevelAddressTranslationExtensions) {
    Add-Missing 'SLAT (second-level address translation) is reported unavailable; WSL2 requires it'
  }

  # ---- Windows optional features (WMI, no elevation needed to read) ----
  $featureNames = @('VirtualMachinePlatform', 'Microsoft-Windows-Subsystem-Linux')
  $features = [ordered]@{}
  foreach ($name in $featureNames) {
    $feature = Get-CimInstance -ClassName Win32_OptionalFeature -Filter "Name='$name'" -ErrorAction SilentlyContinue
    if ($null -eq $feature) {
      $features[$name] = [ordered]@{ installState = $null; installStateName = 'NotReported' }
      Add-Missing "Windows optional feature '$name' was not reported by WMI; it is very likely not installed"
    } else {
      $state = [int]$feature.InstallState
      $features[$name] = [ordered]@{ installState = $state; installStateName = (Get-InstallStateName $state) }
      if ($state -ne 1) {
        Add-Missing "Windows optional feature '$name' is $(Get-InstallStateName $state) (WMI InstallState=$state), not Enabled; run scripts/aos/install-host-wsl.ps1 phase 1 from an elevated session"
      }
    }
  }
  $result.windowsOptionalFeatures = $features
  Add-Note 'WMI InstallState enum: 1=Enabled, 2=Disabled, 3=Absent, 4=Unknown. A non-1 value is not evidence of WSL readiness even if wsl.exe exists.'

  # ---- wsl.exe real behavior probe (never trusts the mere existence of the binary) ----
  $wslExePath = (Get-Command wsl.exe -ErrorAction SilentlyContinue)
  $wsl = [ordered]@{
    exePresent       = [bool]$wslExePath
    statusExitCode   = $null
    statusMessage    = $null
    installed        = $false
    bootstrapStubOnly = $false
    helpArgumentCount = $null
    distributions    = @()
  }
  if (-not $wslExePath) {
    Add-Missing 'wsl.exe was not found on PATH at all; this Windows build may predate WSL, see docs/aos/bootstrap/HOST_RUNTIME.md'
  } else {
    $statusProbe = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('--status')
    $wsl.statusExitCode = $statusProbe.ExitCode
    $wsl.statusMessage = $statusProbe.Text
    # A working WSL install reports exit 0 from --status with configuration details.
    $wsl.installed = ($statusProbe.ExitCode -eq 0)

    $helpProbe = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('--help')
    $knownArgs = @('--install', '--update', '--status', '--help')
    $matchedKnown = @($knownArgs | Where-Object { $helpProbe.Text -match [regex]::Escape($_) })
    # The pre-install bootstrap shim only recognizes these four arguments and
    # exits 1 on --help; treat anything else (e.g. --distribution, --list) as
    # evidence the full Store-distributed wsl.exe is in place.
    $looksLikeFullCli = ($helpProbe.Text -match '--list' -or $helpProbe.Text -match '--distribution' -or $helpProbe.Text -match '--set-default')
    $wsl.bootstrapStubOnly = (-not $looksLikeFullCli)
    $wsl.helpArgumentCount = $matchedKnown.Count

    if (-not $wsl.installed) {
      Add-Missing "wsl --status exited $($statusProbe.ExitCode) (not installed/configured); run scripts/aos/install-host-wsl.ps1 phase 1 from an elevated session, then reboot"
    }
    if ($wsl.bootstrapStubOnly) {
      Add-Note 'wsl.exe is still the pre-install bootstrap stub (only --install/--update/--status/--help confirmed); flags like --distribution/--no-launch/--list are NOT assumed to work yet'
    } else {
      $listProbe = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('-l', '-v')
      if ($listProbe.ExitCode -eq 0) {
        $distros = ConvertFrom-WslListVerbose -Text $listProbe.Text
        $wsl.distributions = @($distros | ForEach-Object { [ordered]@{ name = $_.Name; state = $_.State; version = $_.Version; isDefault = $_.IsDefault } })
        if ($distros.Count -eq 0) {
          Add-Missing 'WSL is installed but no Linux distribution is registered; run scripts/aos/install-host-wsl.ps1 phase 1 (wsl --install) and complete the one-time interactive user setup'
        }
        $v1 = @($distros | Where-Object { $_.Version -eq '1' })
        if ($v1.Count -gt 0) {
          Add-Note "distribution(s) running WSL1, not WSL2: $(($v1 | ForEach-Object { $_.Name }) -join ', ')"
        }
      } else {
        Add-Missing "wsl --list --verbose exited $($listProbe.ExitCode); cannot enumerate distributions"
      }
    }
  }
  $result.wsl = $wsl

  # ---- resources (informational; this capability does not install CRM dependencies) ----
  $drive = Get-PSDrive -Name ($repoRoot.Substring(0, 1))
  $result.resources = [ordered]@{
    totalMemoryMB = [math]::Round($os.TotalVisibleMemorySize / 1024, 1)
    freeMemoryMB  = [math]::Round($os.FreePhysicalMemory / 1024, 1)
    checkoutDrive = $drive.Name
    freeDiskGB    = [math]::Round($drive.Free / 1GB, 1)
  }

  # ---- Linux access to this exact checkout + container runtime + isolated smoke (only if a usable distro exists) ----
  $targetDistro = $null
  if ($wsl.distributions.Count -gt 0) {
    $preferred = if ($DistroName) { $wsl.distributions | Where-Object { $_.name -eq $DistroName } } else { $null }
    $targetDistro = if ($preferred) { $preferred[0] } elseif ($wsl.distributions.Count -gt 0) { $wsl.distributions[0] } else { $null }
  }

  $linuxAccess = [ordered]@{ attempted = $false }
  $containerRuntime = [ordered]@{ attempted = $false }
  $smokeTest = [ordered]@{ attempted = $false }

  if (-not $targetDistro) {
    $linuxAccess.reason = 'no WSL2 distribution available to run commands in'
    $containerRuntime.reason = 'no WSL2 distribution available'
    $smokeTest.reason = 'no WSL2 distribution available'
  } else {
    $selectedDistro = $targetDistro.name
    $linuxPathProbe = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('-d', $selectedDistro, '--', 'wslpath', '-a', $repoRoot)
    if ($linuxPathProbe.ExitCode -ne 0) {
      $linuxAccess = [ordered]@{ attempted = $true; ok = $false; distro = $selectedDistro; detail = "wslpath translation failed (exit $($linuxPathProbe.ExitCode))" }
      Add-Missing "could not translate the checkout path for Linux via '$selectedDistro'"
    } else {
      $linuxPath = $linuxPathProbe.Text
      $headProbe = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('-d', $selectedDistro, '--', 'git', '-C', $linuxPath, 'rev-parse', 'HEAD')
      $busProbe = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('-d', $selectedDistro, '--', 'test', '-d', "$linuxPath/.aos")
      $shaMatches = ($headProbe.ExitCode -eq 0 -and $headProbe.Text -eq $windowsHeadSha)
      $busReachable = ($busProbe.ExitCode -eq 0)
      $linuxAccess = [ordered]@{
        attempted     = $true
        ok            = ($shaMatches -and $busReachable)
        distro        = $selectedDistro
        linuxPath     = $linuxPath
        headShaMatches = $shaMatches
        busReachable  = $busReachable
      }
      if (-not $shaMatches) { Add-Missing "Linux-side 'git rev-parse HEAD' under '$selectedDistro' does not match the Windows checkout HEAD" }
      if (-not $busReachable) { Add-Missing "Linux-side '$linuxPath/.aos' is not reachable under '$selectedDistro'" }
    }

    $dockerProbe = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('-d', $selectedDistro, '-u', 'root', '--', 'bash', '-lc', 'command -v docker >/dev/null 2>&1 && docker version --format "{{.Server.Version}}" && systemctl is-active docker')
    $dockerOk = ($dockerProbe.ExitCode -eq 0)
    $containerRuntime = [ordered]@{
      attempted = $true
      ok        = $dockerOk
      engine    = 'docker'
      distro    = $selectedDistro
      detail    = $dockerProbe.Text
    }
    if (-not $dockerOk) {
      Add-Missing "Docker Engine is not healthy inside '$selectedDistro' (exit $($dockerProbe.ExitCode)); run scripts/aos/install-host-wsl.ps1 phase 2"
    } elseif ($SkipSmokeTest) {
      $smokeTest.reason = 'skipped by -SkipSmokeTest; readiness cannot be claimed without it'
      Add-Missing 'container runtime smoke test was skipped (-SkipSmokeTest); readiness requires it to actually run'
    } else {
      # Official, tiny, no-port, no-CRM-data smoke image; --rm leaves no container behind.
      $smokeProbe = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('-d', $selectedDistro, '-u', 'root', '--', 'docker', 'run', '--rm', 'hello-world')
      $smokeOk = ($smokeProbe.ExitCode -eq 0 -and $smokeProbe.Text -match 'Hello from Docker!')
      $smokeTest = [ordered]@{
        attempted = $true
        ok        = $smokeOk
        image     = 'hello-world'
        exitCode  = $smokeProbe.ExitCode
        publishedPorts = @()
        cleanup   = '--rm (container auto-removed on exit)'
      }
      if (-not $smokeOk) { Add-Missing "isolated 'docker run --rm hello-world' smoke check failed under '$selectedDistro' (exit $($smokeProbe.ExitCode))" }
    }
  }
  $result.linuxCheckoutAccess = $linuxAccess
  $result.containerRuntime = $containerRuntime
  $result.containerSmokeTest = $smokeTest

  # ---- final verdict ----
  $ready = (
    $busPresent -and
    $wsl.installed -and
    (-not $wsl.bootstrapStubOnly) -and
    $linuxAccess.attempted -and $linuxAccess.ok -and
    $containerRuntime.attempted -and $containerRuntime.ok -and
    $smokeTest.attempted -and $smokeTest.ok
  )
  $status = if ($ready) { 'ready' } else { 'not-ready' }
}
catch {
  $status = 'error'
  Add-Missing "measurement itself failed: $($_.Exception.Message)"
}

$result.status = $status
$result.missingPrerequisites = @($missingPrerequisites)
$result.notes = @($notes)
$result.schemaVersion = 'aos.host-preflight.v1'
$result.generatedAtUtc = [DateTime]::UtcNow.ToString('o')

$json = $result | ConvertTo-Json -Depth 8
Write-Output $json
if ($OutFile) {
  $outDir = Split-Path -Parent $OutFile
  if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
  Set-Content -Path $OutFile -Value $json -Encoding UTF8
}

switch ($status) {
  'ready'     { exit 0 }
  'not-ready' { exit 1 }
  default     { exit 2 }
}
