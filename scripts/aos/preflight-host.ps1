# CRM-001-HOST host-runtime preflight. Read-only measurement: never enables a
# Windows feature, never starts/stops a service, never creates another
# checkout or .aos bus. Run: powershell -NoProfile -File scripts/aos/preflight-host.ps1
#
# Exit codes (unambiguous, checked by .aos/verify.json):
#   0 = ready      (WSL2 + a registered distro + this exact checkout reachable from Linux
#                    + a healthy container runtime + an isolated no-port smoke check all verified)
#   1 = not-ready  (one or more prerequisites are concretely missing; see missingPrerequisites)
#   2 = error      (a measurement itself failed unexpectedly, e.g. git/wsl.exe not found at all)
#
# -SelfTest runs isolated unit checks of the encoding-sensitive helpers and
# the pure distro-selection logic below, using `node` as a stand-in process
# instead of wsl.exe/Linux, then exits 0/1. It never touches the real host.
[CmdletBinding()]
param(
  [string] $DistroName,
  [string] $OutFile,
  [switch] $SkipSmokeTest,
  [switch] $SelfTest
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

# wsl.exe's own management text (--status/--help/-l -v: no Linux process
# involved) comes back as literal UTF-16LE bytes on redirected stdout
# regardless of console code page (confirmed against this host and by
# Microsoft WSL issue #4607). Scoped to this call only.
function Invoke-WslSelf {
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

# A command executed INSIDE a distro (wsl.exe -d <distro> -- <linux cmd>)
# forwards that Linux process's own stdout bytes rather than wsl.exe's own
# console text; Linux tools (wslpath/git/docker/bash) write UTF-8, not
# UTF-16LE. Decoding this stream with Invoke-WslSelf's UTF-16 assumption
# corrupts it (reproduced with a `node` stand-in: ASCII+accents+a SHA-like
# hex string come back as replacement characters, exit 0, matches=false).
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

function Invoke-Native {
  param([Parameter(Mandatory)] [string] $Exe, [string[]] $NativeArgs = @())
  $ErrorActionPreference = 'Continue'
  $rawLines = & $Exe @NativeArgs 2>&1
  $code = $LASTEXITCODE
  $text = (@($rawLines) | ForEach-Object { ConvertTo-PlainLine $_ } | Where-Object { $_.Length -gt 0 }) -join "`n"
  [pscustomobject]@{ ExitCode = $code; Text = $text.Trim() }
}

# Win32_Processor's VirtualizationFirmwareEnabled/SecondLevelAddressTranslationExtensions
# properties can read back False once Hyper-V's own hypervisor is already layered over the
# CPU -- confirmed live on this host (hypervisorCurrentlyPresent=true while both read
# false) -- so a BIOS/UEFI recommendation built on these two alone is only trustworthy
# while no hypervisor is running yet; a hypervisor already running is stronger evidence
# virtualization works than this CIM read. Pure function: no process calls, unit-testable.
function Test-FirmwareVirtualizationTrustworthy {
  param([bool] $HypervisorPresent)
  return (-not $HypervisorPresent)
}

# VirtualMachinePlatform backs the modern Store-distributed WSL2 stack and is a hard
# prerequisite; the legacy Microsoft-Windows-Subsystem-Linux feature is required only to
# run WSL1 (`wsl --status` asks for it only in that case, confirmed live on this host:
# Linux already runs via WSL2 while this feature reports Disabled), so a disabled state
# there is not evidence WSL2 itself is missing. Pure function: no process calls,
# unit-testable.
function Test-OptionalFeatureRequiredForWsl2 {
  param([string] $FeatureName)
  return ($FeatureName -eq 'VirtualMachinePlatform')
}

# A distro that was asleep is not a distro that is ready. WSL shuts a
# distribution down when its last process exits, and the next command boots it
# again; during that boot `wsl.exe` can print its own warning (measured here:
# "wsl: Failed to start the systemd user session for 'root'") into the Linux
# command's stream, and /mnt/c is not necessarily mounted yet. On 2026-10-28
# that made this preflight report a HEAD mismatch and an unreachable .aos on a
# checkout that matched seconds later.
#
# Pure: turns one `systemctl is-system-running` observation into a decision.
# The exit code alone cannot do it -- 'degraded' (booted, with a failed unit)
# and 'starting' (still booting) are both non-zero -- and the state word can
# arrive next to foreign warning lines, so the known states are matched as
# whole lines instead of by substring. Anything unrecognized or ambiguous is
# 'unknown', which fails closed rather than waiting forever.
function Get-SystemdState {
  param([string] $Text)
  $known = @{
    initializing = 'starting'; starting = 'starting'
    running      = 'settled';  degraded = 'settled'
    maintenance  = 'unusable'; stopping = 'unusable'; offline = 'unusable'
  }
  if ([string]::IsNullOrWhiteSpace($Text)) { return 'unknown' }
  $states = @($Text -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $known.ContainsKey($_) })
  if ($states.Count -ne 1) { return 'unknown' }
  return $known[$states[0]]
}

# Pure: the ONE 40-hex line in a probe's output, or $null. `git rev-parse HEAD`
# prints exactly that and nothing else, so a line-exact match survives
# wsl.exe's warnings being interleaved on the same stream, while a probe that
# printed no sha -- or two different ones -- stays unanswered instead of being
# resolved in the gate's favour.
function Select-Sha1Line {
  param([string] $Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
  # -cmatch, not -match: PowerShell compares case-insensitively by default, and
  # git prints lowercase. Accepting uppercase would accept text no git produced.
  $shaLines = @($Text -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -cmatch '^[0-9a-f]{40}$' })
  if (@($shaLines | Select-Object -Unique).Count -ne 1) { return $null }
  return $shaLines[0]
}

# Waits, under a hard cap, for the distro to finish booting AND for its view of
# this checkout's HEAD to match the Windows one exactly. Still fails closed: a
# distro that never leaves 'starting', a state that cannot be read, or a HEAD
# that never matches all return Ready=false with the reason. $Clock/$Sleep are
# injected so -SelfTest can exercise the real loop without waiting.
function Wait-DistroReady {
  param(
    [Parameter(Mandatory)] [scriptblock] $SystemdProbe,
    [Parameter(Mandatory)] [scriptblock] $HeadProbe,
    [Parameter(Mandatory)] [string] $ExpectedHeadSha,
    [int] $TimeoutMs = 120000,
    [int] $IntervalMs = 3000,
    [scriptblock] $Clock = { [datetime]::UtcNow },
    [scriptblock] $Sleep = { param([int] $Ms) Start-Sleep -Milliseconds $Ms }
  )
  $started = & $Clock
  $attempts = 0
  $state = 'unknown'
  $headSha = $null
  $headExit = $null
  while ($true) {
    $attempts++
    $systemd = & $SystemdProbe
    $state = Get-SystemdState -Text $systemd.Text
    if ($state -eq 'settled') {
      $head = & $HeadProbe
      $headExit = $head.ExitCode
      $headSha = Select-Sha1Line -Text $head.Text
      if ($headExit -eq 0 -and $headSha -eq $ExpectedHeadSha) {
        return [ordered]@{
          Ready = $true; SystemdState = $state; HeadSha = $headSha; HeadExitCode = $headExit
          Attempts = $attempts; WaitedMs = [int]((& $Clock) - $started).TotalMilliseconds; Detail = $null
        }
      }
    }
    $elapsedMs = [int]((& $Clock) - $started).TotalMilliseconds
    $remainingMs = $TimeoutMs - $elapsedMs
    if ($remainingMs -le 0) { break }
    & $Sleep ([math]::Min($IntervalMs, $remainingMs))
  }
  $detail = switch ($state) {
    'starting' { "the distro was still booting (systemctl is-system-running: starting) after $TimeoutMs ms" }
    'settled'  { "the distro finished booting but its 'git rev-parse HEAD' never returned the Windows HEAD exactly once (exit $headExit, sha $(if ($headSha) { $headSha } else { 'unreadable' }))" }
    'unusable' { 'the distro reported a systemd state it cannot run commands in (stopping/offline/maintenance)' }
    default    { 'the distro''s systemd state could not be read at all' }
  }
  return [ordered]@{
    Ready = $false; SystemdState = $state; HeadSha = $headSha; HeadExitCode = $headExit
    Attempts = $attempts; WaitedMs = [int]((& $Clock) - $started).TotalMilliseconds; Detail = $detail
  }
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

# Decides which registered distro (if any) the Linux/container checks below
# run against. Never falls back to another distro when -DistroName was given
# and does not match (previously it did, silently), and never selects a
# WSL1 distro even as a default (WSL1 cannot run Docker Engine/systemd).
# Pure function: no process calls, so it is unit-testable in -SelfTest.
function Resolve-TargetDistro {
  param([object[]] $Distributions, [string] $RequestedName)
  # A collection with zero elements collapses to $null when captured (e.g.
  # from ConvertFrom-WslListVerbose on a header-only `wsl -l -v`), and piping
  # $null into Where-Object still runs the predicate once on a null item,
  # which throws under Set-StrictMode (@($null) is a 1-element array
  # containing null, NOT an empty array, so it does not fix this on its own).
  if ($null -eq $Distributions) { $Distributions = @() }
  if ($RequestedName) {
    $matched = @($Distributions | Where-Object { $_.name -eq $RequestedName })
    if ($matched.Count -eq 0) {
      return [ordered]@{ Distro = $null; Error = "requested -DistroName '$RequestedName' is not a registered WSL distribution; refusing to silently probe another one" }
    }
    if ($matched[0].version -ne '2') {
      return [ordered]@{ Distro = $null; Error = "requested -DistroName '$RequestedName' is registered but running WSL1, not WSL2; upgrade it (wsl --set-version $RequestedName 2) before it can be used" }
    }
    return [ordered]@{ Distro = $matched[0]; Error = $null }
  }
  $wsl2 = @($Distributions | Where-Object { $_.version -eq '2' })
  if ($wsl2.Count -eq 0) {
    return [ordered]@{ Distro = $null; Error = 'no WSL2 distribution is registered (only WSL1, if any); a WSL2 distro is required to measure Linux/container readiness' }
  }
  return [ordered]@{ Distro = $wsl2[0]; Error = $null }
}

function Invoke-SelfTest {
  $failures = New-Object System.Collections.Generic.List[string]
  function Assert-True([bool] $Condition, [string] $Label) {
    if ($Condition) { Write-Output "[PASS] self-test: $Label" }
    else { Write-Output "[FAIL] self-test: $Label"; $failures.Add($Label) | Out-Null }
  }

  # ---- encoding split, proven against a real child process (node), no WSL/Linux required ----
  # Built from code points rather than embedded literally: a raw é/ñ in this .ps1 source
  # would depend on the file being *read* with the right encoding by whichever engine
  # (pwsh/powershell.exe) loads it, which is exactly the kind of encoding assumption this
  # test exists to not make. [char] construction sidesteps that while still exercising
  # genuinely non-ASCII text, not just hex.
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
  Assert-True ($wrongFn.Text -ne $sample) 'Invoke-WslSelf on UTF-8 bytes still corrupts (proves the split is load-bearing, guards against collapsing it back)'

  # ---- Resolve-TargetDistro, pure, no process involved ----
  $wsl2Distro = [ordered]@{ name = 'Ubuntu'; state = 'Running'; version = '2'; isDefault = $true }
  $wsl1Distro = [ordered]@{ name = 'OldDistro'; state = 'Running'; version = '1'; isDefault = $false }

  $noName = Resolve-TargetDistro -Distributions @($wsl2Distro) -RequestedName ''
  Assert-True ($null -eq $noName.Error -and $noName.Distro.name -eq 'Ubuntu') 'Resolve-TargetDistro auto-picks the only WSL2 distro when no name requested'

  $onlyWsl1 = Resolve-TargetDistro -Distributions @($wsl1Distro) -RequestedName ''
  Assert-True ($null -ne $onlyWsl1.Error -and $null -eq $onlyWsl1.Distro) 'Resolve-TargetDistro refuses to auto-pick a WSL1-only distro'

  $missingName = Resolve-TargetDistro -Distributions @($wsl2Distro) -RequestedName 'DoesNotExist'
  Assert-True ($null -ne $missingName.Error -and $null -eq $missingName.Distro) 'Resolve-TargetDistro fails closed when the requested -DistroName is not registered (no silent fallback)'

  $wrongVersion = Resolve-TargetDistro -Distributions @($wsl1Distro) -RequestedName 'OldDistro'
  Assert-True ($null -ne $wrongVersion.Error -and $null -eq $wrongVersion.Distro) 'Resolve-TargetDistro fails closed when the requested distro is WSL1'

  $exactMatch = Resolve-TargetDistro -Distributions @($wsl1Distro, $wsl2Distro) -RequestedName 'Ubuntu'
  Assert-True ($null -eq $exactMatch.Error -and $exactMatch.Distro.name -eq 'Ubuntu') 'Resolve-TargetDistro picks the exact requested WSL2 distro among several'

  # A header-only `wsl -l -v` (WSL installed, zero distros registered) makes
  # ConvertFrom-WslListVerbose return an empty collection, which PowerShell
  # collapses to $null when captured; reproduced live against this host and
  # fixed by normalizing with @() inside Resolve-TargetDistro itself.
  $noDistrosAtAll = Resolve-TargetDistro -Distributions $null -RequestedName ''
  Assert-True ($null -ne $noDistrosAtAll.Error -and $null -eq $noDistrosAtAll.Distro) 'Resolve-TargetDistro fails closed (not a crash) when $Distributions is $null'

  # ---- firmware-virtualization trust gate + WSL1-vs-WSL2 feature requirement, pure ----
  Assert-True (Test-FirmwareVirtualizationTrustworthy -HypervisorPresent $false) 'Test-FirmwareVirtualizationTrustworthy: trusts the CIM read when no hypervisor is running yet'
  Assert-True (-not (Test-FirmwareVirtualizationTrustworthy -HypervisorPresent $true)) 'Test-FirmwareVirtualizationTrustworthy: distrusts the CIM read once a hypervisor is already active (reproduced live on this host: HypervisorPresent=true while the CIM bits read false)'

  # ---- cold-distro readiness (CRM-004 fix3), pure + injected clock: no WSL, no sleeping ----
  # The exact line wsl.exe mixed into the Linux command's stream on 2026-10-28
  # while the idled-out distro was booting.
  # Script-scoped on purpose: these fixtures are read from inside the probe
  # scriptblocks below, which run in a child scope of Wait-DistroReady, and a
  # plain local would be shadowed by that function's own same-named locals.
  $script:wslBootWarning = "wsl: Failed to start the systemd user session for 'root'"
  $script:fixtureHeadSha = '6e0d50b661cbf7911cc0c058039456328531f836'
  $wslBootWarning = $script:wslBootWarning
  $headSha = $script:fixtureHeadSha

  Assert-True ((Get-SystemdState -Text "$wslBootWarning`nstarting") -eq 'starting') 'Get-SystemdState: a booting distro is "starting" even with wsl.exe''s own warning on the same stream (the measured contamination)'
  Assert-True ((Get-SystemdState -Text "$wslBootWarning`nrunning") -eq 'settled') 'Get-SystemdState: a booted distro is "settled" with the same warning present'
  Assert-True ((Get-SystemdState -Text 'degraded') -eq 'settled') 'Get-SystemdState: "degraded" is booted (a failed unit is not a boot in progress)'
  Assert-True ((Get-SystemdState -Text 'offline') -eq 'unusable') 'Get-SystemdState: "offline" is not something to wait for'
  Assert-True ((Get-SystemdState -Text $wslBootWarning) -eq 'unknown') 'Get-SystemdState: output with no state word at all fails closed as "unknown"'
  Assert-True ((Get-SystemdState -Text '') -eq 'unknown') 'Get-SystemdState: empty output fails closed as "unknown"'
  Assert-True ((Get-SystemdState -Text "starting`nrunning") -eq 'unknown') 'Get-SystemdState: two contradictory state lines are ambiguous, not resolved in the gate''s favour'

  Assert-True ((Select-Sha1Line -Text "$wslBootWarning`n$headSha") -eq $headSha) 'Select-Sha1Line: the exact 40-hex HEAD survives wsl.exe''s warning on the same stream (the measured false mismatch)'
  Assert-True ((Select-Sha1Line -Text "$headSha`n$wslBootWarning") -eq $headSha) 'Select-Sha1Line: order does not matter'
  Assert-True ($null -eq (Select-Sha1Line -Text $wslBootWarning)) 'Select-Sha1Line: output with no sha at all stays unanswered'
  Assert-True ($null -eq (Select-Sha1Line -Text "$headSha`n$('b' * 40)")) 'Select-Sha1Line: two DIFFERENT shas are ambiguous and rejected'
  Assert-True ((Select-Sha1Line -Text "$headSha`n$headSha") -eq $headSha) 'Select-Sha1Line: the same sha echoed twice is still one answer'
  Assert-True ($null -eq (Select-Sha1Line -Text ('a' * 39))) 'Select-Sha1Line: a 39-character string is not a sha'
  Assert-True ($null -eq (Select-Sha1Line -Text ('A' * 40))) 'Select-Sha1Line: uppercase hex is not what git prints, so it is not accepted'
  Assert-True ($null -eq (Select-Sha1Line -Text "fatal: not a git repository`n")) 'Select-Sha1Line: a git error is not a sha'

  # A fake clock advanced by the injected sleep: the real loop runs, nothing waits.
  $script:fakeNow = [datetime]::new(2026, 10, 28, 20, 0, 0, [System.DateTimeKind]::Utc)
  $clock = { $script:fakeNow }
  $sleep = { param([int] $Ms) $script:fakeNow = $script:fakeNow.AddMilliseconds($Ms) }

  # The measured sequence: the first probe catches the distro booting (warning
  # in the stream, no usable HEAD), a later one agrees.
  $script:probeCount = 0
  $coldStart = Wait-DistroReady -ExpectedHeadSha $headSha -TimeoutMs 120000 -IntervalMs 3000 -Clock $clock -Sleep $sleep `
    -SystemdProbe {
      $script:probeCount++
      if ($script:probeCount -le 2) { [pscustomobject]@{ ExitCode = 1; Text = "$script:wslBootWarning`nstarting" } }
      else { [pscustomobject]@{ ExitCode = 0; Text = "$script:wslBootWarning`nrunning" } }
    } `
    -HeadProbe { [pscustomobject]@{ ExitCode = 0; Text = "$($script:wslBootWarning)`n$($script:fixtureHeadSha)" } }
  Assert-True ($coldStart.Ready -and $coldStart.HeadSha -eq $headSha) 'Wait-DistroReady: a distro caught mid-boot is waited out and then measured correctly (the exact 17:48 UTC failure)'
  Assert-True ($coldStart.Attempts -eq 3 -and $coldStart.WaitedMs -le 120000) 'Wait-DistroReady: it re-probed instead of giving up, inside the 120 s cap'

  $neverBoots = Wait-DistroReady -ExpectedHeadSha $headSha -TimeoutMs 120000 -IntervalMs 3000 -Clock $clock -Sleep $sleep `
    -SystemdProbe { [pscustomobject]@{ ExitCode = 1; Text = 'starting' } } `
    -HeadProbe { throw 'the HEAD probe must not run while the distro is still booting' }
  Assert-True (-not $neverBoots.Ready) 'Wait-DistroReady: a distro that never finishes booting still FAILS CLOSED'
  Assert-True ($neverBoots.WaitedMs -le 120000 -and $neverBoots.Attempts -gt 1) 'Wait-DistroReady: that failure is bounded by the cap, not an infinite wait'
  Assert-True ($neverBoots.Detail -match 'still booting') 'Wait-DistroReady: the reason says the distro was still booting, instead of blaming the checkout'

  $wrongHead = Wait-DistroReady -ExpectedHeadSha $headSha -TimeoutMs 30000 -IntervalMs 3000 -Clock $clock -Sleep $sleep `
    -SystemdProbe { [pscustomobject]@{ ExitCode = 0; Text = 'running' } } `
    -HeadProbe { [pscustomobject]@{ ExitCode = 0; Text = ('c' * 40) } }
  Assert-True (-not $wrongHead.Ready) 'Wait-DistroReady: a genuinely different Linux-side HEAD is still a failure after the wait (the wait does not launder a real mismatch)'

  $unreadableState = Wait-DistroReady -ExpectedHeadSha $headSha -TimeoutMs 9000 -IntervalMs 3000 -Clock $clock -Sleep $sleep `
    -SystemdProbe { [pscustomobject]@{ ExitCode = 127; Text = 'systemctl: not found' } } `
    -HeadProbe { [pscustomobject]@{ ExitCode = 0; Text = $headSha } }
  Assert-True (-not $unreadableState.Ready -and $unreadableState.SystemdState -eq 'unknown') 'Wait-DistroReady: a systemd state that cannot be read fails closed instead of assuming readiness'

  Assert-True (Test-OptionalFeatureRequiredForWsl2 -FeatureName 'VirtualMachinePlatform') 'Test-OptionalFeatureRequiredForWsl2: VirtualMachinePlatform is a hard WSL2 prerequisite'
  Assert-True (-not (Test-OptionalFeatureRequiredForWsl2 -FeatureName 'Microsoft-Windows-Subsystem-Linux')) 'Test-OptionalFeatureRequiredForWsl2: the legacy WSL1 feature is not a WSL2 prerequisite (reproduced live on this host: Linux already runs via WSL2 while this feature reports Disabled)'

  Write-Output ''
  Write-Output "self-test: $(if ($failures.Count -eq 0) { 'ALL PASSED' } else { "$($failures.Count) FAILED" })"
  # Exits here (rather than returning a value) so the PASS/FAIL lines above
  # stream straight to stdout: capturing this function's return value would
  # also capture every Write-Output call made inside it, and a non-empty
  # capture array is always truthy regardless of the last element's value.
  if ($failures.Count -eq 0) { exit 0 } else { exit 1 }
}

if ($SelfTest) {
  Invoke-SelfTest
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
  $hypervisorPresent = [bool]$computerSystem.HypervisorPresent
  $result.virtualization = [ordered]@{
    firmwareVirtualizationEnabled = [bool]$cpu.VirtualizationFirmwareEnabled
    secondLevelAddressTranslation = [bool]$cpu.SecondLevelAddressTranslationExtensions
    dataExecutionPreventionAvailable = [bool]$os.DataExecutionPrevention_Available
    hypervisorCurrentlyPresent    = $hypervisorPresent
  }
  if (Test-FirmwareVirtualizationTrustworthy -HypervisorPresent $hypervisorPresent) {
    if (-not $cpu.VirtualizationFirmwareEnabled) {
      Add-Missing 'CPU virtualization extensions are reported disabled in firmware (BIOS/UEFI); enable them before any WSL2/Hyper-V feature will work'
    }
    if (-not $cpu.SecondLevelAddressTranslationExtensions) {
      Add-Missing 'SLAT (second-level address translation) is reported unavailable; WSL2 requires it'
    }
  } elseif (-not $cpu.VirtualizationFirmwareEnabled -or -not $cpu.SecondLevelAddressTranslationExtensions) {
    Add-Note 'firmwareVirtualizationEnabled/secondLevelAddressTranslation report false, but a hypervisor is already running (hypervisorCurrentlyPresent=true); this is a known CIM read artifact once Hyper-V is active, not evidence of a BIOS/UEFI problem -- a running hypervisor is stronger proof virtualization already works than this CIM read'
  }

  # ---- Windows optional features (WMI, no elevation needed to read) ----
  $featureNames = @('VirtualMachinePlatform', 'Microsoft-Windows-Subsystem-Linux')
  $features = [ordered]@{}
  foreach ($name in $featureNames) {
    $requiredForWsl2 = Test-OptionalFeatureRequiredForWsl2 -FeatureName $name
    $feature = Get-CimInstance -ClassName Win32_OptionalFeature -Filter "Name='$name'" -ErrorAction SilentlyContinue
    if ($null -eq $feature) {
      $features[$name] = [ordered]@{ installState = $null; installStateName = 'NotReported' }
      if ($requiredForWsl2) {
        Add-Missing "Windows optional feature '$name' was not reported by WMI; it is very likely not installed"
      }
    } else {
      $state = [int]$feature.InstallState
      $features[$name] = [ordered]@{ installState = $state; installStateName = (Get-InstallStateName $state) }
      if ($requiredForWsl2 -and $state -ne 1) {
        Add-Missing "Windows optional feature '$name' is $(Get-InstallStateName $state) (WMI InstallState=$state), not Enabled; run scripts/aos/install-host-wsl.ps1 phase 1 from an elevated session"
      } elseif (-not $requiredForWsl2 -and $state -ne 1) {
        Add-Note "Windows optional feature '$name' is $(Get-InstallStateName $state) (WMI InstallState=$state); this is the legacy WSL1-only feature (wsl --status requires it only to run WSL1), not evidence that the modern Store-distributed WSL2 is missing -- not treated as a missing prerequisite"
      }
    }
  }
  $result.windowsOptionalFeatures = $features
  Add-Note 'WMI InstallState enum: 1=Enabled, 2=Disabled, 3=Absent, 4=Unknown. A non-1 value for VirtualMachinePlatform is not by itself evidence of WSL2 readiness even if wsl.exe exists.'

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
    $statusProbe = Invoke-WslSelf -Exe 'wsl.exe' -NativeArgs @('--status')
    $wsl.statusExitCode = $statusProbe.ExitCode
    $wsl.statusMessage = $statusProbe.Text
    # A working WSL install reports exit 0 from --status with configuration details.
    $wsl.installed = ($statusProbe.ExitCode -eq 0)

    $helpProbe = Invoke-WslSelf -Exe 'wsl.exe' -NativeArgs @('--help')
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
      $listProbe = Invoke-WslSelf -Exe 'wsl.exe' -NativeArgs @('-l', '-v')
      if ($listProbe.ExitCode -eq 0) {
        $distros = @(ConvertFrom-WslListVerbose -Text $listProbe.Text)
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
    $resolvedDistro = Resolve-TargetDistro -Distributions $wsl.distributions -RequestedName $DistroName
    if ($resolvedDistro.Error) {
      Add-Missing $resolvedDistro.Error
    } else {
      $targetDistro = $resolvedDistro.Distro
    }
  } elseif ($DistroName) {
    Add-Missing "requested -DistroName '$DistroName' cannot be used: no WSL distribution is registered at all"
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
    # `--` runs the trailing command through the distro's default-shell hop,
    # which re-parses it a second time; `--exec` execs the named program
    # directly with its argv, so a Windows path survives as a literal argv
    # element with no bash -lc / quoting hack needed at all (confirmed live
    # on this host: `wsl -d <distro> --exec wslpath -a 'C:\Users\x'` round-trips
    # the path byte for byte, backslashes and accents included).
    $linuxPathProbe = Invoke-WslLinux -Exe 'wsl.exe' -NativeArgs @('-d', $selectedDistro, '--exec', 'wslpath', '-a', $repoRoot)
    if ($linuxPathProbe.ExitCode -ne 0) {
      $linuxAccess = [ordered]@{ attempted = $true; ok = $false; distro = $selectedDistro; detail = "wslpath translation failed (exit $($linuxPathProbe.ExitCode))" }
      Add-Missing "could not translate the checkout path for Linux via '$selectedDistro'"
    } else {
      $linuxPath = $linuxPathProbe.Text
      # Bounded wait first (see Wait-DistroReady): a distro that idled out and
      # is mid-boot answers these two probes wrongly, and that is a measurement
      # artifact, not a host that is not ready. The cap keeps it fail-closed.
      $readiness = Wait-DistroReady -ExpectedHeadSha $windowsHeadSha `
        -SystemdProbe { Invoke-WslLinux -Exe 'wsl.exe' -NativeArgs @('-d', $selectedDistro, '-u', 'root', '--exec', 'systemctl', 'is-system-running') } `
        -HeadProbe { Invoke-WslLinux -Exe 'wsl.exe' -NativeArgs @('-d', $selectedDistro, '--exec', 'git', '-C', $linuxPath, 'rev-parse', 'HEAD') }
      $shaMatches = $readiness.Ready
      # Not measured at all when the distro never became ready: reporting a
      # false here would blame the bus for a distro that was still booting.
      $busReachable = if ($shaMatches) {
        (Invoke-WslLinux -Exe 'wsl.exe' -NativeArgs @('-d', $selectedDistro, '--exec', 'test', '-d', "$linuxPath/.aos")).ExitCode -eq 0
      } else { $null }
      $linuxAccess = [ordered]@{
        attempted         = $true
        ok                = ($shaMatches -and $busReachable -eq $true)
        distro            = $selectedDistro
        linuxPath         = $linuxPath
        headShaMatches    = $shaMatches
        busReachable      = $busReachable
        systemdState      = $readiness.SystemdState
        readinessAttempts = $readiness.Attempts
        readinessWaitMs   = $readiness.WaitedMs
      }
      if ($readiness.Attempts -gt 1) {
        Add-Note "the distro was not ready on the first probe; waited $($readiness.WaitedMs) ms over $($readiness.Attempts) attempts for systemd to leave 'starting' and for the Linux-side HEAD to match (WSL shuts a distro down when its last process exits, so a cold distro is normal, not a fault)"
      }
      if (-not $shaMatches) { Add-Missing "Linux-side 'git rev-parse HEAD' under '$selectedDistro' does not match the Windows checkout HEAD: $($readiness.Detail)" }
      if ($shaMatches -and $busReachable -ne $true) { Add-Missing "Linux-side '$linuxPath/.aos' is not reachable under '$selectedDistro'" }
    }

    $dockerProbe = Invoke-WslLinux -Exe 'wsl.exe' -NativeArgs @('-d', $selectedDistro, '-u', 'root', '--exec', 'bash', '-lc', 'command -v docker >/dev/null 2>&1 && docker version --format "{{.Server.Version}}" && systemctl is-active docker')
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
      $smokeProbe = Invoke-WslLinux -Exe 'wsl.exe' -NativeArgs @('-d', $selectedDistro, '-u', 'root', '--exec', 'docker', 'run', '--rm', 'hello-world')
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
