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

# WSL2 terminates a distro once its last process exits, and systemd services
# inside it do not keep it alive (learn.microsoft.com/windows/wsl/systemd), so
# `docker compose up -d` returning is not the same as a stack that survives:
# when every wsl.exe caller exits and the idle window passes, the distro (and
# with it dockerd and every container) goes down. Start therefore holds one
# hidden session open on a marker file of this product's own, and Stop releases
# it. The marker is what makes the keeper identifiable: it is matched by its
# exact command line, so Stop never touches another distro, another product's
# process, or the global WSL configuration.
$KeeperMarker = '/tmp/aos-crm-local-keeper'
$KeeperPattern = "tail -f $KeeperMarker"

# ---------------------------------------------------------------------------
# Pure helpers: take explicit paths/values so -SelfTest can exercise them
# against isolated fixtures instead of the real checkout.
# ---------------------------------------------------------------------------

# `pgrep -f <pattern>` / `pkill -f <pattern>` match an EXTENDED REGEX against
# any SUBSTRING of the whole command line, so the keeper's own marker also
# matches every longer line that merely contains it (another product's
# `tail -f /tmp/aos-crm-local-keeper-2`, or a `grep` someone is running over
# the marker), and any regex metacharacter in the marker would stand for more
# than itself. Callers pair this with `-x`, which anchors the match to the
# COMPLETE command line, so between the two the pattern can only ever mean
# this product's own exact keeper line.
function ConvertTo-EreLiteral {
  param([string] $Text)
  return ($Text -replace '([\\^$.\[\]|()*+?{}])', '\$1')
}

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

# compose.yaml substitutes a FIXED literal for SERVER_URL when
# AOS_CRM_SERVER_URL is unset, so "unset" is not neutral: it is that literal.
# Read it out of compose.yaml rather than duplicating it here, so the two can
# never drift. Returns $null when no fallback can be read (missing file, or a
# SERVER_URL line without a `:-default`), which callers must treat as a
# blocker, not as "nothing to contradict".
function Get-ComposeServerUrlDefault {
  param([string] $ComposePath)
  if (-not (Test-Path -LiteralPath $ComposePath -PathType Leaf)) { return $null }
  $text = Get-Content -LiteralPath $ComposePath -Raw -ErrorAction Stop
  $match = [regex]::Match($text, '(?m)^\s*SERVER_URL:\s*\$\{\s*AOS_CRM_SERVER_URL\s*:-(?<default>[^}]*)\}\s*$')
  if (-not $match.Success) { return $null }
  $value = $match.Groups['default'].Value.Trim()
  if ([string]::IsNullOrWhiteSpace($value)) { return $null }
  return $value
}

# The URL the server actually receives: the explicit value when set, else
# compose.yaml's own fallback. $null means it could not be determined.
function Get-EffectiveServerUrl {
  param([string] $ServerUrl, [string] $ComposeDefaultUrl)
  if (-not [string]::IsNullOrWhiteSpace($ServerUrl)) { return $ServerUrl.Trim() }
  if ([string]::IsNullOrWhiteSpace($ComposeDefaultUrl)) { return $null }
  return $ComposeDefaultUrl.Trim()
}

# The EFFECTIVE SERVER_URL -- not just an explicitly set one -- must agree
# with the resolved loopback port. A custom AOS_CRM_WEB_PORT with no
# AOS_CRM_SERVER_URL is a real mismatch: the app would build links on the
# fallback port while being published on another one.
#
# The host half is just as load-bearing since CRM-014. On the beta profile the
# workspace a request belongs to is resolved from the SUBDOMAIN of this
# hostname (compose.yaml's IS_MULTIWORKSPACE_ENABLED), and an IP literal has no
# subdomains a browser can resolve: with http://127.0.0.1:<port> the stack
# comes up healthy and then NOBODY can sign in, because every origin maps to
# "no workspace". `localhost` is the one loopback name whose subdomains reach
# 127.0.0.1 without DNS or a hosts entry (RFC 6761), so it is the only accepted
# host -- requiring it is what keeps that silent dead end from starting.
function Test-WebPortUrlCoherent {
  param([int] $Port, [string] $ServerUrl, [string] $ComposeDefaultUrl)
  $effective = Get-EffectiveServerUrl -ServerUrl $ServerUrl -ComposeDefaultUrl $ComposeDefaultUrl
  if ($null -eq $effective) { return $false }
  return $effective -eq "http://localhost:$Port"
}

# Pure: rewrites KEY=value lines, replacing the keys in $Values in place and
# appending the ones that were absent. Everything else -- comments, order,
# unrelated keys -- survives untouched, because this edits a file that also
# holds this install's secrets. Returns the new lines; never logs a value.
function Set-EnvKeyLines {
  param([string[]] $Lines, [System.Collections.IDictionary] $Values)
  $remaining = [System.Collections.Generic.List[string]]::new()
  foreach ($k in $Values.Keys) { $remaining.Add([string] $k) }
  $out = [System.Collections.Generic.List[string]]::new()
  foreach ($line in $Lines) {
    $replaced = $false
    if ($line -notmatch '^\s*#' -and $line -match '=') {
      $key = ($line -split '=', 2)[0].Trim()
      if ($Values.Contains($key)) {
        $out.Add("$key=$($Values[$key])")
        $null = $remaining.Remove($key)
        $replaced = $true
      }
    }
    if (-not $replaced) { $out.Add($line) }
  }
  foreach ($key in $remaining) { $out.Add("$key=$($Values[$key])") }
  return @($out)
}

# The local image reference. CRM-004-fix1 named every build
# `aos-crm-local/twenty:v2.51.0-15e4826d3b` -- the upstream pin and nothing
# else -- so each AOS commit overwrote the previous image's tag with different
# bytes, and `docker image inspect <tag>` could describe an artifact no service
# was running (observed twice on 2026-10-28: ImageID 86a21ef0 then 353a1cf2
# behind the same name). The reference now carries the AOS commit as well, so
# two different trees cannot share one name. Pure: takes the pin and the commit
# instead of reading either, so -SelfTest covers the format.
$ImageRepository = 'aos-crm-local/twenty'

function Get-SourcePinnedImageTag {
  param([string] $UpstreamTag, [string] $UpstreamSha, [string] $AosCommit)
  if ([string]::IsNullOrWhiteSpace($UpstreamTag) -or [string]::IsNullOrWhiteSpace($UpstreamSha) -or [string]::IsNullOrWhiteSpace($AosCommit)) { return $null }
  if ($UpstreamSha -notmatch '^[0-9a-f]{40}$' -or $AosCommit -notmatch '^[0-9a-f]{40}$') { return $null }
  # 'twenty/v2.51.0' -> 'v2.51.0'
  $version = ($UpstreamTag -split '/')[-1]
  if ([string]::IsNullOrWhiteSpace($version)) { return $null }
  return "${ImageRepository}:$version-$($UpstreamSha.Substring(0, 10))-aos$($AosCommit.Substring(0, 12))"
}

# Reads the upstream pin from the same docs/aos/bootstrap/provenance.json that
# CRM-001's gate and scripts/aos/verify-image-provenance.mjs read, so the name
# of the artifact cannot drift from the source it claims to come from. Returns
# $null if either input cannot be read: an image nobody can name correctly must
# not be built.
function Resolve-ImageTag {
  param([string] $RepoRoot, [string] $AosCommit)
  $provenancePath = Join-Path $RepoRoot 'docs/aos/bootstrap/provenance.json'
  if (-not (Test-Path -LiteralPath $provenancePath -PathType Leaf)) { return $null }
  try {
    $provenance = Get-Content -LiteralPath $provenancePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  } catch { return $null }
  return Get-SourcePinnedImageTag -UpstreamTag $provenance.upstream.tag -UpstreamSha $provenance.upstream.sha -AosCommit $AosCommit
}

# The identity of the source these bytes were built from: the AOS commit, its
# tree, and whether the working tree had uncommitted changes at build time. A
# dirty build must never be able to present itself as a clean commit, so the
# flag is part of the stamp rather than something a reader has to infer.
function Get-GitSourceStamp {
  param([string] $RepoRoot)
  $commit = (& git -C $RepoRoot rev-parse HEAD 2>$null)
  if ($LASTEXITCODE -ne 0) { return $null }
  $tree = (& git -C $RepoRoot rev-parse 'HEAD^{tree}' 2>$null)
  if ($LASTEXITCODE -ne 0) { return $null }
  $status = (& git -C $RepoRoot status --porcelain 2>$null)
  if ($LASTEXITCODE -ne 0) { return $null }
  return [ordered]@{
    AOS_CRM_SOURCE_COMMIT = $commit.Trim()
    AOS_CRM_SOURCE_TREE   = $tree.Trim()
    AOS_CRM_SOURCE_DIRTY  = (@($status | Where-Object { $_ -ne '' }).Count -gt 0) ? 'true' : 'false'
  }
}

# Stamps the source identity into deploy/local/.env so compose can label the
# image it is about to build with it, AND renames the image after that same
# commit so a different tree cannot reuse the name. Returns $true only if the
# whole stamp was written: a build whose provenance could not be recorded must
# not proceed.
function Update-SourceStamp {
  param([string] $RepoRoot, [string] $EnvPath)
  $stamp = Get-GitSourceStamp -RepoRoot $RepoRoot
  if ($null -eq $stamp) { return $false }
  if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { return $false }
  $tag = Resolve-ImageTag -RepoRoot $RepoRoot -AosCommit $stamp.AOS_CRM_SOURCE_COMMIT
  if ([string]::IsNullOrWhiteSpace($tag)) { return $false }
  $stamp.AOS_CRM_IMAGE_TAG = $tag
  $lines = @(Get-Content -LiteralPath $EnvPath -ErrorAction Stop)
  [System.IO.File]::WriteAllLines($EnvPath, (Set-EnvKeyLines -Lines $lines -Values $stamp))
  return $true
}

# Pure: turns `pgrep -f` output into pids. pgrep exits 1 and prints nothing
# when there is no match, and a broken/absent pgrep prints a message on stderr
# that must never be read as "the keeper is alive".
function Get-KeeperPids {
  param([string] $PgrepOutput)
  if ([string]::IsNullOrWhiteSpace($PgrepOutput)) { return @() }
  $pids = [System.Collections.Generic.List[int]]::new()
  foreach ($line in ($PgrepOutput -split "`r?`n")) {
    $trimmed = $line.Trim()
    if ($trimmed -notmatch '^\d+$') { continue }
    $pids.Add([int] $trimmed)
  }
  return @($pids)
}

# The server validates APP_VERSION with semver.parse() at boot
# (IsTwentySemVer) and refuses to start on anything it cannot parse, with a
# generic "Config variables validation failed" that the healthcheck only ever
# surfaces as "unhealthy". An empty/absent value is legal (the variable is
# optional), the upstream tag form is not.
function Test-AppVersionAcceptable {
  param([string] $AppVersion)
  if ([string]::IsNullOrWhiteSpace($AppVersion)) { return $true }
  return $AppVersion.Trim() -match '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$'
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

# Reads one field out of a `docker compose ps --format json` record,
# case-insensitively (the key casing is Compose's, not ours) and without
# throwing on a record that simply does not carry it.
function Get-ComposePsField {
  param([object] $Entry, [string] $Name, $Default = $null)
  $prop = $Entry.PSObject.Properties | Where-Object { $_.Name -ieq $Name } | Select-Object -First 1
  if ($null -eq $prop -or $null -eq $prop.Value) { return $Default }
  return $prop.Value
}

# Pure: turns `docker compose ps --format json --all` output into the one
# question Start/Restart have to answer -- is this stack actually up? -- and
# keeps "still starting" distinct from "down".
#
# Why it exists: on 2026-10-28 `up` exited 1 because the server exceeded its
# health window, and the orchestration reported only that exit code while the
# worker sat in Created and the server went on to become healthy two minutes
# later. An exit code alone cannot tell those two apart, and a Start that says
# nothing about the worker can "succeed" with no worker running at all.
#
# A service is up only when it is running AND its healthcheck is not failing
# (a service without a healthcheck reports no health, which is not a failure).
# Anything that is not running -- created, exited, restarting, paused, dead --
# is down, and its RestartCount travels into the detail so a crash loop is
# visible rather than inferred. Required services with no record at all are
# down too: this must fail closed, never on an empty read.
function Get-StackReadiness {
  param([string] $PsJsonOutput, [string[]] $RequiredServices = @('server', 'worker'))
  $observed = [ordered]@{}
  foreach ($line in ($PsJsonOutput -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try { $entry = $line | ConvertFrom-Json -ErrorAction Stop } catch { continue }
    $service = [string](Get-ComposePsField -Entry $entry -Name 'Service' -Default '')
    if ([string]::IsNullOrWhiteSpace($service)) { continue }
    # RestartCount is in Compose's schema but this version leaves it empty for
    # running containers (measured against the real stack), so it is reported
    # as unreported rather than as a zero nobody measured. The verdict does not
    # depend on it: a container that died and came back is in `restarting`, and
    # that state is read below.
    $restarts = 0
    $restartsKnown = [int]::TryParse([string](Get-ComposePsField -Entry $entry -Name 'RestartCount' -Default ''), [ref] $restarts)
    $observed[$service] = [ordered]@{
      State        = ([string](Get-ComposePsField -Entry $entry -Name 'State' -Default '')).ToLowerInvariant()
      Health       = ([string](Get-ComposePsField -Entry $entry -Name 'Health' -Default '')).ToLowerInvariant()
      RestartCount = if ($restartsKnown) { $restarts } else { $null }
    }
  }
  $parts = [System.Collections.Generic.List[string]]::new()
  $verdicts = [System.Collections.Generic.List[string]]::new()
  foreach ($name in $RequiredServices) {
    if (-not $observed.Contains($name)) {
      $verdicts.Add('down') | Out-Null
      $parts.Add("${name}: no container at all") | Out-Null
      continue
    }
    $info = $observed[$name]
    $verdict = if ($info.State -ne 'running') { 'down' }
      elseif ($info.Health -eq 'starting') { 'starting' }
      elseif ($info.Health -eq 'unhealthy') { 'down' }
      else { 'up' }
    $verdicts.Add($verdict) | Out-Null
    $health = if ($info.Health) { "/$($info.Health)" } else { '' }
    $restartText = if ($null -eq $info.RestartCount) { 'unreported' } else { [string]$info.RestartCount }
    $parts.Add("${name}: $($info.State)$health (restarts $restartText)") | Out-Null
  }
  $ready = (@($verdicts | Where-Object { $_ -ne 'up' }).Count -eq 0)
  $starting = (-not $ready) -and (@($verdicts | Where-Object { $_ -eq 'down' }).Count -eq 0)
  return [ordered]@{
    Ready    = $ready
    Starting = $starting
    Detail   = ($parts -join '; ')
    Services = $observed
  }
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
    [bool] $PortConfigValid = $true,
    [bool] $AppVersionAcceptable = $true
  )
  $blockers = [System.Collections.Generic.List[string]]::new()
  if (-not $AppVersionAcceptable) { $blockers.Add('app-version: AOS_CRM_APP_VERSION is not a version the server can parse (semver), so every start would crash-loop on config validation') }
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
  if (-not $WebPortUrlCoherent) { $blockers.Add('port: the effective SERVER_URL (AOS_CRM_SERVER_URL, or compose.yaml fallback when unset) does not match http://localhost:<AOS_CRM_WEB_PORT>; the beta profile resolves each workspace from a subdomain of that host, so an IP literal or a mismatched port starts a stack nobody can sign in to') }
  if (-not $ConfigVerifierOk) { $blockers.Add('config: node scripts/aos/verify-local-config.mjs did not pass') }
  switch ($PrivacyVerifierStatus) {
    'Missing' { $blockers.Add('privacy-verifier: scripts/aos/verify-privacy.mjs (CRM-003) is not delivered yet; blocking honestly until it exists') }
    'Fail' { $blockers.Add('privacy-verifier: scripts/aos/verify-privacy.mjs reported failures') }
  }
  return [ordered]@{ Proceed = ($blockers.Count -eq 0); Blockers = @($blockers) }
}

# Runs $KeeperInvoker and judges whether the distro session this stack needs is
# actually open. The invoker reports through $script:KeeperState (same
# convention as $script:ComposeExitCode, and for the same reason: its output is
# piped to Out-Host so `docker compose`'s own stream stays live, which means a
# return value cannot travel back). Anything other than a confirmed session --
# including an invoker that reported nothing at all -- is a failure: `up`
# without a keeper produces a stack that dies with the idle window, and that
# must not look like a successful start.
function Test-KeeperHeld {
  param([scriptblock] $KeeperInvoker)
  $script:KeeperState = $null
  & $KeeperInvoker | Out-Host
  return ($script:KeeperState -in @('started', 'already-running'))
}

# Orchestrates Start: computes the verdict, then only invokes the mutating
# $ComposeInvoker when every gate is green AND the distro session is held.
# -SelfTest swaps $ComposeInvoker for a non-mutating recorder, proving the
# wiring itself (not just the isolated boolean aggregator) refuses to reach
# Docker when blocked.
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
    [scriptblock] $KeeperInvoker = {},
    [scriptblock] $StackProbe = {},
    [bool] $PortConfigValid = $true,
    [bool] $AppVersionAcceptable = $true
  )
  $verdict = Get-StartGateVerdict -HostReady $HostReady -EnvCheck $EnvCheck -PrivacyCheck $PrivacyCheck `
    -PortOccupancy $PortOccupancy -WebPortUrlCoherent $WebPortUrlCoherent -ConfigVerifierOk $ConfigVerifierOk `
    -PrivacyVerifierStatus $PrivacyVerifierStatus -PortConfigValid $PortConfigValid `
    -AppVersionAcceptable $AppVersionAcceptable
  if (-not $verdict.Proceed) {
    return [ordered]@{ Invoked = $false; Verdict = $verdict; Stack = $null }
  }
  # Before `up`, not after: the session that has to outlive this process must
  # already be open when the containers start.
  # Piped to Out-Host, not left in the pipeline: a scriptblock that writes
  # anything to the output stream would otherwise be collected into this
  # function's return value, and the caller's `$result.Invoked` would fail on
  # an array. Out-Host still streams live, which `docker compose` needs.
  if (-not (Test-KeeperHeld -KeeperInvoker $KeeperInvoker)) {
    $keeperVerdict = [ordered]@{
      Proceed  = $false
      Blockers = @("keeper: the distro session keeper could not be confirmed (state: $($script:KeeperState ?? 'not reported')); refusing to start a stack that would die with the WSL idle window")
    }
    return [ordered]@{ Invoked = $false; Verdict = $keeperVerdict; Stack = $null }
  }
  & $ComposeInvoker | Out-Host
  # `up` returning is not a started stack (see Get-StackReadiness). This probe
  # is captured rather than streamed: it is a read-only query whose JSON is the
  # verdict, and joining the native string[] with a newline keeps the JSON
  # Lines shape its parser splits on.
  return [ordered]@{
    Invoked = $true; Verdict = $verdict
    Stack = (Get-StackReadiness -PsJsonOutput ((@(& $StackProbe) -join "`n")))
  }
}

# Stop is the only action that releases the distro session, and only once
# `compose down` really succeeded: killing the keeper while containers are
# still up would take them down by shutting the distro instead of stopping
# them, which is exactly the uncontrolled shutdown this orchestration exists
# to avoid. The down exit code travels via $script:ComposeExitCode (same
# convention as Invoke-RestartAction); the release outcome travels via
# $script:KeeperStopState, and a release that could NOT be confirmed is
# reported as a failure with its own exit code instead of being dropped: a
# keeper left behind after a successful `down` keeps the distro (and dockerd)
# alive for nothing, and silently exiting 0 is how that goes unnoticed.
function Invoke-StopAction {
  param([scriptblock] $DownInvoker, [scriptblock] $KeeperStopInvoker)
  & $DownInvoker | Out-Host
  $downExitCode = $script:ComposeExitCode
  if ($downExitCode -ne 0) {
    return [ordered]@{ Stage = 'down-failed'; KeeperReleased = $false; ExitCode = $downExitCode }
  }
  $script:KeeperStopState = $null
  & $KeeperStopInvoker | Out-Host
  if ($script:KeeperStopState -notin @('stopped', 'not-running')) {
    return [ordered]@{
      Stage          = 'keeper-release-failed'
      KeeperReleased = $false
      ExitCode       = 1
      KeeperState    = ($script:KeeperStopState ?? 'not reported')
    }
  }
  return [ordered]@{ Stage = 'stopped'; KeeperReleased = $true; ExitCode = 0 }
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
    [scriptblock] $KeeperInvoker = {},
    [scriptblock] $StackProbe = {},
    [bool] $PortConfigValid = $true,
    [bool] $AppVersionAcceptable = $true
  )
  $verdict = Get-StartGateVerdict -HostReady $HostReady -EnvCheck $EnvCheck -PrivacyCheck $PrivacyCheck `
    -PortOccupancy $PortOccupancy -WebPortUrlCoherent $WebPortUrlCoherent -ConfigVerifierOk $ConfigVerifierOk `
    -PrivacyVerifierStatus $PrivacyVerifierStatus -PortConfigValid $PortConfigValid `
    -AppVersionAcceptable $AppVersionAcceptable
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
  & $DownInvoker | Out-Host
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
  # Re-ensured here rather than released anywhere in this path: a restart must
  # not be the moment the stack loses the session holding its distro open. And
  # if it cannot be confirmed, the stack stays down instead of coming back up
  # with nothing holding the distro open.
  if (-not (Test-KeeperHeld -KeeperInvoker $KeeperInvoker)) {
    $keeperVerdict = [ordered]@{
      Proceed  = $false
      Blockers = @("keeper: the distro session keeper could not be confirmed (state: $($script:KeeperState ?? 'not reported')); refusing to start a stack that would die with the WSL idle window")
    }
    return [ordered]@{ Stage = 'blocked-keeper-failed'; Verdict = $keeperVerdict; ExitCode = 1 }
  }
  & $UpInvoker | Out-Host
  return [ordered]@{
    Stage = 'started'; Verdict = $verdict
    Stack = (Get-StackReadiness -PsJsonOutput ((@(& $StackProbe) -join "`n")))
  }
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
  param([string] $LocalDir, [string] $EnvPath, [int] $WebPort, [string] $RepoRoot)
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
  # The image name carries the AOS commit, so it is derived rather than
  # hardcoded. Start/Restart re-derive it (Update-SourceStamp) immediately
  # before every build; this only has to be a usable value for `compose config`
  # in between.
  $stamp = Get-GitSourceStamp -RepoRoot $RepoRoot
  $imageTag = if ($null -ne $stamp) { Resolve-ImageTag -RepoRoot $RepoRoot -AosCommit $stamp.AOS_CRM_SOURCE_COMMIT } else { $null }
  if ([string]::IsNullOrWhiteSpace($imageTag)) {
    Write-Error 'could not derive the local image name from git HEAD and docs/aos/bootstrap/provenance.json; refusing to write a profile that would build an image nobody can trace.'
    $script:PrepareOk = $false
    return
  }
  New-Item -ItemType Directory -Path $LocalDir -Force | Out-Null
  $pgPassword = New-CryptoToken -Encoding Hex -Bytes 32
  $encryptionKey = New-CryptoToken -Encoding Base64 -Bytes 32
  $lines = @(
    '# Generated by scripts/aos/local.ps1 -Action Prepare. Never commit this file.',
    "AOS_CRM_IMAGE_TAG=$imageTag",
    # Semver, not the upstream tag: the server validates APP_VERSION with
    # semver.parse() at boot and rejects anything else (see compose.yaml).
    'AOS_CRM_APP_VERSION=2.51.0+15e4826d3b',
    "AOS_CRM_WEB_PORT=$WebPort",
    # localhost, not 127.0.0.1: the beta profile resolves each workspace from a
    # subdomain of this host (see compose.yaml and Test-WebPortUrlCoherent).
    "AOS_CRM_SERVER_URL=http://localhost:$WebPort",
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

# Asks the distro itself which keeper processes of OURS are alive, matched by
# the exact command line Start-DistroKeeper launches. Returns pids only.
function Get-DistroKeeperPids {
  param([string] $Distro)
  $out = & wsl.exe -d $Distro --exec pgrep -x -f (ConvertTo-EreLiteral $KeeperPattern) 2>$null
  if ($LASTEXITCODE -ne 0) { return @() }
  return Get-KeeperPids -PgrepOutput (@($out) -join "`n")
}

# Holds one hidden WSL session open so the distro (and dockerd, and every
# container) survives after every CLI invocation exits and the idle window
# passes. UseShellExecute + WindowStyle Hidden is the detached-and-invisible
# combination: the child gets its own console instead of inheriting this one,
# so closing the window that ran Start cannot take the stack down with it.
# .ArgumentList still builds the command line with real per-argument quoting
# (see Invoke-PowerShellScript for why -ArgumentList's array form is not used).
# Returns a category, never a handle: 'already-running' | 'started' | 'failed'.
function Start-DistroKeeper {
  param([string] $Distro, [int] $TimeoutSeconds = 30)
  if (@(Get-DistroKeeperPids -Distro $Distro).Count -gt 0) { return 'already-running' }
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = 'wsl.exe'
  foreach ($a in @('-d', $Distro, '--exec', 'sh', '-c', ": > $KeeperMarker; exec $KeeperPattern")) {
    $psi.ArgumentList.Add($a)
  }
  $psi.UseShellExecute = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  try {
    $null = [System.Diagnostics.Process]::Start($psi)
  } catch {
    return 'failed'
  }
  # Confirm by observation inside the distro, not by "Process.Start did not
  # throw": a session that dies immediately would otherwise read as started.
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (@(Get-DistroKeeperPids -Distro $Distro).Count -gt 0) { return 'started' }
    Start-Sleep -Milliseconds 500
  }
  return 'failed'
}

# Releases only this product's keeper, by its own command line. Never shuts
# down the distro, never touches another distribution, never edits global WSL
# configuration. 'not-running' | 'stopped' | 'failed'.
function Stop-DistroKeeper {
  param([string] $Distro, [int] $TimeoutSeconds = 20)
  if (@(Get-DistroKeeperPids -Distro $Distro).Count -eq 0) { return 'not-running' }
  & wsl.exe -d $Distro --exec pkill -x -f (ConvertTo-EreLiteral $KeeperPattern) 2>$null | Out-Null
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (@(Get-DistroKeeperPids -Distro $Distro).Count -eq 0) { return 'stopped' }
    Start-Sleep -Milliseconds 500
  }
  return 'failed'
}

# Asks Compose for the state of EVERY service of this project, including the
# ones that are not running (`--all`): a worker left in Created is exactly what
# a success verdict must not miss. Returns the raw JSON Lines text, or '' if it
# could not be read at all -- which Get-StackReadiness treats as "not up".
function Get-ComposePsJson {
  param([string] $RepoRoot, [string] $Distro)
  $linuxRootRaw = & wsl.exe -d $Distro --exec wslpath -a $RepoRoot
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($linuxRootRaw)) { return '' }
  $composePath = "$($linuxRootRaw.Trim())/$ComposeRelPath"
  $out = & wsl.exe -d $Distro --exec docker compose -f $composePath -p $ProjectName ps --format json --all 2>$null
  if ($LASTEXITCODE -ne 0) { return '' }
  return (@($out) -join "`n")
}

# Reports what the stack is actually doing after a mutating action. A compose
# exit code is preserved when it is non-zero, but it is never the whole answer:
# a zero exit with a worker in Created is not a started stack, and a non-zero
# exit on a stack still inside its health window is "still starting", not
# "crashed". Both end non-zero here -- this only refuses to call either of them
# success, and says which one it saw.
#
# The exit code travels out via $script:StackExitCode, not a return value, for
# the same reason as $script:ComposeExitCode: this function writes to the
# output stream, and capturing its result would collect those lines into the
# caller's value (the array leak this file has hit before).
function Write-StackOutcome {
  param(
    [string] $Action,
    [System.Collections.Specialized.OrderedDictionary] $Stack,
    [int] $ComposeExitCode
  )
  Write-Output "aos-crm-local services: $($Stack.Detail)"
  if ($ComposeExitCode -ne 0) {
    if ($Stack.Starting) {
      Write-Output "aos-crm-local: compose $Action exited $ComposeExitCode, but no service is down: the stack is STILL STARTING inside its health window. Re-check with -Action Status before concluding anything failed."
    } elseif ($Stack.Ready) {
      Write-Output "aos-crm-local: compose $Action exited $ComposeExitCode even though every required service is up; not reported as success."
    } else {
      Write-Output "aos-crm-local: compose $Action exited $ComposeExitCode and the stack is NOT up."
    }
    $script:StackExitCode = $ComposeExitCode
    return
  }
  if ($Stack.Ready) { $script:StackExitCode = 0; return }
  if ($Stack.Starting) {
    Write-Output "aos-crm-local: compose $Action exited 0 but the stack is still starting; not reported as a completed start."
  } else {
    Write-Output "aos-crm-local: compose $Action exited 0 while a required service is NOT running; not reported as success."
  }
  $script:StackExitCode = 1
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
    $composeDefaultUrl = Get-ComposeServerUrlDefault -ComposePath (Join-Path $RepoRoot $ComposeRelPath)
    $urlCoherent = Test-WebPortUrlCoherent -Port $resolvedPort -ServerUrl $serverUrl -ComposeDefaultUrl $composeDefaultUrl
    $configVerifierOk = Invoke-LocalConfigVerifier -RepoRoot $RepoRoot
    $privacyVerifierStatus = Invoke-PrivacyVerifierIfPresent -RepoRoot $RepoRoot
    # Empty when .env does not set it, which is correct: compose substitutes
    # its own semver default in that case.
    $appVersion = if ($envValues) { [string] $envValues['AOS_CRM_APP_VERSION'] } else { '' }
    return [ordered]@{
      AppVersionAcceptable  = (Test-AppVersionAcceptable -AppVersion $appVersion)
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
      Invoke-Prepare -LocalDir $LocalDir -EnvPath $EnvPath -WebPort $DefaultWebPort -RepoRoot $RepoRoot
      exit ($script:PrepareOk ? 0 : 1)
    }
    'Status' {
      # Read-only: does not require the start gate, reports it instead.
      $signals = Get-GateSignals
      $verdict = Get-StartGateVerdict -HostReady $signals.HostReady -EnvCheck $signals.EnvCheck -PrivacyCheck $signals.PrivacyCheck `
        -PortOccupancy $signals.PortOccupancy -WebPortUrlCoherent $signals.WebPortUrlCoherent -ConfigVerifierOk $signals.ConfigVerifierOk `
        -PrivacyVerifierStatus $signals.PrivacyVerifierStatus -PortConfigValid $signals.PortConfigValid -AppVersionAcceptable $signals.AppVersionAcceptable
      Write-Output "aos-crm-local gate: $(if ($verdict.Proceed) { 'READY to start' } else { 'NOT ready' }) (configured port: $($signals.ResolvedPort), occupancy: $($signals.PortOccupancy))"
      foreach ($b in $verdict.Blockers) { Write-Output "  - $b" }
      if ($signals.HostReady) {
        Write-Output "distro session keeper: $(if (@(Get-DistroKeeperPids -Distro $Distro).Count -gt 0) { 'running' } else { 'not running (the stack would not survive an idle window)' })"
        Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('ps')
        exit $script:ComposeExitCode
      }
      exit ($verdict.Proceed ? 0 : 1)
    }
    'Start' {
      $signals = Get-GateSignals
      $result = Invoke-StartAction -HostReady $signals.HostReady -EnvCheck $signals.EnvCheck -PrivacyCheck $signals.PrivacyCheck `
        -PortOccupancy $signals.PortOccupancy -WebPortUrlCoherent $signals.WebPortUrlCoherent -ConfigVerifierOk $signals.ConfigVerifierOk `
        -PrivacyVerifierStatus $signals.PrivacyVerifierStatus -PortConfigValid $signals.PortConfigValid -AppVersionAcceptable $signals.AppVersionAcceptable `
        -KeeperInvoker { $script:KeeperState = Start-DistroKeeper -Distro $Distro; Write-Output "distro session keeper: $script:KeeperState" } `
        -StackProbe { Get-ComposePsJson -RepoRoot $RepoRoot -Distro $Distro } `
        -ComposeInvoker {
          if (-not (Update-SourceStamp -RepoRoot $RepoRoot -EnvPath $EnvPath)) {
            Write-Output 'aos-crm-local: could not stamp the source commit/tree into deploy/local/.env; refusing to build an image nobody can trace back to a source.'
            $script:ComposeExitCode = 2
            return
          }
          Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('up', '--build', '-d')
        }
      if (-not $result.Invoked) {
        Write-Output 'aos-crm-local: BLOCKED (fail-closed), no build/up attempted:'
        foreach ($b in $result.Verdict.Blockers) { Write-Output "  - $b" }
        exit 1
      }
      # Bare statement, then the code: see Write-StackOutcome.
      Write-StackOutcome -Action 'up' -Stack $result.Stack -ComposeExitCode $script:ComposeExitCode
      exit $script:StackExitCode
    }
    'Stop' {
      $result = Invoke-StopAction `
        -DownInvoker { Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('down') } `
        -KeeperStopInvoker { $script:KeeperStopState = Stop-DistroKeeper -Distro $Distro; Write-Output "distro session keeper: $script:KeeperStopState" }
      if ($result.Stage -eq 'down-failed') {
        Write-Output "aos-crm-local: compose down exited $($result.ExitCode); the distro session keeper was left running on purpose."
      } elseif ($result.Stage -ne 'stopped') {
        Write-Output "aos-crm-local: compose down succeeded but the distro session keeper could not be released (state: $($result.KeeperState)); it is still holding the distro open."
      }
      exit $result.ExitCode
    }
    'Restart' {
      $signals = Get-GateSignals
      $result = Invoke-RestartAction -HostReady $signals.HostReady -EnvCheck $signals.EnvCheck -PrivacyCheck $signals.PrivacyCheck `
        -PortOccupancy $signals.PortOccupancy -WebPortUrlCoherent $signals.WebPortUrlCoherent -ConfigVerifierOk $signals.ConfigVerifierOk `
        -PrivacyVerifierStatus $signals.PrivacyVerifierStatus -PortConfigValid $signals.PortConfigValid -AppVersionAcceptable $signals.AppVersionAcceptable `
        -DownInvoker { Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('down') } `
        -PortFreeAfterDownProbe { Test-PortFree -Port $signals.ResolvedPort } `
        -KeeperInvoker { $script:KeeperState = Start-DistroKeeper -Distro $Distro; Write-Output "distro session keeper: $script:KeeperState" } `
        -StackProbe { Get-ComposePsJson -RepoRoot $RepoRoot -Distro $Distro } `
        -UpInvoker {
          if (-not (Update-SourceStamp -RepoRoot $RepoRoot -EnvPath $EnvPath)) {
            Write-Output 'aos-crm-local: could not stamp the source commit/tree into deploy/local/.env; refusing to build an image nobody can trace back to a source.'
            $script:ComposeExitCode = 2
            return
          }
          Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('up', '--build', '-d')
        }
      if ($result.Stage -ne 'started') {
        Write-Output 'aos-crm-local: BLOCKED (fail-closed):'
        foreach ($b in $result.Verdict.Blockers) { Write-Output "  - $b" }
        exit $result.ExitCode
      }
      # Bare statement, then the code: see Write-StackOutcome.
      Write-StackOutcome -Action 'up' -Stack $result.Stack -ComposeExitCode $script:ComposeExitCode
      exit $script:StackExitCode
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
  # Read-only here: the image-name cases below need this repo's HEAD and its
  # docs/aos/bootstrap/provenance.json. Nothing under it is written -- every
  # fixture lives in $tmpRoot.
  $RepoRootForSelfTest = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
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

    Record 'Test-WebPortUrlCoherent: an explicit URL must match the resolved port' {
      if (-not (Test-WebPortUrlCoherent -Port 43000 -ServerUrl 'http://localhost:43000' -ComposeDefaultUrl 'http://localhost:43000')) { throw 'expected a matching URL to be coherent' }
      if (Test-WebPortUrlCoherent -Port 43000 -ServerUrl 'http://localhost:9999' -ComposeDefaultUrl 'http://localhost:43000') { throw 'expected a mismatched URL to be incoherent' }
    }

    Record 'Test-WebPortUrlCoherent: the beta profile needs a host that can carry workspace subdomains, so an IP literal on the right port is still incoherent (CRM-014)' {
      if (Test-WebPortUrlCoherent -Port 43000 -ServerUrl 'http://127.0.0.1:43000' -ComposeDefaultUrl 'http://localhost:43000') { throw 'expected an IP-literal SERVER_URL to be incoherent: no browser-resolvable subdomain exists under it, so every origin would map to no workspace' }
      if (Test-WebPortUrlCoherent -Port 43000 -ServerUrl 'http://[::1]:43000' -ComposeDefaultUrl 'http://localhost:43000') { throw 'expected an IPv6-literal SERVER_URL to be incoherent for the same reason' }
    }

    Record "Test-WebPortUrlCoherent: an unset URL resolves to compose.yaml's fixed fallback, so a custom port without a URL is incoherent (the exact gap carried over from CRM-002)" {
      if (-not (Test-WebPortUrlCoherent -Port 43000 -ServerUrl '' -ComposeDefaultUrl 'http://localhost:43000')) { throw 'expected an unset URL on the default port to be coherent' }
      if (Test-WebPortUrlCoherent -Port 51234 -ServerUrl '' -ComposeDefaultUrl 'http://localhost:43000') { throw 'expected an unset URL on a custom port to be incoherent: compose would hand the app the 43000 fallback while publishing 51234' }
      if (Test-WebPortUrlCoherent -Port 43000 -ServerUrl '' -ComposeDefaultUrl '') { throw 'expected an undeterminable compose fallback to fail closed, not pass' }
    }

    Record 'Get-ComposeServerUrlDefault: reads the real fallback out of the real compose.yaml, and fails closed on a file without one' {
      $realCompose = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path $ComposeRelPath
      $realDefault = Get-ComposeServerUrlDefault -ComposePath $realCompose
      if ($realDefault -notmatch '^http://localhost:\d+$') { throw "expected a localhost fallback URL from the real compose.yaml (the beta profile resolves workspaces from subdomains of it), got '$realDefault'" }

      $p = Join-Path $tmpRoot 'compose-no-default.yaml'
      Set-Content -LiteralPath $p -Value @('services:', '  server:', '    environment:', '      SERVER_URL: ${AOS_CRM_SERVER_URL}')
      if ($null -ne (Get-ComposeServerUrlDefault -ComposePath $p)) { throw 'expected $null when compose.yaml declares no fallback' }
      if ($null -ne (Get-ComposeServerUrlDefault -ComposePath (Join-Path $tmpRoot 'compose-missing.yaml'))) { throw 'expected $null for a missing compose.yaml' }
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
      $result = Invoke-StartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -KeeperInvoker { $script:KeeperState = 'started' } -ComposeInvoker { $calls[0] += 1 }
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
        -DownInvoker { $script:ComposeExitCode = 0; $order.Add('down') } -PortFreeAfterDownProbe { $order.Add('probe'); $true } `
        -KeeperInvoker { $script:KeeperState = 'started' } -UpInvoker { $order.Add('up') }
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

    # CRM-004 fix3. `up` exited 1 on a server that was merely still inside its
    # health window, the worker was left in Created, and the orchestration
    # reported only that exit code. A started stack is now a measured claim.
    Record 'Get-StackReadiness: both services running and healthy is the only thing read as up' {
      $json = @(
        '{"Service":"server","State":"running","Health":"healthy","RestartCount":0}',
        '{"Service":"worker","State":"running","Health":"","RestartCount":0}'
      ) -join "`n"
      $r = Get-StackReadiness -PsJsonOutput $json
      if (-not $r.Ready) { throw "expected Ready=true, got detail: $($r.Detail)" }
      if ($r.Starting) { throw 'a ready stack must not also report Starting' }
    }

    Record 'Get-StackReadiness: a worker left in Created is NOT a started stack, however healthy the server is (the exact 18:36 UTC defect)' {
      $json = @(
        '{"Service":"server","State":"running","Health":"healthy","RestartCount":0}',
        '{"Service":"worker","State":"created","Health":"","RestartCount":0}'
      ) -join "`n"
      $r = Get-StackReadiness -PsJsonOutput $json
      if ($r.Ready) { throw 'expected Ready=false with the worker in Created' }
      if ($r.Starting) { throw 'a worker that was never started is down, not "still starting"' }
      if ($r.Detail -notmatch 'worker: created') { throw "expected the worker state in the detail, got: $($r.Detail)" }
    }

    Record 'Get-StackReadiness: "still starting" is distinguished from "down" by state and health' {
      $starting = Get-StackReadiness -PsJsonOutput (@(
        '{"Service":"server","State":"running","Health":"starting","RestartCount":0}',
        '{"Service":"worker","State":"running","Health":"","RestartCount":0}'
      ) -join "`n")
      if ($starting.Ready) { throw 'a server inside its health window is not up yet' }
      if (-not $starting.Starting) { throw 'expected Starting=true for a server still inside its health window' }

      $unhealthy = Get-StackReadiness -PsJsonOutput (@(
        '{"Service":"server","State":"running","Health":"unhealthy","RestartCount":0}',
        '{"Service":"worker","State":"running","Health":"","RestartCount":0}'
      ) -join "`n")
      if ($unhealthy.Starting) { throw 'an unhealthy server is down, not still starting' }
      if ($unhealthy.Ready) { throw 'an unhealthy server is not up' }
    }

    Record 'Get-StackReadiness: a crash-looping service is down and its RestartCount is reported, not inferred' {
      $r = Get-StackReadiness -PsJsonOutput (@(
        '{"Service":"server","State":"restarting","Health":"","RestartCount":7}',
        '{"Service":"worker","State":"running","Health":"","RestartCount":0}'
      ) -join "`n")
      if ($r.Ready -or $r.Starting) { throw 'a restarting service is down' }
      if ($r.Detail -notmatch 'restarts 7') { throw "expected the restart count in the detail, got: $($r.Detail)" }
    }

    Record 'Get-StackReadiness: a RestartCount Compose did not report is said to be unreported, not claimed as zero (measured: this Compose leaves it empty)' {
      $r = Get-StackReadiness -PsJsonOutput (@(
        '{"Service":"server","State":"running","Health":"healthy","RestartCount":""}',
        '{"Service":"worker","State":"running","Health":""}'
      ) -join "`n")
      if (-not $r.Ready) { throw "a missing RestartCount must not change the verdict: $($r.Detail)" }
      if ($r.Detail -notmatch 'restarts unreported') { throw "expected an unreported restart count to say so, got: $($r.Detail)" }
      if ($r.Detail -match 'restarts 0') { throw "expected no claim of zero restarts, got: $($r.Detail)" }
    }

    Record 'Get-StackReadiness: an unreadable or empty `compose ps` fails closed instead of reading as up' {
      foreach ($output in @('', '   ', 'not json at all', '{"Service":"db","State":"running","Health":"healthy"}')) {
        $r = Get-StackReadiness -PsJsonOutput $output
        if ($r.Ready) { throw "expected Ready=false for output '$output'" }
        if ($r.Starting) { throw "expected Starting=false for output '$output': nothing was measured" }
      }
    }

    Record 'Invoke-StartAction: a stack whose worker never started is not reported as a successful start, and the compose exit code is not the whole verdict' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $result = Invoke-StartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -KeeperInvoker { $script:KeeperState = 'started' } -ComposeInvoker { $script:ComposeExitCode = 0 } `
        -StackProbe {
          @(
            '{"Service":"server","State":"running","Health":"healthy","RestartCount":0}',
            '{"Service":"worker","State":"created","Health":"","RestartCount":0}'
          )
        }
      if (-not $result.Invoked) { throw 'expected the gate to have let up run' }
      if ($result.Stack.Ready) { throw 'expected the orchestration itself to report a stack that is not up' }
      Write-StackOutcome -Action 'up' -Stack $result.Stack -ComposeExitCode 0 *> $null
      if ($script:StackExitCode -eq 0) { throw 'a compose exit 0 with no worker running must not exit 0' }
    }

    Record 'Invoke-StartAction: a started stack probed as running and healthy does exit 0 (the fix does not block a good start)' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $result = Invoke-StartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -KeeperInvoker { $script:KeeperState = 'started' } -ComposeInvoker { $script:ComposeExitCode = 0 } `
        -StackProbe {
          @(
            '{"Service":"server","State":"running","Health":"healthy","RestartCount":0}',
            '{"Service":"worker","State":"running","Health":"","RestartCount":0}'
          )
        }
      if (-not $result.Stack.Ready) { throw "expected Ready=true, got: $($result.Stack.Detail)" }
      Write-StackOutcome -Action 'up' -Stack $result.Stack -ComposeExitCode 0 *> $null
      if ($script:StackExitCode -ne 0) { throw "expected exit 0 for a fully started stack, got $($script:StackExitCode)" }
    }

    Record 'Invoke-StartAction: a stack that could not be probed at all is not a successful start (fail-closed default)' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $result = Invoke-StartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -KeeperInvoker { $script:KeeperState = 'started' } -ComposeInvoker { $script:ComposeExitCode = 0 }
      if ($result.Stack.Ready -or $result.Stack.Starting) { throw 'an unprobed stack must not be read as up or starting' }
      Write-StackOutcome -Action 'up' -Stack $result.Stack -ComposeExitCode 0 *> $null
      if ($script:StackExitCode -eq 0) { throw 'expected a non-zero exit when the stack state was never measured' }
    }

    Record 'Invoke-RestartAction: the same post-up measurement applies to Restart, and a still-starting stack is not called crashed' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $result = Invoke-RestartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'OwnedBySelf' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -DownInvoker { $script:ComposeExitCode = 0 } -PortFreeAfterDownProbe { $true } `
        -KeeperInvoker { $script:KeeperState = 'started' } -UpInvoker { $script:ComposeExitCode = 1 } `
        -StackProbe {
          @(
            '{"Service":"server","State":"running","Health":"starting","RestartCount":0}',
            '{"Service":"worker","State":"running","Health":"","RestartCount":0}'
          )
        }
      if ($result.Stage -ne 'started') { throw "expected Stage=started, got $($result.Stage)" }
      if (-not $result.Stack.Starting) { throw 'expected the restart to report a stack still starting' }
      $output = Write-StackOutcome -Action 'up' -Stack $result.Stack -ComposeExitCode 1 *>&1
      if ($script:StackExitCode -ne 1) { throw "expected the compose exit code 1 to be preserved, got $($script:StackExitCode)" }
      if (($output -join ' ') -notmatch 'STILL STARTING') { throw "expected the report to distinguish still-starting from down, got: $($output -join ' ')" }
    }

    Record 'the startup health window in the real compose.yaml covers the worst start measured on this host' {
      $compose = Get-Content -LiteralPath (Join-Path $RepoRootForSelfTest $ComposeRelPath) -Raw
      $startPeriod = [int]([regex]::Match($compose, 'start_period:\s*(\d+)s').Groups[1].Value)
      $interval = [int]([regex]::Match($compose, 'healthcheck:[\s\S]*?interval:\s*(\d+)s').Groups[1].Value)
      $retries = [int]([regex]::Match($compose, 'healthcheck:[\s\S]*?retries:\s*(\d+)').Groups[1].Value)
      if ($startPeriod -le 0 -or $interval -le 0 -or $retries -le 0) { throw "could not read the server healthcheck window out of compose.yaml (start_period=$startPeriod interval=$interval retries=$retries)" }
      # 516 s is the measured worst case: the official entrypoint boots Nest
      # four times before the server listens (2026-10-28, BUILD_BASELINE.md).
      $measuredWorstCaseSeconds = 516
      $window = $startPeriod + ($interval * $retries)
      if ($window -le $measuredWorstCaseSeconds) { throw "the health window ($window s) does not even cover the measured worst start ($measuredWorstCaseSeconds s)" }
      if ($startPeriod -lt $measuredWorstCaseSeconds) { throw "start_period ($startPeriod s) is below the measured worst start ($measuredWorstCaseSeconds s), so a normal cold start would count failures" }
      # The detection of a server that dies AFTER listening must not widen with it.
      if (($interval * $retries) -gt 300) { throw "the post-start failure window ($($interval * $retries) s) was widened; a dead server must still be caught quickly" }
    }

    Record 'Test-AppVersionAcceptable: the value the server would reject at boot is rejected here instead (the crash loop this track hit)' {
      if (-not (Test-AppVersionAcceptable -AppVersion '2.51.0+15e4826d3b')) { throw 'expected semver with build metadata to be accepted' }
      if (-not (Test-AppVersionAcceptable -AppVersion '')) { throw 'expected an absent value to be acceptable (the server treats it as optional)' }
      if (Test-AppVersionAcceptable -AppVersion 'twenty-v2.51.0+15e4826d3b') { throw 'expected the upstream tag form to be rejected: semver.parse() returns null for it' }
      if (Test-AppVersionAcceptable -AppVersion '2.51') { throw 'expected an incomplete version to be rejected' }
    }

    Record 'Get-StartGateVerdict: an APP_VERSION the server cannot parse blocks before any build' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $v = Get-StartGateVerdict -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' -AppVersionAcceptable $false
      if ($v.Proceed) { throw 'expected Proceed=false for an unparseable APP_VERSION' }
      if (-not (@($v.Blockers) -match 'app-version:')) { throw 'expected an app-version: blocker' }
    }

    Record 'Invoke-StartAction: invokers that write to the output stream do not turn the verdict into an array (the $result.Invoked defect this track hit on the real Start path)' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $result = Invoke-StartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -KeeperInvoker { $script:KeeperState = 'started'; Write-Output 'keeper chatter' } -ComposeInvoker { Write-Output 'compose chatter' }
      if ($result -is [array]) { throw 'the verdict came back as an array: invoker output leaked into the return value' }
      if (-not $result.Invoked) { throw 'expected Invoked=true' }
    }

    Record 'Invoke-StopAction: the same leak is impossible on the stop path' {
      $result = Invoke-StopAction -DownInvoker { Write-Output 'down chatter'; $script:ComposeExitCode = 0 } -KeeperStopInvoker { $script:KeeperStopState = 'stopped'; Write-Output 'keeper chatter' }
      if ($result -is [array]) { throw 'the stop result came back as an array' }
      if ($result.Stage -ne 'stopped') { throw "expected Stage=stopped, got $($result.Stage)" }
    }

    Record 'Set-EnvKeyLines: replaces a key in place, appends a missing one and leaves every other line (and the secrets) untouched' {
      $before = @('# generated', 'AOS_CRM_PG_PASSWORD=keep-me', 'AOS_CRM_SOURCE_COMMIT=old', '# AOS_CRM_SOURCE_TREE=commented-out')
      $after = Set-EnvKeyLines -Lines $before -Values ([ordered]@{ AOS_CRM_SOURCE_COMMIT = 'new'; AOS_CRM_SOURCE_TREE = 'tree' })
      if (@($after | Where-Object { $_ -eq 'AOS_CRM_PG_PASSWORD=keep-me' }).Count -ne 1) { throw 'an unrelated key was dropped or duplicated' }
      if (@($after | Where-Object { $_ -eq 'AOS_CRM_SOURCE_COMMIT=new' }).Count -ne 1) { throw 'the existing key was not replaced exactly once' }
      if (@($after | Where-Object { $_ -match '^AOS_CRM_SOURCE_COMMIT=old$' }).Count -ne 0) { throw 'the old value survived' }
      if (@($after | Where-Object { $_ -eq 'AOS_CRM_SOURCE_TREE=tree' }).Count -ne 1) { throw 'the missing key was not appended exactly once' }
      if (@($after | Where-Object { $_ -eq '# AOS_CRM_SOURCE_TREE=commented-out' }).Count -ne 1) { throw 'a commented line was rewritten' }
      if (@($after)[0] -ne '# generated') { throw 'the leading comment moved' }
    }

    Record 'Get-KeeperPids: reads pids out of real pgrep output and ignores anything that is not one' {
      if (@(Get-KeeperPids -PgrepOutput "123`n456").Count -ne 2) { throw 'expected two pids' }
      if (@(Get-KeeperPids -PgrepOutput '').Count -ne 0) { throw 'expected no pid from empty output (pgrep exits 1 with no match)' }
      if (@(Get-KeeperPids -PgrepOutput "pgrep: not found`n").Count -ne 0) { throw 'expected a non-numeric line to be ignored, not parsed as a pid' }
      if (@(Get-KeeperPids -PgrepOutput " 789 `n`n").Count -ne 1) { throw 'expected whitespace/blank lines to be tolerated' }
    }

    Record 'Invoke-StartAction: the distro session is held open BEFORE compose up, so the stack cannot outlive its own WSL session' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-StartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -KeeperInvoker { $script:KeeperState = 'started'; $order.Add('keeper') } -ComposeInvoker { $order.Add('up') }
      if (-not $result.Invoked) { throw 'expected Invoked=true' }
      if (($order -join ',') -ne 'keeper,up') { throw "expected keeper,up in order, got $($order -join ',')" }
    }

    Record 'Invoke-StartAction: a blocked verdict never starts the keeper either (no side effect on the host from a failed gate)' {
      $envMissing = [ordered]@{ Exists = $false; MissingKeys = @($RequiredEnvKeys); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-StartAction -HostReady $true -EnvCheck $envMissing -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -KeeperInvoker { $order.Add('keeper') } -ComposeInvoker { $order.Add('up') }
      if ($result.Invoked) { throw 'expected Invoked=false' }
      if ($order.Count -ne 0) { throw "expected neither keeper nor up to run, ran: $($order -join ',')" }
    }

    Record 'Invoke-StopAction: compose down first, and only then is the distro session released' {
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-StopAction -DownInvoker { $script:ComposeExitCode = 0; $order.Add('down') } -KeeperStopInvoker { $script:KeeperStopState = 'stopped'; $order.Add('keeper-stop') }
      if ($result.Stage -ne 'stopped') { throw "expected Stage=stopped, got $($result.Stage)" }
      if (($order -join ',') -ne 'down,keeper-stop') { throw "expected down,keeper-stop in order, got $($order -join ',')" }
    }

    Record 'Invoke-StopAction: a failed compose down keeps the session alive and preserves its exit code (releasing it would kill containers that are still up)' {
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-StopAction -DownInvoker { $script:ComposeExitCode = 7; $order.Add('down') } -KeeperStopInvoker { $order.Add('keeper-stop') }
      if ($result.Stage -ne 'down-failed') { throw "expected Stage=down-failed, got $($result.Stage)" }
      if ($result.ExitCode -ne 7) { throw "expected exit code 7 preserved, got $($result.ExitCode)" }
      if (($order -join ',') -ne 'down') { throw "expected the keeper to survive a failed down, ran: $($order -join ',')" }
    }

    Record 'Invoke-RestartAction: the keeper is re-ensured after down and before up, never released mid-restart' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-RestartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'OwnedBySelf' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -DownInvoker { $script:ComposeExitCode = 0; $order.Add('down') } -PortFreeAfterDownProbe { $order.Add('probe'); $true } `
        -KeeperInvoker { $script:KeeperState = 'started'; $order.Add('keeper') } -UpInvoker { $order.Add('up') }
      if ($result.Stage -ne 'started') { throw "expected Stage=started, got $($result.Stage)" }
      if (($order -join ',') -ne 'down,probe,keeper,up') { throw "expected down,probe,keeper,up in order, got $($order -join ',')" }
    }

    # CRM-004 fix2. Main already computed and passed -AppVersionAcceptable, but
    # neither orchestrator DECLARED it: a simple PowerShell function silently
    # collects unknown named arguments into $args, so the value landed nowhere
    # and both Start and Restart ran `up` on a configuration the server rejects
    # at boot. The isolated Get-StartGateVerdict test above passed throughout,
    # which is exactly why the orchestration needs its own coverage.
    Record 'Invoke-StartAction: an APP_VERSION the server cannot parse blocks the real orchestration, not just the isolated aggregator' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-StartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -AppVersionAcceptable $false `
        -KeeperInvoker { $script:KeeperState = 'started'; $order.Add('keeper') } -ComposeInvoker { $order.Add('up') }
      if ($result.Invoked) { throw 'expected Invoked=false for an unparseable APP_VERSION' }
      if (-not (@($result.Verdict.Blockers) -match 'app-version:')) { throw "expected an app-version: blocker, got: $($result.Verdict.Blockers -join '; ')" }
      if ($order.Count -ne 0) { throw "expected neither keeper nor up to run, ran: $($order -join ',')" }
    }

    Record 'Invoke-RestartAction: an APP_VERSION the server cannot parse blocks before down, up or the keeper' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-RestartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'OwnedBySelf' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -AppVersionAcceptable $false `
        -DownInvoker { $script:ComposeExitCode = 0; $order.Add('down') } -PortFreeAfterDownProbe { $order.Add('probe'); $true } `
        -KeeperInvoker { $script:KeeperState = 'started'; $order.Add('keeper') } -UpInvoker { $order.Add('up') }
      if ($result.Stage -ne 'blocked-before-down') { throw "expected Stage=blocked-before-down, got $($result.Stage)" }
      if (-not (@($result.Verdict.Blockers) -match 'app-version:')) { throw "expected an app-version: blocker, got: $($result.Verdict.Blockers -join '; ')" }
      if ($order.Count -ne 0) { throw "expected nothing to run, ran: $($order -join ',')" }
    }

    Record 'Invoke-StartAction: a keeper that could not be confirmed blocks `up` instead of starting a stack that dies with the idle window' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      foreach ($state in @('failed', $null)) {
        $order = [System.Collections.Generic.List[string]]::new()
        $stateToReport = $state
        $result = Invoke-StartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
          -KeeperInvoker { $script:KeeperState = $stateToReport; $order.Add('keeper') } -ComposeInvoker { $order.Add('up') }
        if ($result.Invoked) { throw "expected Invoked=false when the keeper reported '$state'" }
        if (-not (@($result.Verdict.Blockers) -match '^keeper:')) { throw 'expected a keeper: blocker' }
        if (($order -join ',') -ne 'keeper') { throw "expected the keeper attempt and no up, ran: $($order -join ',')" }
      }
    }

    Record 'Invoke-RestartAction: a keeper that could not be confirmed after down refuses to bring the stack back up' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-RestartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'OwnedBySelf' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -DownInvoker { $script:ComposeExitCode = 0; $order.Add('down') } -PortFreeAfterDownProbe { $order.Add('probe'); $true } `
        -KeeperInvoker { $script:KeeperState = 'failed'; $order.Add('keeper') } -UpInvoker { $order.Add('up') }
      if ($result.Stage -ne 'blocked-keeper-failed') { throw "expected Stage=blocked-keeper-failed, got $($result.Stage)" }
      if ($result.ExitCode -eq 0) { throw 'expected a non-zero exit code' }
      if (($order -join ',') -ne 'down,probe,keeper') { throw "expected down,probe,keeper without up, got $($order -join ',')" }
    }

    Record 'Invoke-StartAction: a keeper that was ALREADY running counts as held (a restart must not re-block on it)' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $order = [System.Collections.Generic.List[string]]::new()
      $result = Invoke-StartAction -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortOccupancy 'Free' -WebPortUrlCoherent $true -ConfigVerifierOk $true -PrivacyVerifierStatus 'Pass' `
        -KeeperInvoker { $script:KeeperState = 'already-running' } -ComposeInvoker { $order.Add('up') }
      if (-not $result.Invoked) { throw 'expected an already-running keeper to be accepted' }
      if (($order -join ',') -ne 'up') { throw "expected up to run, ran: $($order -join ',')" }
    }

    Record 'Invoke-StopAction: a keeper that could not be released is a non-zero exit, not a silent success' {
      foreach ($state in @('failed', $null)) {
        $stateToReport = $state
        $result = Invoke-StopAction -DownInvoker { $script:ComposeExitCode = 0 } -KeeperStopInvoker { $script:KeeperStopState = $stateToReport }
        if ($result.Stage -ne 'keeper-release-failed') { throw "expected Stage=keeper-release-failed for '$state', got $($result.Stage)" }
        if ($result.ExitCode -eq 0) { throw 'expected a non-zero exit code' }
        if ($result.KeeperReleased) { throw 'expected KeeperReleased=false' }
      }
      $notRunning = Invoke-StopAction -DownInvoker { $script:ComposeExitCode = 0 } -KeeperStopInvoker { $script:KeeperStopState = 'not-running' }
      if ($notRunning.Stage -ne 'stopped') { throw "a keeper that was not running is already released, got $($notRunning.Stage)" }
    }

    Record 'ConvertTo-EreLiteral: every regex metacharacter in our own keeper line is escaped, so `pgrep -x -f` can only mean that exact line' {
      $escaped = ConvertTo-EreLiteral -Text 'tail -f /tmp/a.b+c[d]'
      if ($escaped -ne 'tail -f /tmp/a\.b\+c\[d\]') { throw "unexpected escaping: $escaped" }
      if ((ConvertTo-EreLiteral -Text $KeeperPattern) -ne $KeeperPattern) { throw 'the current keeper line needs no escaping, so it must come back unchanged' }
      # The regression this closes: the pattern used to be passed to `pgrep -f`
      # unanchored, which matches any command line CONTAINING it.
      if ([System.Text.RegularExpressions.Regex]::IsMatch("$KeeperPattern-2", "^$(ConvertTo-EreLiteral -Text $KeeperPattern)$")) {
        throw 'an anchored match still matched a longer, foreign command line'
      }
      if (-not [System.Text.RegularExpressions.Regex]::IsMatch($KeeperPattern, "^$(ConvertTo-EreLiteral -Text $KeeperPattern)$")) {
        throw 'the anchored pattern no longer matches our own keeper line'
      }
    }

    Record 'the keeper is looked up and released by its exact anchored command line, never by substring' {
      $source = Get-Content -LiteralPath $PSCommandPath -Raw
      if ($source -notmatch 'pgrep -x -f \(ConvertTo-EreLiteral \$KeeperPattern\)') { throw 'Get-DistroKeeperPids no longer uses an anchored, escaped pgrep' }
      if ($source -notmatch 'pkill -x -f \(ConvertTo-EreLiteral \$KeeperPattern\)') { throw 'Stop-DistroKeeper no longer uses an anchored, escaped pkill' }
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
      Invoke-Prepare -LocalDir $localDir -EnvPath $envPath -WebPort $freePort -RepoRoot $RepoRootForSelfTest *> $null
      $after = Get-Content -LiteralPath $envPath -Raw
      if ($before -ne $after) { throw 'Prepare must not modify an existing .env' }
    }

    Record 'Invoke-Prepare: the profile it writes names the image after BOTH the upstream pin and this AOS commit' {
      $localDir = Join-Path $tmpRoot 'prepare-fresh'
      $envPath = Join-Path $localDir '.env'
      $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), 0)
      $listener.Start(); $freePort = $listener.LocalEndpoint.Port; $listener.Stop()
      Invoke-Prepare -LocalDir $localDir -EnvPath $envPath -WebPort $freePort -RepoRoot $RepoRootForSelfTest *> $null
      if (-not $script:PrepareOk) { throw 'expected Prepare to succeed on a free port' }
      $written = (Read-EnvKeys -Path $envPath)['AOS_CRM_IMAGE_TAG']
      $head = (& git -C $RepoRootForSelfTest rev-parse HEAD).Trim()
      if ($written -notmatch '15e4826d3b') { throw "the written tag does not name the upstream pin: $written" }
      if ($written -notlike "*aos$($head.Substring(0,12))") { throw "the written tag does not name this AOS commit: $written" }
      if ($written -eq "${ImageRepository}:v2.51.0-15e4826d3b") { throw 'the written tag is the base reference alone, which every AOS commit would overwrite' }
    }

    Record 'Get-SourcePinnedImageTag: a missing or malformed input yields no name at all, so nothing gets built' {
      $pin = '15e4826d3b5fc5867baeabeeb42b253892b2d4da'
      $commit = 'a' * 40
      $good = Get-SourcePinnedImageTag -UpstreamTag 'twenty/v2.51.0' -UpstreamSha $pin -AosCommit $commit
      if ($good -ne "${ImageRepository}:v2.51.0-15e4826d3b-aos$('a' * 12)") { throw "unexpected tag: $good" }
      if ($null -ne (Get-SourcePinnedImageTag -UpstreamTag 'twenty/v2.51.0' -UpstreamSha $pin -AosCommit '')) { throw 'expected no tag without an AOS commit' }
      if ($null -ne (Get-SourcePinnedImageTag -UpstreamTag 'twenty/v2.51.0' -UpstreamSha 'not-a-sha' -AosCommit $commit)) { throw 'expected no tag from a malformed pin' }
      if ($null -ne (Get-SourcePinnedImageTag -UpstreamTag '' -UpstreamSha $pin -AosCommit $commit)) { throw 'expected no tag without an upstream tag' }
      if ($null -ne (Get-SourcePinnedImageTag -UpstreamTag 'twenty/v2.51.0' -UpstreamSha $pin -AosCommit ('b' * 39))) { throw 'expected no tag from a short commit' }
    }

    Record 'Resolve-ImageTag: reads the pin from the same provenance.json the provenance gate reads' {
      $head = (& git -C $RepoRootForSelfTest rev-parse HEAD).Trim()
      $resolved = Resolve-ImageTag -RepoRoot $RepoRootForSelfTest -AosCommit $head
      $pin = (Get-Content -LiteralPath (Join-Path $RepoRootForSelfTest 'docs/aos/bootstrap/provenance.json') -Raw | ConvertFrom-Json).upstream.sha
      if ($resolved -notmatch $pin.Substring(0, 10)) { throw "the resolved tag ignores provenance.json's pin: $resolved" }
      if ($null -ne (Resolve-ImageTag -RepoRoot $tmpRoot -AosCommit $head)) { throw 'expected no tag when provenance.json cannot be read' }
    }

    Record 'Update-SourceStamp: rewrites the image name to this commit and never touches a secret line' {
      $localDir = Join-Path $tmpRoot 'stamp'
      New-Item -ItemType Directory -Path $localDir -Force | Out-Null
      $envPath = Join-Path $localDir '.env'
      Set-Content -LiteralPath $envPath -Value @(
        '# generated',
        "AOS_CRM_IMAGE_TAG=${ImageRepository}:v2.51.0-15e4826d3b",
        'AOS_CRM_PG_PASSWORD=do-not-touch'
      )
      if (-not (Update-SourceStamp -RepoRoot $RepoRootForSelfTest -EnvPath $envPath)) { throw 'expected the stamp to be written' }
      $keys = Read-EnvKeys -Path $envPath
      $head = (& git -C $RepoRootForSelfTest rev-parse HEAD).Trim()
      if ($keys['AOS_CRM_IMAGE_TAG'] -notlike "*aos$($head.Substring(0,12))") { throw "the stamp left a commit-agnostic image name: $($keys['AOS_CRM_IMAGE_TAG'])" }
      if ($keys['AOS_CRM_SOURCE_COMMIT'] -ne $head) { throw 'the source commit was not stamped' }
      if ($keys['AOS_CRM_PG_PASSWORD'] -ne 'do-not-touch') { throw 'the stamp rewrote an unrelated secret line' }
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
