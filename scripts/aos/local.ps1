#Requires -Version 7.0
# AOS-CRM local profile orchestrator (CRM-002). Never builds/starts anything
# on its own: Start/Restart run a fail-closed gate (host, privacy contract,
# secrets, loopback port) BEFORE any `docker compose build`/`up`, and every
# docker invocation crosses into the dedicated WSL distro with --exec
# (literal argv; see docs/aos/bootstrap/HOST_RUNTIME.md for why `--` is not
# used here) so this script never needs Docker on the Windows host.
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

# Aggregates every gate signal into one fail-closed verdict. Pure: no I/O,
# so -SelfTest can cover every combination without touching the host.
function Get-StartGateVerdict {
  param(
    [bool] $HostReady,
    [System.Collections.Specialized.OrderedDictionary] $EnvCheck,
    [System.Collections.Specialized.OrderedDictionary] $PrivacyCheck,
    [bool] $PortFree
  )
  $blockers = [System.Collections.Generic.List[string]]::new()
  if (-not $HostReady) { $blockers.Add('host: preflight-host.ps1 did not report ready') }
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
  if (-not $PortFree) { $blockers.Add('port: the configured loopback web port is not free right now') }
  return [ordered]@{ Proceed = ($blockers.Count -eq 0); Blockers = @($blockers) }
}

# ---------------------------------------------------------------------------
# Host-crossing I/O: every one of these is the only place that touches a
# real file under deploy/local, wsl.exe or docker.
# ---------------------------------------------------------------------------

function Test-HostReady {
  param([string] $RepoRoot, [string] $Distro)
  $script = Join-Path $RepoRoot 'scripts/aos/preflight-host.ps1'
  $stdout = New-TemporaryFile
  $stderr = New-TemporaryFile
  try {
    $proc = Start-Process -FilePath 'powershell' `
      -ArgumentList @('-NoProfile', '-File', $script, '-DistroName', $Distro) `
      -NoNewWindow -Wait -PassThru `
      -RedirectStandardOutput $stdout.FullName -RedirectStandardError $stderr.FullName
    return $proc.ExitCode -eq 0
  } finally {
    Remove-Item -LiteralPath $stdout.FullName, $stderr.FullName -Force -ErrorAction SilentlyContinue
  }
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

  switch ($Action) {
    'Prepare' {
      Invoke-Prepare -LocalDir $LocalDir -EnvPath $EnvPath -WebPort $DefaultWebPort
      exit ($script:PrepareOk ? 0 : 1)
    }
    'Status' {
      # Read-only: does not require the start gate, reports it instead.
      $hostReady = Test-HostReady -RepoRoot $RepoRoot -Distro $Distro
      $envCheck = Test-RequiredPresentKeys -Path $EnvPath -RequiredKeys $RequiredEnvKeys -RejectedPlaceholders @('replace_me_with_a_random_hex_string', 'replace_me_with_a_random_base64_string')
      $privacyCheck = Test-RequiredExactKeys -Path $PrivacyPath -Required $RequiredPrivacyKeys
      $verdict = Get-StartGateVerdict -HostReady $hostReady -EnvCheck $envCheck -PrivacyCheck $privacyCheck -PortFree (Test-PortFree -Port $DefaultWebPort)
      Write-Output "aos-crm-local gate: $(if ($verdict.Proceed) { 'READY to start' } else { 'NOT ready' })"
      foreach ($b in $verdict.Blockers) { Write-Output "  - $b" }
      if ($hostReady) {
        Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('ps')
        exit $script:ComposeExitCode
      }
      exit ($verdict.Proceed ? 0 : 1)
    }
    'Start' {
      $hostReady = Test-HostReady -RepoRoot $RepoRoot -Distro $Distro
      $envCheck = Test-RequiredPresentKeys -Path $EnvPath -RequiredKeys $RequiredEnvKeys -RejectedPlaceholders @('replace_me_with_a_random_hex_string', 'replace_me_with_a_random_base64_string')
      $privacyCheck = Test-RequiredExactKeys -Path $PrivacyPath -Required $RequiredPrivacyKeys
      $portFree = Test-PortFree -Port $DefaultWebPort
      $verdict = Get-StartGateVerdict -HostReady $hostReady -EnvCheck $envCheck -PrivacyCheck $privacyCheck -PortFree $portFree
      if (-not $verdict.Proceed) {
        Write-Output 'aos-crm-local: BLOCKED (fail-closed), no build/up attempted:'
        foreach ($b in $verdict.Blockers) { Write-Output "  - $b" }
        exit 1
      }
      Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('up', '--build', '-d')
      exit $script:ComposeExitCode
    }
    'Stop' {
      Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('down')
      exit $script:ComposeExitCode
    }
    'Restart' {
      $hostReady = Test-HostReady -RepoRoot $RepoRoot -Distro $Distro
      $envCheck = Test-RequiredPresentKeys -Path $EnvPath -RequiredKeys $RequiredEnvKeys -RejectedPlaceholders @('replace_me_with_a_random_hex_string', 'replace_me_with_a_random_base64_string')
      $privacyCheck = Test-RequiredExactKeys -Path $PrivacyPath -Required $RequiredPrivacyKeys
      $portFree = Test-PortFree -Port $DefaultWebPort
      $verdict = Get-StartGateVerdict -HostReady $hostReady -EnvCheck $envCheck -PrivacyCheck $privacyCheck -PortFree $portFree
      if (-not $verdict.Proceed) {
        Write-Output 'aos-crm-local: BLOCKED (fail-closed), no restart attempted:'
        foreach ($b in $verdict.Blockers) { Write-Output "  - $b" }
        exit 1
      }
      Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('down')
      if ($script:ComposeExitCode -ne 0) { exit $script:ComposeExitCode }
      Invoke-ComposeOnLinux -RepoRoot $RepoRoot -Distro $Distro -ComposeArgs @('up', '--build', '-d')
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

  $tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "aos-crm-local-ps1-selftest-$([guid]::NewGuid())"
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

    Record 'Get-StartGateVerdict: every signal good means Proceed=true with no blockers' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $v = Get-StartGateVerdict -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortFree $true
      if (-not $v.Proceed -or @($v.Blockers).Count -ne 0) { throw 'expected a clean proceed verdict' }
    }

    Record 'Get-StartGateVerdict: missing privacy.env blocks even when everything else is ready' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyMissing = [ordered]@{ Exists = $false; MissingKeys = @($RequiredPrivacyKeys.Keys); WrongValueKeys = @() }
      $v = Get-StartGateVerdict -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyMissing -PortFree $true
      if ($v.Proceed) { throw 'expected Proceed=false when privacy.env is missing' }
      if (-not (@($v.Blockers) -match 'privacy:')) { throw 'expected a privacy: blocker in the list' }
    }

    Record 'Get-StartGateVerdict: a busy port blocks even when host/env/privacy are all ready' {
      $envOk = [ordered]@{ Exists = $true; MissingKeys = @(); PlaceholderKeys = @() }
      $privacyOk = [ordered]@{ Exists = $true; MissingKeys = @(); WrongValueKeys = @() }
      $v = Get-StartGateVerdict -HostReady $true -EnvCheck $envOk -PrivacyCheck $privacyOk -PortFree $false
      if ($v.Proceed) { throw 'expected Proceed=false when the port is busy' }
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
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
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
