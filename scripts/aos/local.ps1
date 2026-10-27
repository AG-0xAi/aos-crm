#Requires -Version 7.0
# AOS-CRM local profile orchestrator (CRM-002). Never builds/starts anything
# on its own: Start/Restart run a fail-closed gate (host, the real local
# verifiers -- scripts/aos/verify-local-config.mjs and, once CRM-003 ships it,
# scripts/aos/verify-privacy.mjs -- secrets, loopback port) BEFORE any
# `docker compose build`/`up`, and every docker invocation crosses into the
# dedicated WSL distro with --exec (literal argv; see
# docs/aos/bootstrap/HOST_RUNTIME.md for why `--` is not used here) so this
# script never needs Docker on the Windows host.
#
# Usage: pwsh -NoProfile -File scripts/aos/local.ps1 -Action <Status|Prepare|Start|Stop|Restart|Logs>
# Self-test (isolated tmp fixtures; never touches deploy/local, WSL or Docker):
#   pwsh -NoProfile -File scripts/aos/local.ps1 -SelfTest
#
# Exit codes: 0 = action completed / self-test passed; 1 = fail-closed gate
# blocked the action, or self-test failed; 2 = a measurement itself errored.
[CmdletBinding()]
param(
  [ValidateSet('Status', 'Prepare', 'Start', 'Stop', 'Restart', 'Logs')]
  [string] $Action = 'Status',
  [string] $Distro = 'AOS-CRM-Ubuntu-24.04',
  [switch] $Follow,
  [switch] $SelfTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RequiredPrivacyKeys = [ordered]@{
  TELEMETRY_ENABLED                      = 'false'
  ANALYTICS_ENABLED                      = 'false'
  MARKETPLACE_CATALOG_SYNC_CRON_ENABLED  = 'false'
  IS_CONFIG_VARIABLES_IN_DB_ENABLED      = 'false'
}
$RequiredEnvKeys = @('AOS_CRM_IMAGE_TAG', 'AOS_CRM_PG_PASSWORD', 'AOS_CRM_ENCRYPTION_KEY')
$ProjectName = 'aos-crm-local'
$ComposeRelPath = 'deploy/local/compose.yaml'
$DefaultWebPort = 43000

# ---------------------------------------------------------------------------
# Pure helpers: take explicit paths/values so -SelfTest can exercise them
# against isolated fixtures instead of the real checkout.
# ---------------------------------------------------------------------------

function Test-PortFree {
  param([int] $Port, [string] $BindAddress = '127.0.0.1')
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse($BindAddress), $Port)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) { $listener.Stop() }
  }
}

function New-CryptoToken {
  param([ValidateSet('Hex', 'Base64')][string] $Encoding, [int] $Bytes = 32)
  $buffer = [byte[]]::new($Bytes)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  if ($Encoding -eq 'Hex') {
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
  }
  return [Convert]::ToBase64String($buffer)
}

# Reads a KEY=value env-style file and returns booleans/categories only:
# never the values it read. Lines without '=' or starting with '#' are
# skipped; a key present more than once keeps the last occurrence, matching
# how env_file/dotenv loaders resolve duplicates.
function Read-EnvKeys {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $found = @{}
  foreach ($line in Get-Content -LiteralPath $Path -ErrorAction Stop) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $parts = $line -split '=', 2
    $key = $parts[0].Trim()
    if ($key -eq '') { continue }
    $found[$key] = $parts[1].Trim()
  }
  return $found
}

# Required-exact-value contract check (used for privacy.env). Returns
# booleans/category lists only.
function Test-RequiredExactKeys {
  param([string] $Path, [System.Collections.Specialized.OrderedDictionary] $Required)
  $found = Read-EnvKeys -Path $Path
  if ($null -eq $found) {
    return [ordered]@{ Exists = $false; MissingKeys = @($Required.Keys); WrongValueKeys = @() }
  }
  $missing = [System.Collections.Generic.List[string]]::new()
  $wrong = [System.Collections.Generic.List[string]]::new()
  foreach ($key in $Required.Keys) {
    if (-not $found.ContainsKey($key)) { $missing.Add($key); continue }
    if ($found[$key] -ne $Required[$key]) { $wrong.Add($key) }
  }
  return [ordered]@{ Exists = $true; MissingKeys = @($missing); WrongValueKeys = @($wrong) }
}

# Required-present-and-non-placeholder check (used for deploy/local/.env,
# whose values are random per-install secrets, not fixed contract values).
function Test-RequiredPresentKeys {
  param([string] $Path, [string[]] $RequiredKeys, [string[]] $RejectedPlaceholders)
  $found = Read-EnvKeys -Path $Path
  if ($null -eq $found) {
    return [ordered]@{ Exists = $false; MissingKeys = @($RequiredKeys); PlaceholderKeys = @() }
  }
  $missing = [System.Collections.Generic.List[string]]::new()
  $placeholder = [System.Collections.Generic.List[string]]::new()
  foreach ($key in $RequiredKeys) {
    if (-not $found.ContainsKey($key) -or $found[$key] -eq '') { $missing.Add($key); continue }
    if ($RejectedPlaceholders -contains $found[$key]) { $placeholder.Add($key) }
  }
  return [ordered]@{ Exists = $true; MissingKeys = @($missing); PlaceholderKeys = @($placeholder) }
}

# Resolves the loopback port to gate/use: whatever deploy/local/.env sets for
# AOS_CRM_WEB_PORT, falling back to $DefaultPort only when the file is absent
# or the key is missing. Never hardcodes 43000 over a real value. An explicit
# but invalid value (unparseable or outside 1-65535) is NOT silently treated
# as "absent" -- it is reported via Valid=$false so the gate fails closed
# instead of quietly running on the wrong port; Port still carries the
# fallback so a caller always has a concrete int to probe/display.
function Get-ConfiguredWebPort {
  param([string] $EnvPath, [int] $DefaultPort)
  $found = Read-EnvKeys -Path $EnvPath
  if ($null -eq $found -or -not $found.ContainsKey('AOS_CRM_WEB_PORT') -or [string]::IsNullOrWhiteSpace($found['AOS_CRM_WEB_PORT'])) {
    return [ordered]@{ Port = $DefaultPort; Valid = $true }
  }
  $parsed = 0
  if ([int]::TryParse($found['AOS_CRM_WEB_PORT'], [ref] $parsed) -and $parsed -gt 0 -and $parsed -le 65535) {
    return [ordered]@{ Port = $parsed; Valid = $true }
  }
  return [ordered]@{ Port = $DefaultPort; Valid = $false }
}

# AOS_CRM_SERVER_URL, when set, must agree with the resolved loopback port;
# an unset URL is not a contradiction (compose.yaml's own default applies).
function Test-WebPortUrlCoherent {
  param([int] $Port, [string] $ServerUrl)
  if ([string]::IsNullOrWhiteSpace($ServerUrl)) { return $true }
  return $ServerUrl -eq "http://127.0.0.1:$Port"
}

# A bind-test alone cannot tell a foreign listener from this project's own
# server container (WSL2 forwards both onto the same Windows loopback port).
# Get-PortOccupancy turns the two independent I/O results (a raw bind probe,
# a `docker compose ps` ownership check) into one classification so the gate
# never confuses "I am already running" with "something else is in the way".
function Get-PortOccupancy {
  param([bool] $PortFree, [bool] $OwnServerRunning)
  if ($PortFree) { return 'Free' }
  if ($OwnServerRunning) { return 'OwnedBySelf' }
  return 'OccupiedByOther'
}

# Decides -- from the parsed `docker compose ps --format json` output alone
# -- whether THIS project's own `server` service is the one actually bound,
# on loopback, to $ConfiguredPort. A Service=='server' match by itself is not
# enough: if AOS_CRM_WEB_PORT changes to a port some OTHER process already
# occupies, the still-running `server` container from the OLD port is still
# named 'server' but does not own the new port -- only its own Publishers
# entry (URL + PublishedPort) proves ownership of a specific port.
function Test-ServerOwnsPublishedPort {
  param([string] $PsJsonOutput, [int] $ConfiguredPort, [string] $ServiceName = 'server', [string] $BindAddress = '127.0.0.1')
  if ([string]::IsNullOrWhiteSpace($PsJsonOutput)) { return $false }
  foreach ($line in ($PsJsonOutput -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try { $entry = $line | ConvertFrom-Json -ErrorAction Stop } catch { continue }
    $serviceProp = $entry.PSObject.Properties | Where-Object { $_.Name -ieq 'Service' } | Select-Object -First 1
    if (-not $serviceProp -or $serviceProp.Value -ne $ServiceName) { continue }
    $publishersProp = $entry.PSObject.Properties | Where-Object { $_.Name -ieq 'Publishers' } | Select-Object -First 1
    if (-not $publishersProp -or -not $publishersProp.Value) { continue }
    foreach ($publisher in @($publishersProp.Value)) {
      $urlProp = $publisher.PSObject.Properties | Where-Object { $_.Name -ieq 'URL' } | Select-Object -First 1
      $portProp = $publisher.PSObject.Properties | Where-Object { $_.Name -ieq 'PublishedPort' } | Select-Object -First 1
      if (-not $urlProp -or -not $portProp) { continue }
      $parsedPublished = 0
      if (-not [int]::TryParse([string] $portProp.Value, [ref] $parsedPublished)) { continue }
      if ($urlProp.Value -eq $BindAddress -and $parsedPublished -eq $ConfiguredPort) { return $true }
    }
  }
  return $false
}

# Aggregates every gate signal into one fail-closed verdict. Pure: no I/O,
# so -SelfTest can cover every combination without touching the host.
function Get-StartGateVerdict {
  param(
    [bool] $HostReady,
    [System.Collections.Specialized.OrderedDictionary] $EnvCheck,
    [System.Collections.Specialized.OrderedDictionary] $PrivacyCheck,
    [ValidateSet('Free', 'OwnedBySelf', 'OccupiedByOther')]
    [string] $PortOccupancy,
    [bool] $WebPortUrlCoherent,
    [bool] $ConfigVerifierOk,
    [ValidateSet('Pass', 'Fail', 'Missing')]
    [string] $PrivacyVerifierStatus,
    [bool] $PortConfigValid = $true
  )
  $blockers = [System.Collections.Generic.List[string]]::new()
  if (-not $HostReady) { $blockers.Add('host: preflight-host.ps1 did not report ready') }
  if (-not $PortConfigValid) { $blockers.Add('port: AOS_CRM_WEB_PORT is set but is not a valid port number (1-65535)') }
  if (-not $EnvCheck.Exists) {
    $blockers.Add('secrets: deploy/local/.env is missing (run -Action Prepare)')
  } else {
    if ($EnvCheck.MissingKeys.Count -gt 0) { $blockers.Add("secrets: deploy/local/.env missing key(s): $($EnvCheck.MissingKeys -join ', ')") }
    if ($EnvCheck.PlaceholderKeys.Count -gt 0) { $blockers.Add("secrets: deploy/local/.env still has example placeholder value(s): $($EnvCheck.PlaceholderKeys -join ', ')") }
  }
  if (-not $PrivacyCheck.Exists) {
    $blockers.Add('privacy: deploy/local/privacy.env is missing (CRM-003 contract; not generated by this script)')
  } else {
    if ($PrivacyCheck.MissingKeys.Count -gt 0) { $blockers.Add("privacy: deploy/local/privacy.env missing key(s): $($PrivacyCheck.MissingKeys -join ', ')") }
    if ($PrivacyCheck.WrongValueKeys.Count -gt 0) { $blockers.Add("privacy: deploy/local/privacy.env key(s) not at the required value: $($PrivacyCheck.WrongValueKeys -join ', ')") }
  }
  if ($PortOccupancy -eq 'OccupiedByOther') { $blockers.Add('port: the configured loopback web port is occupied by a process outside this project') }
  if (-not $WebPortUrlCoherent) { $blockers.Add('port: AOS_CRM_SERVER_URL does not match http://127.0.0.1:<AOS_CRM_WEB_PORT>') }
  if (-not $ConfigVerifierOk) { $blockers.Add('config: node scripts/aos/verify-local-config.mjs did not pass') }
  switch ($PrivacyVerifierStatus) {
    'Missing' { $blockers.Add('privacy-verifier: scripts/aos/verify-privacy.mjs (CRM-003) is not delivered yet; blocking honestly until it exists') }
    'Fail' { $blockers.Add('privacy-verifier: scripts/aos/verify-privacy.mjs reported failures') }
  }
  return [ordered]@{ Proceed = ($blockers.Count -eq 0); Blockers = @($blockers) }
}

# Orchestrates Start: computes the verdict, then only invokes the mutating
# $ComposeInvoker when every gate is green. -SelfTest swaps $ComposeInvoker
# for a non-mutating recorder, proving the wiring itself (not just the
# isolated boolean aggregator) refuses to reach Docker when blocked.
function Invoke-StartAction {
  param(
    [bool] $HostReady,
    [System.Collections.Specialized.OrderedDictionary] $EnvCheck,
    [System.Collections.Specialized.OrderedDictionary] $PrivacyCheck,
    [string] $PortOccupancy,
    [bool] $WebPortUrlCoherent,
    [bool] $ConfigVerifierOk,
    [string] $PrivacyVerifierStatus,
    [scriptblock] $ComposeInvoker,
    [bool] $PortConfigValid = $true
  )
  $verdict = Get-StartGateVerdict -HostReady $HostReady -EnvCheck $EnvCheck -PrivacyCheck $PrivacyCheck `
    -PortOccupancy $PortOccupancy -WebPortUrlCoherent $WebPortUrlCoherent -ConfigVerifierOk $ConfigVerifierOk `
    -PrivacyVerifierStatus $PrivacyVerifierStatus -PortConfigValid $PortConfigValid
  if (-not $verdict.Proceed) {
    return [ordered]@{ Invoked = $false; Verdict = $verdict }
  }
  & $ComposeInvoker
  return [ordered]@{ Invoked = $true; Verdict = $verdict }
}

# Orchestrates Restart in three stages so a live restart of THIS project's
# own server is never blocked by its own listener, while a foreign occupant
# still blocks before anything is touched: (1) gate (treating self-occupancy
# as fine, foreign occupancy as a hard blocker) -- only a pass reaches (2)
# $DownInvoker, scoped to this project alone, never another product; then
# (3) re-probe the port and only call $UpInvoker if it is now actually free,
# so a stuck port after our own `down` blocks the `up` instead of racing it.
function Invoke-RestartAction {
  param(
    [bool] $HostReady,
    [System.Collections.Specialized.OrderedDictionary] $EnvCheck,
    [System.Collections.Specialized.OrderedDictionary] $PrivacyCheck,
    [string] $PortOccupancy,
    [bool] $WebPortUrlCoherent,
    [bool] $ConfigVerifierOk,
    [string] $PrivacyVerifierStatus,
    [scriptblock] $DownInvoker,
    [scriptblock] $PortFreeAfterDownProbe,
    [scriptblock] $UpInvoker,
    [bool] $PortConfigValid = $true
  )
  $verdict = Get-StartGateVerdict -HostReady $HostReady -EnvCheck $EnvCheck -PrivacyCheck $PrivacyCheck `
    -PortOccupancy $PortOccupancy -WebPortUrlCoherent $WebPortUrlCoherent -ConfigVerifierOk $ConfigVerifierOk `
    -PrivacyVerifierStatus $PrivacyVerifierStatus -PortConfigValid $PortConfigValid
  if (-not $verdict.Proceed) {
    return [ordered]@{ Stage = 'blocked-before-down'; Verdict = $verdict; ExitCode = 1 }
  }
  # $DownInvoker's real exit code travels via $script:ComposeExitCode (same
  # convention as Invoke-ComposeOnLinux/Invoke-Main below), not a captured
  # return value: capturing `& $DownInvoker`'s output would swallow
  # `docker compose down`'s own live-streamed stdout (see
  # Invoke-ComposeOnLinux's comment). A failed `down` must block before `up`
  # and preserve its real exit code, not be silently outrun by a port that
  # happens to already be free.
  & $DownInvoker
  if ($script:ComposeExitCode -ne 0) {
    $downExitCode = $script:ComposeExitCode
    $stuckVerdict = [ordered]@{ Proceed = $false; Blockers = @("down: compose down exited $downExitCode; refusing to start back up") }
    return [ordered]@{ Stage = 'blocked-down-failed'; Verdict = $stuckVerdict; ExitCode = $downExitCode }
  }
  $portFreeAfterDown = & $PortFreeAfterDownProbe
  if (-not $portFreeAfterDown) {
    $stuckVerdict = [ordered]@{ Proceed = $false; Blockers = @("port: still occupied after stopping this project's own services") }
    return [ordered]@{ Stage = 'blocked-after-down'; Verdict = $stuckVerdict; ExitCode = 1 }
  }
  & $UpInvoker
  return [ordered]@{ Stage = 'started'; Verdict = $verdict }
}

# Refuses to recursively delete anything that is not, right now, a real
# directory strictly inside $ExpectedParent with a leaf name starting with
# $ExpectedPrefix, and refuses outright if the target itself is a reparse
# point (symlink/junction): its target could point anywhere, so a
# literal-path containment check on the link itself is not a safety
# guarantee. Re-resolves immediately before deleting rather than trusting an
# earlier snapshot, to keep the TOCTOU window as small as a single-threaded
# script allows.
function Remove-ContainedTempDir {
  param([string] $Path, [string] $ExpectedParent, [string] $ExpectedPrefix)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.LinkType) {
    Write-Warning "refusing to delete '$($item.FullName)': it is a reparse point ($($item.LinkType)), not a plain directory"
    return
  }
  $resolved = $item.FullName.TrimEnd('\')
  $parentResolved = (Get-Item -LiteralPath $ExpectedParent -Force).FullName.TrimEnd('\')
  $leaf = Split-Path -Leaf $resolved
  $parentOfResolved = Split-Path -Parent $resolved
  $isRoot = [string]::IsNullOrEmpty($parentOfResolved)
  $isDirectChildOfExpectedParent = ($parentOfResolved -eq $parentResolved)
  $hasExpectedPrefix = $leaf.StartsWith($ExpectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)
  if ($isRoot -or -not $isDirectChildOfExpectedParent -or -not $hasExpectedPrefix) {
    Write-Warning "refusing to delete '$resolved': not a contained temp dir directly under '$parentResolved' with prefix '$ExpectedPrefix'"
    return
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
}

# ---------------------------------------------------------------------------
# Host-crossing I/O: every one of these is the only place that touches a
# real file under deploy/local, wsl.exe, docker or another process.
# ---------------------------------------------------------------------------

# Launches a background PowerShell helper through raw ProcessStartInfo with
# .ArgumentList (a real per-argument collection on .NET) instead of
# Start-Process -ArgumentList, whose array form is naively string-joined on
# Windows and does not quote elements containing spaces -- a repo path or
# distro name with a space or Unicode character would otherwise split into
# the wrong argv. UseShellExecute=$false + CreateNoWindow=$true is the
# equivalent of -WindowStyle Hidden for a non-interactive helper whose
# stdout/stderr are redirected (WindowStyle itself only applies when
# UseShellExecute=$true, which is incompatible with redirection). No
# -ExecutionPolicy Bypass is passed.
function Invoke-PowerShellScript {
  param([string] $ScriptPath, [string[]] $ScriptArgs = @())
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = 'powershell'
  $psi.ArgumentList.Add('-NoProfile')
  $psi.ArgumentList.Add('-File')
  $psi.ArgumentList.Add($ScriptPath)
  foreach ($a in $ScriptArgs) { $psi.ArgumentList.Add($a) }
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  try {
    $proc = [System.Diagnostics.Process]::Start($psi)
  } catch {
    return 2
  }
  # Drain both streams asynchronously before waiting: this helper's exit code
  # is all callers need, but an undrained pipe can deadlock WaitForExit() if
  # the child writes enough output to fill its buffer.
  $null = $proc.StandardOutput.ReadToEndAsync()
  $null = $proc.StandardError.ReadToEndAsync()
  $proc.WaitForExit()
  return $proc.ExitCode
}

function Test-HostReady {
  param([string] $RepoRoot, [string] $Distro)
  $script = Join-Path $RepoRoot 'scripts/aos/preflight-host.ps1'
  return (Invoke-PowerShellScript -ScriptPath $script -ScriptArgs @('-DistroName', $Distro)) -eq 0
}

# Runs a local Node verifier directly on the Windows host (no WSL hop: these
# scripts have zero npm dependencies) and returns only its pass/fail, never
# its stdout/stderr -- a future verifier that resolves real secrets must
# never have them echoed by this wrapper.
function Invoke-NodeScript {
  param([string] $RepoRoot, [string] $ScriptPath)
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = 'node'
  $psi.ArgumentList.Add($ScriptPath)
  $psi.WorkingDirectory = $RepoRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  try {
    $proc = [System.Diagnostics.Process]::Start($psi)
  } catch {
    return $false
  }
  $null = $proc.StandardOutput.ReadToEndAsync()
  $null = $proc.StandardError.ReadToEndAsync()
  $proc.WaitForExit()
  return $proc.ExitCode -eq 0
}

# The real local-security gate (compose/dockerignore/gitignore/yarnrc/
# Dockerfile/settings.json/merge-guard), not the whole `aos verify` (which
# also checks provenance against GitHub) -- Start/Restart must not hit the
# network on every call.
function Invoke-LocalConfigVerifier {
  param([string] $RepoRoot)
  return Invoke-NodeScript -RepoRoot $RepoRoot -ScriptPath (Join-Path $RepoRoot 'scripts/aos/verify-local-config.mjs')
}

# CRM-003's privacy verifier may not exist yet. Its absence must block
# Start/Restart honestly (distinct from "ran and failed"), not be silently
# skipped.
function Invoke-PrivacyVerifierIfPresent {
  param([string] $RepoRoot, [string] $RelPath = 'scripts/aos/verify-privacy.mjs')
  $scriptPath = Join-Path $RepoRoot $RelPath
  if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { return 'Missing' }
  if (Invoke-NodeScript -RepoRoot $RepoRoot -ScriptPath $scriptPath) { return 'Pass' }
  return 'Fail'
}

# Asks Docker (not a bind probe) whether THIS project's `server` service is
# the one actually bound, on loopback, to $ConfiguredPort -- a Service match
# alone does not prove port ownership (see Test-ServerOwnsPublishedPort).
# Requires deploy/local/.env to exist for compose to interpolate at all; if
# it does not, our stack cannot be the one running regardless, so this
# safely reports $false.
function Test-OwnServerRunning {
  param([string] $RepoRoot, [string] $Distro, [int] $ConfiguredPort)
  $linuxRootRaw = & wsl.exe -d $Distro --exec wslpath -a $RepoRoot
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($linuxRootRaw)) { return $false }
  $linuxRoot = $linuxRootRaw.Trim()
  $composePath = "$linuxRoot/$ComposeRelPath"
  $psOutputRaw = & wsl.exe -d $Distro --exec docker compose -f $composePath -p $ProjectName ps --format json --status running 2>$null
  if ($LASTEXITCODE -ne 0) { return $false }
  # `docker compose ps --format json` is JSON Lines (one object per line). A
  # multi-record native stdout capture lands here as string[]; joining with a
  # real newline at this boundary -- where the array shape is produced --
  # keeps the per-line structure Test-ServerOwnsPublishedPort splits on.
  # Without it, PowerShell's default array-to-string coercion at the
  # [string]-typed parameter joins elements with spaces instead, collapsing
  # every record onto one line the JSON Lines parser cannot decode.
  $psOutput = ($psOutputRaw -join "`n")
  if ([string]::IsNullOrWhiteSpace($psOutput)) { return $false }
  return Test-ServerOwnsPublishedPort -PsJsonOutput $psOutput -ConfiguredPort $ConfiguredPort
}

# Writes deploy/local/.env with fresh crypto-random secrets. Refuses to
# overwrite an existing file (idempotent: re-running Prepare must not
# invalidate a running deployment's credentials). Never prints a value.
function Invoke-Prepare {
  [CmdletBinding()]
  param([string] $LocalDir, [string] $EnvPath, [int] $WebPort)
  if (Test-Path -LiteralPath $EnvPath -PathType Leaf) {
    Write-Output "deploy/local/.env already exists; leaving it untouched. Delete it yourself first if you want new secrets."
    $script:PrepareOk = $true
    return
  }
  if (-not (Test-PortFree -Port $WebPort)) {
    Write-Error "127.0.0.1:$WebPort is not free; pick another port and edit deploy/local/.env.example's AOS_CRM_WEB_PORT/AOS_CRM_SERVER_URL before copying it, or free the port first."
    $script:PrepareOk = $false
    return
  }
  New-Item -ItemType Directory -Path $LocalDir -Force | Out-Null
  $pgPassword = New-CryptoToken -Encoding Hex -Bytes 32
  $encryptionKey = New-CryptoToken -Encoding Base64 -Bytes 32
  $lines = @(
    '# Generated by scripts/aos/local.ps1 -Action Prepare. Never commit this file.',
    'AOS_CRM_IMAGE_TAG=aos-crm-local/twenty:v2.51.0-15e4826d3b',
    'AOS_CRM_APP_VERSION=twenty-v2.51.0+15e4826d3b',
    "AOS_CRM_WEB_PORT=$WebPort",
    "AOS_CRM_SERVER_URL=http://127.0.0.1:$WebPort",
    'AOS_CRM_PG_USER=aos_crm',
    'AOS_CRM_PG_DB=aos_crm_local',
    "AOS_CRM_PG_PASSWORD=$pgPassword",
    "AOS_CRM_ENCRYPTION_KEY=$encryptionKey"
  )
  [System.IO.File]::WriteAllLines($EnvPath, $lines)
  $pgPassword = $null; $encryptionKey = $null; $lines = $null
  Write-Output "Wrote deploy/local/.env (secrets generated, not printed). deploy/local/privacy.env is still required and is not created by this script (CRM-003)."
  $script:PrepareOk = $true
}

# Runs as a BARE statement at every call site (never assigned, never wrapped
# in parens): capturing a PowerShell call's output is how you consume it
# instead of letting it stream live, and `docker compose logs --follow`
# must stream. The real exit code travels out via $script:ComposeExitCode,
# not a return value, for the same reason.
function Invoke-ComposeOnLinux {
  param([string] $RepoRoot, [string] $Distro, [string[]] $ComposeArgs)
  $linuxRootRaw = & wsl.exe -d $Distro --exec wslpath -a $RepoRoot
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($linuxRootRaw)) {
    Write-Error "could not translate '$RepoRoot' to a WSL path via distro '$Distro'"
    $script:ComposeExitCode = 2
    return
  }
  $linuxRoot = $linuxRootRaw.Trim()
  $composePath = "$linuxRoot/$ComposeRelPath"
  $fullArgs = @('-d', $Distro, '--exec', 'docker', 'compose', '-f', $composePath, '-p', $ProjectName) + $ComposeArgs
  & wsl.exe @fullArgs
  $script:ComposeExitCode = $LASTEXITCODE
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

function Invoke-Main {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
  $LocalDir = Join-Path $RepoRoot 'deploy/local'
  $EnvPath = Join-Path $LocalDir '.env'
  $PrivacyPath = Join-Path $LocalDir 'privacy.env'

  # Shared by Status/Start/Restart: every gate signal except the one
  # (self-vs-foreign port ownership) that is cheaper to skip when the port is
  # already free.
  function Get-GateSignals {
    $hostReady = Test-HostReady -RepoRoot $RepoRoot -Distro $Distro
    $envCheck = Test-RequiredPresentKeys -Path $EnvPath -RequiredKeys $RequiredEnvKeys -RejectedPlaceholders @('replace_me_with_a_random_hex_string', 'replace_me_with_a_random_base64_string')
    $privacyCheck = Test-RequiredExactKeys -Path $PrivacyPath -Required $RequiredPrivacyKeys
    $portCheck = Get-ConfiguredWebPort -EnvPath $EnvPath -DefaultPort $DefaultWebPort
    $resolvedPort = $portCheck.Port
    $portFree = Test-PortFree -Port $resolvedPort
    $ownRunning = if ($portFree) { $false } else { Test-OwnServerRunning -RepoRoot $RepoRoot -Distro $Distro -ConfiguredPort $resolvedPort }
    $portOccupancy = Get-PortOccupancy -PortFree $portFree -OwnServerRunning $ownRunning
    $envValues = Read-EnvKeys -Path $EnvPath
    $serverUrl = if ($envValues) { $envValues['AOS_CRM_SERVER_URL'] } else { $null }
    $urlCoherent = Test-WebPortUrlCoherent -Port $resolvedPort -ServerUrl $serverUrl
    $configVerifierOk = Invoke-LocalConfigVerifier -RepoRoot $RepoRoot
    $privacyVerifierStatus = Invoke-PrivacyVerifierIfPresent -RepoRoot $RepoRoot
    return [ordered]@{
      HostReady             = $hostReady
      EnvCheck              = $envCheck
      PrivacyCheck          = $privacyCheck
      ResolvedPort          = $resolvedPort
      PortConfigValid       = $portCheck.Valid
      PortOccupancy         = $portOccupancy
      WebPortUrlCoherent    = $urlCoherent
      ConfigVerifierOk      = $configVerifierOk
      PrivacyVerifierStatus = $privacyVerifierStatus
    }
  }

  switch ($Action) {
    'Prepare' {
      Invoke-Prepare -LocalDir $LocalDir -EnvPath $EnvPath -WebPort $DefaultWebPort
      exit ($script:PrepareOk ? 0 : 1)
    }
    'Status' {
      # Read-only: does not require the start gate, reports it instead.
      $signals = Get-GateSignals
      $verdict = Get-StartGateVerdict -HostReady $signals.HostReady -EnvCheck $signals.EnvCheck -PrivacyCheck $signals.PrivacyCheck `
        -PortOccupancy $signals.PortOccupancy -WebPortUrlCoherent $signals.WebPortUrlCoherent -ConfigVerifierOk $signals.ConfigVerifierOk `
        -PrivacyVerifierStatus $signals.PrivacyVerifierStatus -PortConfigValid $signals.PortConfigValid
      Write-Output "aos-crm-local gate: $(if ($verdict.Proceed) { 'READY to start' } else { 'NOT ready' }) (configured port: $($signals.ResolvedPort), occupancy: $($signals.PortOccupancy))"
      foreach ($b in $verdict.Blockers) { Write-Output "  - $b" }
      if ($signals.HostReady) {
        Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('ps')
        exit $script:ComposeExitCode
      }
      exit ($verdict.Proceed ? 0 : 1)
    }
    'Start' {
      $signals = Get-GateSignals
      $result = Invoke-StartAction -HostReady $signals.HostReady -EnvCheck $signals.EnvCheck -PrivacyCheck $signals.PrivacyCheck `
        -PortOccupancy $signals.PortOccupancy -WebPortUrlCoherent $signals.WebPortUrlCoherent -ConfigVerifierOk $signals.ConfigVerifierOk `
        -PrivacyVerifierStatus $signals.PrivacyVerifierStatus -PortConfigValid $signals.PortConfigValid `
        -ComposeInvoker { Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('up', '--build', '-d') }
      if (-not $result.Invoked) {
        Write-Output 'aos-crm-local: BLOCKED (fail-closed), no build/up attempted:'
        foreach ($b in $result.Verdict.Blockers) { Write-Output "  - $b" }
        exit 1
      }
      exit $script:ComposeExitCode
    }
    'Stop' {
      Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('down')
      exit $script:ComposeExitCode
    }
    'Restart' {
      $signals = Get-GateSignals
      $result = Invoke-RestartAction -HostReady $signals.HostReady -EnvCheck $signals.EnvCheck -PrivacyCheck $signals.PrivacyCheck `
        -PortOccupancy $signals.PortOccupancy -WebPortUrlCoherent $signals.WebPortUrlCoherent -ConfigVerifierOk $signals.ConfigVerifierOk `
        -PrivacyVerifierStatus $signals.PrivacyVerifierStatus -PortConfigValid $signals.PortConfigValid `
        -DownInvoker { Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('down') } `
        -PortFreeAfterDownProbe { Test-PortFree -Port $signals.ResolvedPort } `
        -UpInvoker { Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('up', '--build', '-d') }
      if ($result.Stage -ne 'started') {
        Write-Output 'aos-crm-local: BLOCKED (fail-closed):'
        foreach ($b in $result.Verdict.Blockers) { Write-Output "  - $b" }
        exit $result.ExitCode
      }
      exit $script:ComposeExitCode
    }
    'Logs' {
      $logsArgs = @('logs')
      if ($Follow) { $logsArgs += '--follow' }
      Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs $logsArgs
      exit $script:ComposeExitCode
    }
  }
}

# ---------------------------------------------------------------------------
# Self-test: isolated tmp fixtures only. Never touches deploy/local, WSL or
# Docker (mirrors verify-provenance.mjs --self-test / preflight-host.ps1
# -SelfTest).
# ---------------------------------------------------------------------------

function Invoke-SelfTest {
  $failures = [System.Collections.Generic.List[string]]::new()
  function Record {
    param([string] $Name, [scriptblock] $Body)
    try {
      & $Body
      Write-Output "[PASS] $Name"
    } catch {
      Write-Output "[FAIL] ${Name}: $($_.Exception.Message)"
      $failures.Add($Name)
    }
  }

  $tmpParent = [System.IO.Path]::GetTempPath()
  $tmpPrefix = "aos-crm-local-ps1-selftest-$([guid]::NewGuid())"
  $tmpRoot = Join-Path $tmpParent $tmpPrefix
  New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
  try {
    Record 'Test-PortFree: a bound loopback port reports not free' {
      $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), 0)
      $listener.Start()
      $port = $listener.LocalEndpoint.Port
      try {
        if (Test-PortFree -Port $port) { throw "expected port $port to be reported busy" }
      } finally {
        $listener.Stop()
      }
      if (-not (Test-PortFree -Port $port)) { throw "expected port $port to be free after releasing the listener" }
    }

    Record 'New-CryptoToken: hex/base64 outputs have the requested length and are not repeated' {
      $a = New-CryptoToken -Encoding Hex -Bytes 32
      $b = New-CryptoToken -Encoding Hex -Bytes 32
      if ($a.Length -ne 64) { throw "expected 64 hex chars, got $($a.Length)" }
      if ($a -eq $b) { throw 'two independent draws produced the same hex token' }
      $c = New-CryptoToken -Encoding Base64 -Bytes 32
      if ([Convert]::FromBase64String($c).Length -ne 32) { throw 'base64 token does not decode to 32 bytes' }
    }

    Record 'Read-EnvKeys: skips comments/blank and keeps the last duplicate key' {
      $p = Join-Path $tmpRoot 'sample.env'
      Set-Content -LiteralPath $p -Value @('# comment', '', 'A=1', 'A=2', 'B=x=y')
      $found = Read-EnvKeys -Path $p
      if ($found['A'] -ne '2') { throw "expected A=2, got A=$($found['A'])" }
      if ($found['B'] -ne 'x=y') { throw "expected B='x=y', got B=$($found['B'])" }
    }

    Record 'Test-RequiredExactKeys: missing file reports Exists=false and every key missing' {
      $r = Test-RequiredExactKeys -Path (Join-Path $tmpRoot 'does-not-exist.env') -Required $RequiredPrivacyKeys
      if ($r.Exists) { throw 'expected Exists=false' }
      if (@($r.MissingKeys).Count -ne $RequiredPrivacyKeys.Count) { throw 'expected every required key to be missing' }
    }

    Record 'Test-RequiredExactKeys: wrong value is reported, not silently accepted' {
      $p = Join-Path $tmpRoot 'privacy-wrong.env'
      Set-Content -LiteralPath $p -Value @('TELEMETRY_ENABLED=true', 'ANALYTICS_ENABLED=false', 'MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false', 'IS_CONFIG_VARIABLES_IN_DB_ENABLED=false')
      $r = Test-RequiredExactKeys -Path $p -Required $RequiredPrivacyKeys
      if (@($r.WrongValueKeys) -notcontains 'TELEMETRY_ENABLED') { throw 'expected TELEMETRY_ENABLED to be flagged wrong' }
      if (@($r.MissingKeys).Count -ne 0) { throw 'no key should be reported missing in this fixture' }
    }

    Record 'Test-RequiredExactKeys: all-correct fixture passes clean' {
      $p = Join-Path $tmpRoot 'privacy-ok.env'
      Set-Content -LiteralPath $p -Value @('TELEMETRY_ENABLED=false', 'ANALYTICS_ENABLED=false', 'MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false', 'IS_CONFIG_VARIABLES_IN_DB_ENABLED=false')
      $r = Test-RequiredExactKeys -Path $p -Required $RequiredPrivacyKeys
      if (@($r.MissingKeys).Count -ne 0 -or @($r.WrongValueKeys).Count -ne 0) { throw 'expected a clean pass' }
    }

    Record 'Test-RequiredPresentKeys: placeholder value is flagged, not accepted as a real secret' {
      $p = Join-Path $tmpRoot 'env-placeholder.env'
      Set-Content -LiteralPath $p -Value @('AOS_CRM_IMAGE_TAG=aos-crm-local/twenty:v2.51.0-15e4826d3b', 'AOS_CRM_PG_PASSWORD=replace_me_with_a_random_hex_string', 'AOS_CRM_ENCRYPTION_KEY=replace_me_with_a_random_base64_string')
      $r = Test-RequiredPresentKeys -Path $p -RequiredKeys $RequiredEnvKeys -RejectedPlaceholders @('replace_me_with_a_random_hex_string', 'replace_me_with_a_random_base64_string')
      if (@($r.PlaceholderKeys).Count -ne 2) { throw "expected 2 placeholder keys flagged, got $(@($r.PlaceholderKeys).Count)" }
    }

    Record 'Get-ConfiguredWebPort: reads AOS_CRM_WEB_PORT from the env file instead of the hardcoded default' {
      $p = Join-Path $tmpRoot 'port.env'
      Set-Content -LiteralPath $p -Value @('AOS_CRM_WEB_PORT=51234')
      $got = Get-ConfiguredWebPort -EnvPath $p -DefaultPort 43000
      if ($got.Port -ne 51234) { throw "expected 51234, got $($got.Port)" }
      if (-not $got.Valid) { throw 'expected a well-formed explicit port to be Valid' }
    }

    Record 'Get-ConfiguredWebPort: missing file or key falls back to the default and is still Valid' {
      $missing = Get-ConfiguredWebPort -EnvPath (Join-Path $tmpRoot 'nope.env') -DefaultPort 43000
      if ($missing.Port -ne 43000) { throw "expected fallback 43000, got $($missing.Port)" }
      if (-not $missing.Valid) { throw 'expected a missing file to be Valid (nothing explicit to reject)' }
      $p = Join-Path $tmpRoot 'port-novalue.env'
      Set-Content -LiteralPath $p -Value @('AOS_CRM_PG_USER=aos_crm')
      $noKey = Get-ConfiguredWebPort -EnvPath $p -DefaultPort 43000
      if ($noKey.Port -ne 43000) { throw "expected fallback 43000, got $($noKey.Port)" }
      if (-not $noKey.Valid) { throw 'expected a missing key to be Valid' }
    }

    Record 'Get-ConfiguredWebPort: an explicit invalid value fails instead of silently falling back to the default (the exact defect this track fixed)' {
      $p = Join-Path $tmpRoot 'port-invalid.env'
      Set-Content -LiteralPath $p -Value @('AOS_CRM_WEB_PORT=not-a-port')
      $invalid = Get-ConfiguredWebPort -EnvPath $p -DefaultPort 43000
      if ($invalid.Valid) { throw 'expected an unparseable AOS_CRM_WEB_PORT to be Valid=false, not silently accepted' }
      if ($invalid.Port -ne 43000) { throw 'expected the fallback port to still be populated for downstream probing even when invalid' }

      $pOutOfRange = Join-Path $tmpRoot 'port-out-of-range.env'
      Set-Content -LiteralPath $pOutOfRange -Value @('AOS_CRM_WEB_PORT=70000')
      $outOfRange = Get-ConfiguredWebPort -EnvPath $pOutOfRange -DefaultPort 43000
      if ($outOfRange.Valid) { throw 'expected an out-of-range AOS_CRM_WEB_PORT (70000) to be Valid=false' }
    }

    Record 'Test-WebPortUrlCoherent: matching URL passes, mismatched URL fails, empty URL is not a contradiction' {
      if (-not (Test-WebPortUrlCoherent -Port 43000 -ServerUrl 'http://127.0.0.1:43000')) { throw 'expected a matching URL to be coherent' }
      if (Test-WebPortUrlCoherent -Port 43000 -ServerUrl 'http://127.0.0.1:9999') { throw 'expected a mismatched URL to be incoherent' }
      if (-not (Test-WebPortUrlCoherent -Port 43000 -ServerUrl '')) { throw 'expected an empty/unset URL to be treated as coherent (nothing to contradict)' }
    }

    Record 'Get-PortOccupancy: free, owned-by-self and occupied-by-other are distinguished' {
      if ((Get-PortOccupancy -PortFree $true -OwnServerRunning $false) -ne 'Free') { throw 'expected Free' }
      if ((Get-PortOccupancy -PortFree $false -OwnServerRunning $true) -ne 'OwnedBySelf') { throw 'expected OwnedBySelf' }
      if ((Get-PortOccupancy -PortFree $false -OwnServerRunning $false) -ne 'OccupiedByOther') { throw 'expected OccupiedByOther' }
    }

    Record 'Test-ServerOwnsPublishedPort: a Publishers entry matching the configured port on loopback is owned' {
      $json = '{"Service":"server","Publishers":[{"URL":"127.0.0.1","TargetPort":3000,"PublishedPort":43000,"Protocol":"tcp"}]}'
      if (-not (Test-ServerOwnsPublishedPort -PsJsonOutput $json -ConfiguredPort 43000)) { throw 'expected ownership to be confirmed for a matching Publishers entry' }
    }

    Record 'Test-ServerOwnsPublishedPort: a server published on a different port is not confused with the newly configured one (the exact 43000-vs-43001 defect this track fixed)' {
      $json = '{"Service":"server","Publishers":[{"URL":"127.0.0.1","TargetPort":3000,"PublishedPort":43000,"Protocol":"tcp"}]}'
      if (Test-ServerOwnsPublishedPort -PsJsonOutput $json -ConfiguredPort 43001) { throw 'expected no ownership when the configured port does not match the published one' }
    }

    Record 'Test-ServerOwnsPublishedPort: a server entry with no Publishers is not treated as owning the port' {
      $json = '{"Service":"server","Publishers":[]}'
      if (Test-ServerOwnsPublishedPort -PsJsonOutput $json -ConfiguredPort 43000) { throw 'expected no ownership with an empty Publishers list' }
    }

    Record 'Test-ServerOwnsPublishedPort: a non-loopback bind is not treated as owning the loopback-configured port' {
      $json = '{"Service":"server","Publishers":[{"URL":"0.0.0.0","TargetPort":3000,"PublishedPort":43000,"Protocol":"tcp"}]}'
      if (Test-ServerOwnsPublishedPort -PsJsonOutput $json -ConfiguredPort 43000) { throw 'expected no ownership for a non-loopback bind address' }
    }

    Record 'Test-ServerOwnsPublishedPort: a matching Publishers entry on a different service is not attributed to server' {
      $json = '{"Service":"worker","Publishers":[{"URL":"127.0.0.1","TargetPort":3000,"PublishedPort":43000,"Protocol":"tcp"}]}'
      if (Test-ServerOwnsPublishedPort -PsJsonOutput $json -ConfiguredPort 43000) { throw 'expected no ownership when the matching Publishers entry belongs to a different service' }
    }

    Record 'Test-OwnServerRunning: a multi-record `docker compose ps` stdout captured as a native string[] (not a pre-joined string) is still parsed as JSON Lines (the array-to-space-joined-string defect this track fixed)' {
      $script:selfTestPsRecords = @(
        '{"Service":"db","Publishers":[]}',
        '{"Service":"server","Publishers":[{"URL":"127.0.0.1","TargetPort":3000,"PublishedPort":43000,"Protocol":"tcp"}]}'
      )
      function wsl.exe {
        $global:LASTEXITCODE = 0
        if ($args -contains 'wslpath') { return '/synthetic/repo' }
        return $script:selfTestPsRecords
      }
      if (-not (Test-OwnServerRunning -RepoRoot 'C:\synthetic' -Distro 'synthetic-distro' -ConfiguredPort 43000)) {
        throw 'expected the real Test-OwnServerRunning wrapper to confirm ownership from multi-record native stdout'
      }
    }

    Record 'Invoke-RestartAction wired to the real Test-OwnServerRunning: a server published on 43000 while 43001 is configured is a foreign occupant, so down/up are never called' {
      $script:selfTestPsRecords = @(
        '{"Service":"db","Publishers":[]}',
        '{"Service":"server","Publishers":[{"URL":"127.0.0.1","TargetPort":3000,"PublishedPort":43000,"Protocol":"tcp"}]}'
      )
      function wsl.exe {
        $global:LASTEXITCODE = 0
        if ($args -contains 'wslpath') { return '/synthetic/repo' }
        return $script:selfTestPsRecords
      }
      $ownServerRunning = Test-OwnServerRunning -RepoRoot 'C:\synthetic' -Distro 'synthetic-distro' -ConfiguredPort 43001
      if ($ownServerRunning) { throw 'expected no ownership when configured port 43001 does not match the published port 43000' }
      $portOccupancy = Get-PortOccupancy -PortFree $false -OwnServerRunning $ownServerRunning
      if ($portOccupancy -ne 'OccupiedByOther') { throw "expected OccupiedByOther, got $portOccupancy" }
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-RestartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy $portOccupancy -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -DownInvoker { $script:ComposeExitCode = 0; $order.Add('down') } -PortFreeAfterDownProbe { $order.Add('probe'); $true } -UpInvoker { $order.Add('up') }
      if ($result.Stage -ne 'blocked-before-down') { throw "expected Stage=blocked-before-down, got $($result.Stage)" }
      if ($order.Count -ne 0) { throw "expected neither down nor up to run, ran: $($order -join ',')" }
    }

    Record 'Get-StartGateVerdict: every signal good means Proceed=true with no blockers' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $v = Get-StartGateVerdict -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass'
      if (-not $v.Proceed -or @($v.Blockers).Count -ne 0) { throw 'expected a clean proceed verdict' }
    }

    Record 'Get-StartGateVerdict: a port owned by this project itself does not block' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $v = Get-StartGateVerdict -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'OwnedBySelf' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass'
      if (-not $v.Proceed) { throw 'expected Proceed=true when the port is occupied by this project''s own server' }
    }

    Record 'Get-StartGateVerdict: a port occupied by a foreign process blocks without naming it a secret leak' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $v = Get-StartGateVerdict -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'OccupiedByOther' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass'
      if ($v.Proceed) { throw 'expected Proceed=false when the port is occupied by another process' }
    }

    Record 'Get-StartGateVerdict: missing privacy.env blocks even when everything else is ready' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyMissing = [ordered]@{ Exists = $false; MissingKeys = @($RequiredPrivacyKeys.Keys); WrongValueKeys = @() }
      $v = Get-StartGateVerdict -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyMissing -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass'
      if ($v.Proceed) { throw 'expected Proceed=false when privacy.env is missing' }
      if (-not (@($v.Blockers) -match 'privacy:')) { throw 'expected a privacy: blocker in the list' }
    }

    Record 'Get-StartGateVerdict: the real local-config verifier failing blocks even when the four-flag check passes' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $v = Get-StartGateVerdict -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $false -PrivacyVerifierStatus 'Pass'
      if ($v.Proceed) { throw 'expected Proceed=false when verify-local-config.mjs fails' }
      if (-not (@($v.Blockers) -match '^config:')) { throw 'expected a config: blocker' }
    }

    Record 'Get-StartGateVerdict: a not-yet-delivered CRM-003 privacy verifier blocks honestly, distinct from a failing one' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $vMissing = Get-StartGateVerdict -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Missing'
      if ($vMissing.Proceed) { throw 'expected Proceed=false when the privacy verifier is not delivered yet' }
      if (-not (@($vMissing.Blockers) -match 'not delivered yet')) { throw 'expected a not-delivered-yet blocker' }
      $vFail = Get-StartGateVerdict -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Fail'
      if ($vFail.Proceed) { throw 'expected Proceed=false when the privacy verifier fails' }
      if (@($vMissing.Blockers)[0] -eq @($vFail.Blockers)[0]) { throw 'expected distinct messages for missing vs failing' }
    }

    Record 'Get-StartGateVerdict: an incoherent AOS_CRM_SERVER_URL blocks' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $v = Get-StartGateVerdict -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $false -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass'
      if ($v.Proceed) { throw 'expected Proceed=false when the server URL does not match the configured port' }
    }

    Record 'Get-StartGateVerdict: an explicitly invalid AOS_CRM_WEB_PORT blocks even when everything else passes' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $v = Get-StartGateVerdict -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' -PortConfigValid $false
      if ($v.Proceed) { throw 'expected Proceed=false when AOS_CRM_WEB_PORT is explicitly invalid' }
      if (-not (@($v.Blockers) -match '^port:.*valid port number')) { throw 'expected a port: ... valid port number blocker' }
    }

    Record 'Invoke-StartAction: a clean verdict invokes the compose up scriptblock exactly once' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $calls = @(0)
      $result = Invoke-StartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' -ComposeInvoker { $calls[0] += 1 }
      if (-not $result.Invoked) { throw 'expected Invoked=true' }
      if ($calls[0] -ne 1) { throw "expected the compose invoker to run exactly once, ran $($calls[0]) time(s)" }
    }

    Record 'Invoke-StartAction: a blocked verdict never invokes the compose up scriptblock (no false PASS via an isolated aggregator)' {
      $envMissing = [ordered]@{ Exists = $false; MissingKeys = @($RequiredEnvKeys); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $calls = @(0)
      $result = Invoke-StartAction -HostReady $true -EnvCheck $envMissing -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' -ComposeInvoker { $calls[0] += 1 }
      if ($result.Invoked) { throw 'expected Invoked=false' }
      if ($calls[0] -ne 0) { throw "expected the compose invoker to never run, ran $($calls[0]) time(s)" }
    }

    Record 'Invoke-RestartAction: a clean verdict calls down then, once the port probe reports free, up' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-RestartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'OwnedBySelf' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -DownInvoker { $script:ComposeExitCode = 0; $order.Add('down') } -PortFreeAfterDownProbe { $order.Add('probe'); $true } -UpInvoker { $order.Add('up') }
      if ($result.Stage -ne 'started') { throw "expected Stage=started, got $($result.Stage)" }
      if (($order -join ',') -ne 'down,probe,up') { throw "expected down,probe,up in order, got $($order -join ',')" }
    }

    Record 'Invoke-RestartAction: a foreign occupant blocks before down or up, so another product is never touched' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-RestartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'OccupiedByOther' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -DownInvoker { $script:ComposeExitCode = 0; $order.Add('down') } -PortFreeAfterDownProbe { $order.Add('probe'); $true } -UpInvoker { $order.Add('up') }
      if ($result.Stage -ne 'blocked-before-down') { throw "expected Stage=blocked-before-down, got $($result.Stage)" }
      if ($order.Count -ne 0) { throw "expected neither down nor up to run, ran: $($order -join ',')" }
    }

    Record 'Invoke-RestartAction: a down failure blocks before up and preserves the original exit code (the hidden-failure defect this track fixed)' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-RestartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'OwnedBySelf' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -DownInvoker { $script:ComposeExitCode = 7; $order.Add('down') } -PortFreeAfterDownProbe { $order.Add('probe'); $true } -UpInvoker { $order.Add('up') }
      if ($result.Stage -ne 'blocked-down-failed') { throw "expected Stage=blocked-down-failed, got $($result.Stage)" }
      if ($result.ExitCode -ne 7) { throw "expected the original down exit code 7 to be preserved, got $($result.ExitCode)" }
      if (($order -join ',') -ne 'down') { throw "expected only down to run, neither probe nor up, got $($order -join ',')" }
    }

    Record 'Invoke-RestartAction: a port still stuck after down stops this project but refuses to start it back up' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-RestartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'OwnedBySelf' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -DownInvoker { $script:ComposeExitCode = 0; $order.Add('down') } -PortFreeAfterDownProbe { $order.Add('probe'); $false } -UpInvoker { $order.Add('up') }
      if ($result.Stage -ne 'blocked-after-down') { throw "expected Stage=blocked-after-down, got $($result.Stage)" }
      if (($order -join ',') -ne 'down,probe') { throw "expected down,probe without up, got $($order -join ',')" }
    }

    Record 'Invoke-PowerShellScript: a script path and argument containing spaces and Unicode survive intact' {
      $spaceRoot = Join-Path $tmpRoot 'hóla müñdo path with spaces'
      New-Item -ItemType Directory -Path $spaceRoot -Force | Out-Null
      $scriptPath = Join-Path $spaceRoot 'próbe script.ps1'
      $resultPath = Join-Path $spaceRoot 'resúlt.txt'
      $distroArg = 'Distró Ñamé With Spaces'
      $probeLines = @(
        'param([string] $DistroName)',
        "Set-Content -LiteralPath '$resultPath' -Value `$DistroName -Encoding utf8",
        'exit 0'
      )
      # utf8BOM, not utf8: Windows PowerShell 5.1 (the 'powershell' binary
      # Invoke-PowerShellScript launches) only auto-detects UTF-8 source
      # files with a BOM; without one it reads this script as the system
      # codepage and mangles the embedded accented literal below.
      Set-Content -LiteralPath $scriptPath -Value $probeLines -Encoding utf8BOM
      $exitCode = Invoke-PowerShellScript -ScriptPath $scriptPath -ScriptArgs @('-DistroName', $distroArg)
      if ($exitCode -ne 0) { throw "expected exit 0, got $exitCode" }
      if (-not (Test-Path -LiteralPath $resultPath)) { throw 'probe script did not run (result file missing); path/argument quoting likely broke' }
      $received = (Get-Content -LiteralPath $resultPath -Raw).Trim()
      if ($received -ne $distroArg) { throw "expected distro arg to survive as '$distroArg', got '$received'" }
    }

    Record 'Invoke-PowerShellScript: a missing script still returns a non-zero exit, never a false success' {
      $exitCode = Invoke-PowerShellScript -ScriptPath (Join-Path $tmpRoot 'does-not-exist.ps1') -ScriptArgs @()
      if ($exitCode -eq 0) { throw 'expected a non-zero exit code for a script that does not exist' }
    }

    Record 'Remove-ContainedTempDir: deletes a directory that is directly inside the expected parent with the expected prefix' {
      $victim = Join-Path $tmpRoot 'contained-victim'
      New-Item -ItemType Directory -Path $victim -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $victim 'file.txt') -Value 'x'
      Remove-ContainedTempDir -Path $victim -ExpectedParent $tmpRoot -ExpectedPrefix 'contained-'
      if (Test-Path -LiteralPath $victim) { throw 'expected the contained directory to be deleted' }
    }

    Record 'Remove-ContainedTempDir: refuses a directory outside the expected parent' {
      $outside = Join-Path $tmpParent "aos-crm-local-ps1-selftest-outside-$([guid]::NewGuid())"
      New-Item -ItemType Directory -Path $outside -Force | Out-Null
      try {
        Remove-ContainedTempDir -Path $outside -ExpectedParent $tmpRoot -ExpectedPrefix 'anything-' -WarningAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $outside)) { throw 'expected the out-of-parent directory to survive' }
      } finally {
        Remove-ContainedTempDir -Path $outside -ExpectedParent $tmpParent -ExpectedPrefix 'aos-crm-local-ps1-selftest-outside-'
      }
    }

    Record 'Remove-ContainedTempDir: refuses a directory with the wrong prefix even inside the expected parent' {
      $wrongPrefix = Join-Path $tmpRoot 'not-the-expected-name'
      New-Item -ItemType Directory -Path $wrongPrefix -Force | Out-Null
      Remove-ContainedTempDir -Path $wrongPrefix -ExpectedParent $tmpRoot -ExpectedPrefix 'contained-' -WarningAction SilentlyContinue
      if (-not (Test-Path -LiteralPath $wrongPrefix)) { throw 'expected the wrong-prefix directory to survive' }
    }

    Record 'Remove-ContainedTempDir: refuses a reparse point even when its own path looks contained' {
      $junctionTargetOutside = Join-Path $tmpParent "aos-crm-local-ps1-selftest-junction-target-$([guid]::NewGuid())"
      New-Item -ItemType Directory -Path $junctionTargetOutside -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $junctionTargetOutside 'canary.txt') -Value 'do-not-delete-me'
      $junctionPath = Join-Path $tmpRoot 'contained-junction'
      try {
        New-Item -ItemType Junction -Path $junctionPath -Target $junctionTargetOutside -ErrorAction Stop | Out-Null
      } catch {
        Write-Output "[SKIP] Remove-ContainedTempDir: refuses a reparse point -- junction creation unavailable ($($_.Exception.Message))"
        Remove-ContainedTempDir -Path $junctionTargetOutside -ExpectedParent $tmpParent -ExpectedPrefix 'aos-crm-local-ps1-selftest-junction-target-'
        return
      }
      try {
        Remove-ContainedTempDir -Path $junctionPath -ExpectedParent $tmpRoot -ExpectedPrefix 'contained-' -WarningAction SilentlyContinue
        if (-not (Test-Path -LiteralPath (Join-Path $junctionTargetOutside 'canary.txt'))) { throw 'the junction target''s content was deleted; a reparse point must be refused outright' }
      } finally {
        Remove-Item -LiteralPath $junctionPath -Force -ErrorAction SilentlyContinue
        Remove-ContainedTempDir -Path $junctionTargetOutside -ExpectedParent $tmpParent -ExpectedPrefix 'aos-crm-local-ps1-selftest-junction-target-'
      }
    }

    Record 'Invoke-Prepare: refuses to overwrite an existing deploy/local/.env' {
      $localDir = Join-Path $tmpRoot 'prepare-existing'
      New-Item -ItemType Directory -Path $localDir -Force | Out-Null
      $envPath = Join-Path $localDir '.env'
      Set-Content -LiteralPath $envPath -Value 'AOS_CRM_PG_PASSWORD=already-here'
      $before = Get-Content -LiteralPath $envPath -Raw
      $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), 0)
      $listener.Start(); $freePort = $listener.LocalEndpoint.Port; $listener.Stop()
      Invoke-Prepare -LocalDir $localDir -EnvPath $envPath -WebPort $freePort *> $null
      $after = Get-Content -LiteralPath $envPath -Raw
      if ($before -ne $after) { throw 'Prepare must not modify an existing .env' }
    }

    Record 'Invoke-Prepare: a busy port is refused before any file is written' {
      $localDir = Join-Path $tmpRoot 'prepare-busy-port'
      $envPath = Join-Path $localDir '.env'
      $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), 0)
      $listener.Start()
      try {
        $busyPort = $listener.LocalEndpoint.Port
        Invoke-Prepare -LocalDir $localDir -EnvPath $envPath -WebPort $busyPort -ErrorAction SilentlyContinue *> $null
        if ($script:PrepareOk) { throw 'expected Prepare to refuse a busy port' }
        if (Test-Path -LiteralPath $envPath) { throw 'expected no .env to be written when the port is busy' }
      } finally {
        $listener.Stop()
      }
    }
  } finally {
    Remove-ContainedTempDir -Path $tmpRoot -ExpectedParent $tmpParent -ExpectedPrefix 'aos-crm-local-ps1-selftest-'
  }

  Write-Output ''
  Write-Output "self-test: $(if ($failures.Count -eq 0) { 'ALL PASSED' } else { "$($failures.Count) FAILED" })"
  $script:SelfTestOk = $failures.Count -eq 0
}

if ($SelfTest) {
  # Bare call: Invoke-SelfTest's Write-Output progress must stream to the
  # host, not be captured into an expression (see Invoke-ComposeOnLinux).
  Invoke-SelfTest
  exit ($script:SelfTestOk ? 0 : 1)
} else {
  Invoke-Main
}
