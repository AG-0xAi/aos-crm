# CRM-001-HOST host-runtime installer. Idempotent, reviewable preparation for
# WSL2 + a supported Linux distribution + Docker Engine (not Docker Desktop).
# Run (phase 2 mutation): pwsh -NoProfile -File scripts/aos/install-host-wsl.ps1 [-WhatIf]
# powershell.exe (Windows PowerShell 5.1) corrupts a literal double quote inside
# a native argument (confirmed live), which the docker-apt-source step needs;
# this script detects that engine before mutating and blocks instead of
# corrupting /etc/apt/sources.list.d/docker.sources. powershell.exe remains
# fine for -SelfTest/-WhatIf/read-only use.
#
# Scope discipline (do not relax without a new dispatch):
#   - Never self-elevates (no Start-Process -Verb RunAs) and never reboots.
#     If Windows feature enablement needs elevation, this prints the exact
#     command and stops; a human runs it in an elevated session.
#   - Never changes the default WSL distribution, never --unregister/--shutdown,
#     never touches a distro other than the one explicitly named for phase 2.
#   - Phase 2 (Docker Engine) runs as the WSL root user (`wsl -u root`), which
#     needs no Linux-side password: WSL grants the controlling Windows session
#     direct root access to its own VM, independent of any interactive Linux
#     user. It does not touch any CRM dependency or image.
#   - Phase 2 never removes a conflicting package or repairs an unhealthy
#     existing Docker install on its own; it reports and blocks instead.
#
# -SelfTest runs isolated unit checks of the pure/encoding-sensitive helpers
# below (no WSL/Linux/elevation needed) and exits 0/1.
[CmdletBinding(SupportsShouldProcess)]
param(
  [string] $DistroName,
  [switch] $Phase1Only,
  [switch] $Phase2Only,
  [switch] $SelfTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function ConvertTo-PlainLine($Item) {
  if ($Item -is [System.Management.Automation.ErrorRecord]) { return $Item.Exception.Message }
  return $Item.ToString()
}

# wsl.exe's own management text (--status/--install/--help/-l -v: no Linux
# process involved) comes back as literal UTF-16LE bytes on redirected
# stdout regardless of console code page (confirmed by Microsoft WSL issue
# #4607 and against this host). Scoped to this call only.
function Invoke-WslSelf {
  param([Parameter(Mandatory)] [string] $Exe, [string[]] $NativeArgs = @())
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

# A command executed INSIDE a distro (wsl.exe -d <distro> -- <linux cmd>)
# forwards that Linux process's own stdout bytes rather than wsl.exe's own
# console text; Linux tools (bash/dpkg/docker/cat) write UTF-8, not
# UTF-16LE. Decoding this stream with Invoke-WslSelf's UTF-16 assumption
# corrupts it (reproduced with a `node` stand-in: exit 0, matches=false).
function Invoke-WslLinux {
  param([Parameter(Mandatory)] [string] $Exe, [string[]] $NativeArgs = @())
  $ErrorActionPreference = 'Continue'
  $prevEncoding = [Console]::OutputEncoding
  try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $rawLines = & $Exe @NativeArgs 2>&1
    $code = $LASTEXITCODE
  } finally {
    [Console]::OutputEncoding = $prevEncoding
  }
  $text = (@($rawLines) | ForEach-Object { ConvertTo-PlainLine $_ } | Where-Object { $_.Length -gt 0 }) -join "`n"
  [pscustomobject]@{ ExitCode = $code; Text = $text.Trim() }
}

function ConvertFrom-WslListVerbose {
  param([string] $Text)
  $result = New-Object System.Collections.Generic.List[object]
  if ([string]::IsNullOrWhiteSpace($Text)) { return $result }
  $lines = $Text -split "`n" | Where-Object { $_.Trim().Length -gt 0 }
  foreach ($line in ($lines | Select-Object -Skip 1)) {
    $clean = $line.TrimStart('*', ' ').Trim()
    $fields = [regex]::Split($clean, '\s{2,}')
    if ($fields.Count -ge 3) {
      $result.Add([pscustomobject]@{ Name = $fields[0].Trim(); State = $fields[1].Trim(); Version = $fields[2].Trim() }) | Out-Null
    }
  }
  return $result
}

# Phase 2 mutates packages/services inside a specific distro; it must never
# guess one. Requires -DistroName explicitly (no auto-pick, not even a WSL2
# default) and validates it is a registered WSL2 distro before any apt/repo
# command runs. Pure function: no process calls, unit-testable in -SelfTest.
function Resolve-MutationDistro {
  param([object[]] $Distributions, [string] $RequestedName)
  # A collection with zero elements collapses to $null when captured (e.g.
  # from ConvertFrom-WslListVerbose on a header-only `wsl -l -v`), and piping
  # $null into Where-Object still runs the predicate once on a null item,
  # which throws under Set-StrictMode (@($null) is a 1-element array
  # containing null, NOT an empty array, so it does not fix this on its own).
  if ($null -eq $Distributions) { $Distributions = @() }
  if (-not $RequestedName) {
    return [ordered]@{ Distro = $null; Error = 'phase 2 mutates packages/services inside a specific distro; -DistroName is required and none was provided (no distro is auto-selected for mutations)' }
  }
  $matched = @($Distributions | Where-Object { $_.Name -eq $RequestedName })
  if ($matched.Count -eq 0) {
    return [ordered]@{ Distro = $null; Error = "requested -DistroName '$RequestedName' is not a registered WSL distribution" }
  }
  if ($matched[0].Version -ne '2') {
    return [ordered]@{ Distro = $null; Error = "requested -DistroName '$RequestedName' is registered but running WSL1, not WSL2" }
  }
  return [ordered]@{ Distro = $matched[0]; Error = $null }
}

# Parses /etc/os-release KEY=VALUE lines (values optionally double-quoted)
# into an ordered map. Pure function, no process involved.
function ConvertFrom-OsRelease {
  param([string] $Text)
  $map = [ordered]@{}
  if ([string]::IsNullOrWhiteSpace($Text)) { return $map }
  foreach ($line in ($Text -split "`n")) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
    $idx = $trimmed.IndexOf('=')
    if ($idx -lt 1) { continue }
    $key = $trimmed.Substring(0, $idx).Trim()
    $value = $trimmed.Substring($idx + 1).Trim()
    if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $map[$key] = $value
  }
  return $map
}

# docs.docker.com/engine/install/ubuntu/ currently (as of this writing) lists
# 22.04/24.04/26.04/26.10 as supported and no longer lists 20.04 (focal). This
# keeps only the subset this installer has actually been exercised against
# (22.04/jammy, 24.04/noble -- the real CRM-001-HOST target); add 26.04/26.10
# here only once verified against docs.docker.com again, not on assumption.
# Update this list (not the check below) when Docker adds or drops a release.
$script:SupportedUbuntuCodenames = @('jammy', 'noble')

# Refuses to run apt/repo steps against anything but a known-supported
# Ubuntu release, checked BEFORE any mutation. Pure function.
function Test-SupportedUbuntuRelease {
  param([System.Collections.Specialized.OrderedDictionary] $OsRelease)
  $id = $OsRelease['ID']
  if ($id -ne 'ubuntu') {
    return [ordered]@{ Supported = $false; Reason = "distro reports ID='$id', not 'ubuntu'; this installer only runs the Ubuntu apt steps from docs.docker.com/engine/install/ubuntu/" }
  }
  $codename = $OsRelease['UBUNTU_CODENAME']
  if (-not $codename) { $codename = $OsRelease['VERSION_CODENAME'] }
  if (-not $codename -or ($script:SupportedUbuntuCodenames -notcontains $codename)) {
    return [ordered]@{ Supported = $false; Reason = "Ubuntu codename '$codename' (VERSION_ID='$($OsRelease['VERSION_ID'])') is not in the supported list ($($script:SupportedUbuntuCodenames -join ', ')); refusing to run apt/repo steps against an unverified release" }
  }
  return [ordered]@{ Supported = $true; Reason = $null }
}

# @(<a Generic.List[object] variable>) throws "Argument types do not match" on
# this host, reproduced live under BOTH pwsh 7 and powershell.exe 5.1 (unrelated
# to Set-StrictMode; a List[string], or a List[object] returned from a function
# and auto-enumerated through the pipeline, are both unaffected -- only wrapping
# the List[object] VARIABLE itself fails). .ToArray() sidesteps it for any
# List[T] without that crash. Pure function: no process calls, unit-testable.
function ConvertTo-PlainArray {
  param([Parameter(Mandatory)] [System.Collections.Generic.List[object]] $List)
  return $List.ToArray()
}

# powershell.exe (Windows PowerShell 5.1, PSEdition 'Desktop') corrupts a
# literal double quote embedded inside a native array argument -- reproduced
# live with `node` as a stand-in: 'printf "Types: deb" "stable" "amd64"' arrives
# at the child process truncated to 'printf Types:', silently dropping the rest.
# pwsh (PSEdition 'Core') passes the same argument through byte-for-byte. The
# docker-apt-source step below builds its apt sources file from a quoted printf
# format string, so running phase 2's mutating steps under Desktop edition would
# silently write a corrupt/truncated /etc/apt/sources.list.d/docker.sources
# instead of failing loudly. Pure function: no process calls, unit-testable.
function Test-NativeQuotingSafe {
  param([string] $Edition, [string] $Script)
  if (-not $Script.Contains('"')) { return $true }
  return ($Edition -eq 'Core')
}

# Classifies the whole run from the two phases' result tokens. Never returns
# 'done' for a failed install command, a block, a skipped/dry-run step, or a
# reboot-pending install -- those must stay distinguishable from genuine
# completion. Deliberately does NOT take a blanket "-WhatIf was passed" flag:
# an early version did, and it downgraded a genuine 'already-satisfied'
# result (nothing was ever going to mutate, -WhatIf or not) to 'planned' just
# because the flag was present -- confirmed wrong with a live -Phase1Only
# -WhatIf run on this host. Every point in the script that actually skips a
# mutation already emits its own 'skipped*'/'planned' token, so trusting the
# tokens alone is both sufficient and more accurate.
# Pure function: feed it synthetic phase results, no process involved.
function Get-OverallInstallStatus {
  param(
    [bool] $Phase1Attempted, [string] $Phase1Result,
    [bool] $Phase2Attempted, [string] $Phase2Result
  )
  $results = @()
  if ($Phase1Attempted -and $Phase1Result) { $results += $Phase1Result }
  if ($Phase2Attempted -and $Phase2Result) { $results += $Phase2Result }

  if ($results.Count -eq 0) { return 'error' }
  if ($results | Where-Object { $_ -like 'install-command-failed*' -or $_ -eq 'install-failed' }) { return 'error' }
  if ($results | Where-Object { $_ -like 'blocked*' }) { return 'blocked' }
  if ($results | Where-Object { $_ -like 'skipped*' -or $_ -eq 'planned' }) { return 'planned' }
  if ($results -contains 'install-command-issued') { return 'reboot-required' }
  return 'done'
}

function Invoke-SelfTest {
  $failures = New-Object System.Collections.Generic.List[string]
  function Assert-True([bool] $Condition, [string] $Label) {
    if ($Condition) { Write-Output "[PASS] self-test: $Label" }
    else { Write-Output "[FAIL] self-test: $Label"; $failures.Add($Label) | Out-Null }
  }

  # ---- encoding split, proven against a real child process (node), no WSL/Linux required ----
  # Built from code points rather than embedded literally: a raw é/ñ in this .ps1
  # source would depend on the file being *read* with the right encoding by
  # whichever engine (pwsh/powershell.exe) loads it, which is exactly the kind of
  # encoding assumption this test exists to not make. [char] construction sidesteps
  # that entirely while still exercising genuinely non-ASCII text, not just hex.
  $eAcute = [char]0x00E9
  $nTilde = [char]0x00F1
  $sample = "headSha=4f9d2ab1c3e07f6a accented:caf${eAcute}-ni${nTilde}o-ma${nTilde}ana"
  $jsUtf8 = 'process.stdout.write(Buffer.from(process.argv[1],''utf8''))'
  $jsUtf16 = 'process.stdout.write(Buffer.from(process.argv[1],''utf16le''))'

  $linuxLike = Invoke-WslLinux -Exe 'node' -NativeArgs @('-e', $jsUtf8, $sample)
  Assert-True ($linuxLike.ExitCode -eq 0 -and $linuxLike.Text -eq $sample) 'Invoke-WslLinux decodes UTF-8 stdout (ASCII+accents+hex) correctly'

  $selfLike = Invoke-WslSelf -Exe 'node' -NativeArgs @('-e', $jsUtf16, $sample)
  Assert-True ($selfLike.ExitCode -eq 0 -and $selfLike.Text -eq $sample) 'Invoke-WslSelf decodes UTF-16LE stdout (ASCII+accents+hex) correctly'

  $wrongFn = Invoke-WslSelf -Exe 'node' -NativeArgs @('-e', $jsUtf8, $sample)
  Assert-True ($wrongFn.Text -ne $sample) 'Invoke-WslSelf on UTF-8 bytes still corrupts (proves the split is load-bearing)'

  # ---- Resolve-MutationDistro, pure ----
  $wsl2 = [pscustomobject]@{ Name = 'Ubuntu'; State = 'Running'; Version = '2' }
  $wsl1 = [pscustomobject]@{ Name = 'OldDistro'; State = 'Running'; Version = '1' }

  $noName = Resolve-MutationDistro -Distributions @($wsl2) -RequestedName ''
  Assert-True ($null -ne $noName.Error -and $null -eq $noName.Distro) 'Resolve-MutationDistro requires an explicit -DistroName (never auto-selects for mutations)'

  $notFound = Resolve-MutationDistro -Distributions @($wsl2) -RequestedName 'Nope'
  Assert-True ($null -ne $notFound.Error -and $null -eq $notFound.Distro) 'Resolve-MutationDistro fails closed on an unregistered name'

  $wrongVer = Resolve-MutationDistro -Distributions @($wsl1) -RequestedName 'OldDistro'
  Assert-True ($null -ne $wrongVer.Error -and $null -eq $wrongVer.Distro) 'Resolve-MutationDistro refuses a WSL1 distro'

  $pickedOk = Resolve-MutationDistro -Distributions @($wsl1, $wsl2) -RequestedName 'Ubuntu'
  Assert-True ($null -eq $pickedOk.Error -and $pickedOk.Distro.Name -eq 'Ubuntu') 'Resolve-MutationDistro accepts the exact requested WSL2 distro among several'

  # A header-only `wsl -l -v` (WSL installed, zero distros registered) makes
  # ConvertFrom-WslListVerbose return an empty collection, which PowerShell
  # collapses to $null when captured; reproduced live against this host and
  # fixed by normalizing with @() inside Resolve-MutationDistro itself.
  $noDistrosAtAll = Resolve-MutationDistro -Distributions $null -RequestedName 'Ubuntu'
  Assert-True ($null -ne $noDistrosAtAll.Error -and $null -eq $noDistrosAtAll.Distro) 'Resolve-MutationDistro fails closed (not a crash) when $Distributions is $null'

  # ---- @() vs .ToArray() on a real Generic.List[object], pure, runs under whichever engine invoked -SelfTest ----
  $syntheticSteps = New-Object System.Collections.Generic.List[object]
  $syntheticSteps.Add([pscustomobject]@{ Name = 'apt-update'; Ok = $true }) | Out-Null
  $syntheticSteps.Add([pscustomobject]@{ Name = 'docker-apt-source'; Ok = $false }) | Out-Null
  $materializedSteps = ConvertTo-PlainArray -List $syntheticSteps
  Assert-True ($materializedSteps.Count -eq 2 -and $materializedSteps[0].Name -eq 'apt-update' -and $materializedSteps[1].Name -eq 'docker-apt-source') "ConvertTo-PlainArray materializes synthetic phase2 steps under $($PSVersionTable.PSEdition) without the @(`$list) 'Argument types do not match' crash (reproduced live on this host under both pwsh and powershell.exe)"

  # ---- native-arg quoting safety gate, pure ----
  Assert-True (Test-NativeQuotingSafe -Edition 'Core' -Script 'apt-get update -y') 'Test-NativeQuotingSafe: a quote-free script is safe under pwsh'
  Assert-True (Test-NativeQuotingSafe -Edition 'Desktop' -Script 'apt-get update -y') 'Test-NativeQuotingSafe: a quote-free script is safe under powershell.exe too (nothing to corrupt)'
  Assert-True (Test-NativeQuotingSafe -Edition 'Core' -Script 'printf "Types: deb" "stable"') 'Test-NativeQuotingSafe: pwsh (Core) is safe even for a quoted script'
  Assert-True (-not (Test-NativeQuotingSafe -Edition 'Desktop' -Script 'printf "Types: deb" "stable"')) 'Test-NativeQuotingSafe: powershell.exe (Desktop) is unsafe for a quoted script (reproduced live: embedded quotes get dropped/truncated)'

  # ---- os-release parsing + supported-release gate, pure ----
  $jammyText = "NAME=`"Ubuntu`"`nID=ubuntu`nVERSION_ID=`"22.04`"`nVERSION_CODENAME=jammy`nUBUNTU_CODENAME=jammy"
  $jammy = ConvertFrom-OsRelease -Text $jammyText
  Assert-True ($jammy['ID'] -eq 'ubuntu' -and $jammy['VERSION_ID'] -eq '22.04') 'ConvertFrom-OsRelease parses quoted and unquoted os-release values'

  $jammySupport = Test-SupportedUbuntuRelease -OsRelease $jammy
  Assert-True $jammySupport.Supported 'Test-SupportedUbuntuRelease accepts a supported Ubuntu release (jammy/22.04)'

  $debianText = "NAME=`"Debian GNU/Linux`"`nID=debian`nVERSION_ID=`"12`""
  $debian = ConvertFrom-OsRelease -Text $debianText
  $debianSupport = Test-SupportedUbuntuRelease -OsRelease $debian
  Assert-True (-not $debianSupport.Supported) 'Test-SupportedUbuntuRelease rejects a non-Ubuntu distro'

  $oldText = "NAME=`"Ubuntu`"`nID=ubuntu`nVERSION_ID=`"16.04`"`nVERSION_CODENAME=xenial`nUBUNTU_CODENAME=xenial"
  $old = ConvertFrom-OsRelease -Text $oldText
  $oldSupport = Test-SupportedUbuntuRelease -OsRelease $old
  Assert-True (-not $oldSupport.Supported) 'Test-SupportedUbuntuRelease rejects an unsupported/EOL Ubuntu codename'

  # ---- final status classifier, pure ----
  $doneCase = Get-OverallInstallStatus -Phase1Attempted $true -Phase1Result 'already-satisfied' -Phase2Attempted $true -Phase2Result 'already-satisfied'
  Assert-True ($doneCase -eq 'done') 'Get-OverallInstallStatus: two already-satisfied phases is done'

  $doneSinglePhaseCase = Get-OverallInstallStatus -Phase1Attempted $true -Phase1Result 'already-satisfied' -Phase2Attempted $false -Phase2Result $null
  Assert-True ($doneSinglePhaseCase -eq 'done') 'Get-OverallInstallStatus: -Phase1Only already-satisfied is done, not downgraded just because -WhatIf was also passed (no mutation was ever pending)'

  $blockedCase = Get-OverallInstallStatus -Phase1Attempted $true -Phase1Result 'blocked-needs-elevation' -Phase2Attempted $true -Phase2Result 'blocked-phase1-incomplete'
  Assert-True ($blockedCase -eq 'blocked') 'Get-OverallInstallStatus: not elevated + phase1 incomplete is blocked, never done'

  $rebootCase = Get-OverallInstallStatus -Phase1Attempted $true -Phase1Result 'install-command-issued' -Phase2Attempted $false -Phase2Result $null
  Assert-True ($rebootCase -eq 'reboot-required') 'Get-OverallInstallStatus: wsl --install issued is reboot-required, never done'

  $errorCase = Get-OverallInstallStatus -Phase1Attempted $true -Phase1Result 'install-command-failed(exit 1)' -Phase2Attempted $false -Phase2Result $null
  Assert-True ($errorCase -eq 'error') 'Get-OverallInstallStatus: a failed install command is error, never done'

  $planCase = Get-OverallInstallStatus -Phase1Attempted $true -Phase1Result 'already-satisfied' -Phase2Attempted $true -Phase2Result 'planned'
  Assert-True ($planCase -eq 'planned') 'Get-OverallInstallStatus: a -WhatIf dry run that actually skipped steps is planned, never done'

  $skippedPhase1Case = Get-OverallInstallStatus -Phase1Attempted $true -Phase1Result 'skipped (-WhatIf)' -Phase2Attempted $false -Phase2Result $null
  Assert-True ($skippedPhase1Case -eq 'planned') 'Get-OverallInstallStatus: phase1 skipped (-WhatIf) is planned, never done'

  $conflictCase = Get-OverallInstallStatus -Phase1Attempted $false -Phase1Result $null -Phase2Attempted $true -Phase2Result 'blocked-conflicting-packages'
  Assert-True ($conflictCase -eq 'blocked') 'Get-OverallInstallStatus: conflicting-packages block is blocked, never done'

  Write-Output ''
  Write-Output "self-test: $(if ($failures.Count -eq 0) { 'ALL PASSED' } else { "$($failures.Count) FAILED" })"
  # Exits here (rather than returning a value): capturing this function's
  # return value would also capture every Write-Output call made inside it,
  # and a non-empty capture array is always truthy regardless of the last
  # element's value.
  if ($failures.Count -eq 0) { exit 0 } else { exit 1 }
}

if ($SelfTest) {
  Invoke-SelfTest
}

# Runs one WSL-as-root step and stops the caller's pipeline (via the returned
# object's Ok=$false) rather than silently continuing past a failure.
function Invoke-WslRootStep {
  param([Parameter(Mandatory)] [string] $Distro, [Parameter(Mandatory)] [string] $Name, [Parameter(Mandatory)] [string] $BashScript)
  if (-not $PSCmdlet.ShouldProcess("wsl:$Distro", "root# $Name")) {
    return [pscustomobject]@{ Name = $Name; Command = $BashScript; ExitCode = $null; Ok = $true; Skipped = $true; Detail = 'skipped (-WhatIf)' }
  }
  $probe = Invoke-WslLinux -Exe 'wsl.exe' -NativeArgs @('-d', $Distro, '-u', 'root', '--', 'bash', '-lc', $BashScript)
  [pscustomobject]@{ Name = $Name; Command = $BashScript; ExitCode = $probe.ExitCode; Ok = ($probe.ExitCode -eq 0); Skipped = $false; Detail = $probe.Text }
}

$report = [ordered]@{
  schemaVersion = 'aos.host-install.v1'
  generatedAtUtc = [DateTime]::UtcNow.ToString('o')
  # 'result' is seeded here (not just added later) so that -Phase1Only /
  # -Phase2Only -- which skip one phase's block entirely -- still leave a
  # 'result' key behind; reading a key an [ordered] hashtable never had
  # throws under Set-StrictMode, confirmed live with -Phase1Only.
  phase1 = [ordered]@{ attempted = $false; result = $null }
  phase2 = [ordered]@{ attempted = $false; result = $null; steps = @() }
  status = 'error'
}

try {
  # ---- Phase 1: Windows WSL feature + default distro (needs elevation) ----
  if (-not $Phase2Only) {
    $report.phase1.attempted = $true
    $statusProbe = Invoke-WslSelf -Exe 'wsl.exe' -NativeArgs @('--status')
    $wslInstalled = ($statusProbe.ExitCode -eq 0)
    $report.phase1.wslAlreadyInstalled = $wslInstalled

    if ($wslInstalled) {
      $report.phase1.result = 'already-satisfied'
      $report.phase1.detail = 'wsl --status exited 0; Windows WSL feature is already enabled, nothing to do'
    } else {
      $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
      $isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
      $report.phase1.isElevated = $isElevated

      if (-not $isElevated) {
        $report.phase1.result = 'blocked-needs-elevation'
        $report.phase1.exactCommand = 'wsl.exe --install'
        $report.phase1.instructions = @(
          'Open an elevated PowerShell (Start menu -> "Windows PowerShell" -> right-click -> "Run as administrator"), or Win+X -> "Terminal (Admin)".',
          'In that elevated session, run: wsl.exe --install',
          'Reboot Windows when prompted (required to finish enabling the WSL / VirtualMachinePlatform optional features). This script never reboots on its own.',
          'After reboot, launch the installed distribution once from the Start menu (e.g. "Ubuntu") to create the Linux username/password interactively. This session does not and should not do that for you.',
          'Re-run scripts/aos/preflight-host.ps1 to confirm readiness, then re-run this script for phase 2 (Docker Engine).'
        )
      } else {
        # Only reached if this session is itself already elevated; never self-elevates.
        if ($PSCmdlet.ShouldProcess('wsl.exe', '--install')) {
          $installProbe = Invoke-WslSelf -Exe 'wsl.exe' -NativeArgs @('--install')
          $report.phase1.installExitCode = $installProbe.ExitCode
          $report.phase1.installOutput = $installProbe.Text
          $report.phase1.result = if ($installProbe.ExitCode -eq 0) { 'install-command-issued' } else { "install-command-failed(exit $($installProbe.ExitCode))" }
          $report.phase1.instructions = @(
            'wsl --install was issued from this elevated session. A reboot is required before WSL is usable; this script will not reboot for you.',
            'After reboot, launch the installed distribution once to create the Linux username/password interactively.',
            'Re-run scripts/aos/preflight-host.ps1, then re-run this script for phase 2.'
          )
        } else {
          $report.phase1.result = 'skipped (-WhatIf)'
        }
      }
    }
  }

  # ---- Phase 2: Docker Engine inside the Linux distro (no Windows elevation needed) ----
  if (-not $Phase1Only) {
    $report.phase2.attempted = $true
    $helpProbe = Invoke-WslSelf -Exe 'wsl.exe' -NativeArgs @('--help')
    $looksLikeFullCli = ($helpProbe.Text -match '--list' -or $helpProbe.Text -match '--distribution' -or $helpProbe.Text -match '--set-default')
    if (-not $looksLikeFullCli) {
      $report.phase2.result = 'blocked-phase1-incomplete'
      $report.phase2.detail = 'wsl.exe is still the pre-install bootstrap stub; complete phase 1 (install + reboot) first'
    } else {
      $listProbe = Invoke-WslSelf -Exe 'wsl.exe' -NativeArgs @('-l', '-v')
      $distros = if ($listProbe.ExitCode -eq 0) { @(ConvertFrom-WslListVerbose -Text $listProbe.Text) } else { @() }
      $resolvedDistro = Resolve-MutationDistro -Distributions $distros -RequestedName $DistroName

      if ($resolvedDistro.Error) {
        $report.phase2.result = 'blocked-distro-invalid'
        $report.phase2.detail = $resolvedDistro.Error
      } else {
        $distro = $resolvedDistro.Distro.Name
        $report.phase2.distro = $distro

        $present = Invoke-WslLinux -Exe 'wsl.exe' -NativeArgs @('-d', $distro, '-u', 'root', '--', 'bash', '-lc', 'command -v docker')
        if ($present.ExitCode -eq 0) {
          # "command -v docker" only proves the binary exists, not that the
          # daemon/service/Compose are healthy; check all three before
          # calling it satisfied, and never attempt to repair an unhealthy
          # existing install here (that needs a separate dispatch).
          $health = Invoke-WslLinux -Exe 'wsl.exe' -NativeArgs @('-d', $distro, '-u', 'root', '--', 'bash', '-lc', 'docker info >/dev/null 2>&1 && systemctl is-active --quiet docker && docker compose version >/dev/null 2>&1 && echo HEALTHY')
          if ($health.ExitCode -eq 0) {
            $report.phase2.result = 'already-satisfied'
            $report.phase2.detail = "docker already present and healthy in '$distro' (binary at $($present.Text))"
          } else {
            $report.phase2.result = 'blocked-existing-docker-unhealthy'
            $report.phase2.detail = "docker binary found in '$distro' at $($present.Text) but the daemon/service/Compose health check failed (exit $($health.ExitCode)); this script does not repair an existing install without a separate dispatch"
          }
        } else {
          # Not present yet: validate the distro's OS release and check for
          # conflicting packages BEFORE any apt/repo mutation runs.
          $osReleaseProbe = Invoke-WslLinux -Exe 'wsl.exe' -NativeArgs @('-d', $distro, '-u', 'root', '--', 'bash', '-lc', 'cat /etc/os-release')
          if ($osReleaseProbe.ExitCode -ne 0) {
            $report.phase2.result = 'blocked-os-release-unreadable'
            $report.phase2.detail = "could not read /etc/os-release inside '$distro' (exit $($osReleaseProbe.ExitCode))"
          } else {
            $osRelease = ConvertFrom-OsRelease -Text $osReleaseProbe.Text
            $supportCheck = Test-SupportedUbuntuRelease -OsRelease $osRelease
            if (-not $supportCheck.Supported) {
              $report.phase2.result = 'blocked-unsupported-os'
              $report.phase2.detail = $supportCheck.Reason
            } else {
              $conflictProbe = Invoke-WslLinux -Exe 'wsl.exe' -NativeArgs @('-d', $distro, '-u', 'root', '--', 'bash', '-lc', 'dpkg --get-selections docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc 2>/dev/null | cut -f1')
              $conflicts = @(($conflictProbe.Text -split "`n") | Where-Object { $_.Trim().Length -gt 0 })
              if ($conflicts.Count -gt 0) {
                $report.phase2.result = 'blocked-conflicting-packages'
                $report.phase2.detail = "conflicting package(s) already installed in '$distro': $($conflicts -join ', '); this script does not remove third-party packages, resolve manually before retrying"
              } else {
                # Mirrors docs.docker.com/engine/install/ubuntu/ (apt repository method) one step
                # at a time so each step's own exit code is recorded; stops at the first real
                # failure. No package removal step and no /home group membership mutation: the
                # distro is already operated as `wsl -u root`, so no new privilege is needed, and
                # repairing/removing anything pre-existing is out of this script's scope.
                $planned = @(
                  @{ Name = 'apt-update'; Script = 'apt-get update -y' },
                  @{ Name = 'apt-install-prereqs'; Script = 'apt-get install -y ca-certificates curl' },
                  @{ Name = 'keyring-dir'; Script = 'install -m 0755 -d /etc/apt/keyrings' },
                  @{ Name = 'docker-gpg-key'; Script = 'curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc' },
                  @{ Name = 'docker-gpg-key-perms'; Script = 'chmod a+r /etc/apt/keyrings/docker.asc' },
                  @{ Name = 'docker-apt-source'; Script = '. /etc/os-release; printf "Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n" "${UBUNTU_CODENAME:-$VERSION_CODENAME}" "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/docker.sources' },
                  @{ Name = 'apt-update-with-docker-repo'; Script = 'apt-get update -y' },
                  @{ Name = 'apt-install-docker-engine'; Script = 'apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin' },
                  @{ Name = 'enable-start-docker'; Script = 'systemctl enable --now docker.service containerd.service' },
                  @{ Name = 'verify-docker-version'; Script = 'docker --version' }
                )

                # Checked over every planned step (not just the one known to need quotes
                # today) and BEFORE the loop starts a single real command, so a run under
                # the wrong engine blocks with zero mutation rather than partially mutating
                # (apt-update/apt-install-prereqs/etc. already run) before reaching the step
                # that would actually corrupt. -WhatIf never executes a native command either
                # way (Invoke-WslRootStep's ShouldProcess check short-circuits first), so it is
                # let through here to still show the plan under either engine.
                $unsafeSteps = @($planned | Where-Object { -not (Test-NativeQuotingSafe -Edition $PSVersionTable.PSEdition -Script $_.Script) })
                if ($unsafeSteps.Count -gt 0 -and -not $WhatIfPreference) {
                  $report.phase2.result = 'blocked-engine-unsafe-quoting'
                  $report.phase2.detail = "running under PSEdition '$($PSVersionTable.PSEdition)' ($($PSVersionTable.PSVersion)); step(s) $(($unsafeSteps | ForEach-Object { $_.Name }) -join ', ') pass a native argument containing a literal double quote, which powershell.exe (Desktop edition) corrupts/truncates instead of passing through (confirmed live with a node stand-in); re-run this phase with pwsh (PowerShell 7+) instead of powershell.exe. No command was executed."
                } else {
                  $steps = New-Object System.Collections.Generic.List[object]
                  $ok = $true
                  foreach ($step in $planned) {
                    if (-not $ok) {
                      $steps.Add([pscustomobject]@{ Name = $step.Name; Command = $step.Script; ExitCode = $null; Ok = $false; Skipped = $true; Detail = 'skipped: earlier step failed' }) | Out-Null
                      continue
                    }
                    $stepResult = Invoke-WslRootStep -Distro $distro -Name $step.Name -BashScript $step.Script
                    $steps.Add($stepResult) | Out-Null
                    if (-not $stepResult.Skipped -and -not $stepResult.Ok) { $ok = $false }
                  }

                  $report.phase2.steps = ConvertTo-PlainArray -List $steps
                  $anySkipped = (@($steps | Where-Object { $_.Skipped })).Count -gt 0
                  if (-not $ok) {
                    $report.phase2.result = 'install-failed'
                    $report.phase2.detail = "a required step failed in '$distro'; see steps for the first failing command/exit code"
                  } elseif ($anySkipped) {
                    $report.phase2.result = 'planned'
                    $report.phase2.detail = "dry run (-WhatIf): no step executed against '$distro'; see steps for what would have run"
                  } else {
                    $report.phase2.result = 'installed'
                    $report.phase2.detail = "Docker Engine installed in '$distro'"
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  $report.status = Get-OverallInstallStatus -Phase1Attempted $report.phase1.attempted -Phase1Result $report.phase1.result -Phase2Attempted $report.phase2.attempted -Phase2Result $report.phase2.result
}
catch {
  $report.status = 'error'
  $report.error = $_.Exception.Message
}

$json = $report | ConvertTo-Json -Depth 8
Write-Output $json

switch ($report.status) {
  'done'  { exit 0 }
  'error' { exit 2 }
  default { exit 1 }  # planned / reboot-required / blocked
}
