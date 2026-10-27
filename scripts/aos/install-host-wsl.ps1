# CRM-001-HOST host-runtime installer. Idempotent, reviewable preparation for
# WSL2 + a supported Linux distribution + Docker Engine (not Docker Desktop).
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/aos/install-host-wsl.ps1 [-WhatIf]
#
# Scope discipline (do not relax without a new dispatch):
#   - Never self-elevates (no Start-Process -Verb RunAs) and never reboots.
#     If Windows feature enablement needs elevation, this prints the exact
#     command and stops; a human runs it in an elevated session.
#   - Never changes the default WSL distribution, never --unregister/--shutdown,
#     never touches a distro other than the one selected for this checkout.
#   - Phase 2 (Docker Engine) runs as the WSL root user (`wsl -u root`), which
#     needs no Linux-side password: WSL grants the controlling Windows session
#     direct root access to its own VM, independent of any interactive Linux
#     user. It does not touch any CRM dependency or image.
[CmdletBinding(SupportsShouldProcess)]
param(
  [string] $DistroName,
  [switch] $Phase1Only,
  [switch] $Phase2Only
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function ConvertTo-PlainLine($Item) {
  if ($Item -is [System.Management.Automation.ErrorRecord]) { return $Item.Exception.Message }
  return $Item.ToString()
}

function Invoke-NativeUnicode {
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

# Runs one WSL-as-root step and stops the caller's pipeline (via the returned
# object's Ok=$false) rather than silently continuing past a failure.
function Invoke-WslRootStep {
  param([Parameter(Mandatory)] [string] $Distro, [Parameter(Mandatory)] [string] $Name, [Parameter(Mandatory)] [string] $BashScript)
  if (-not $PSCmdlet.ShouldProcess("wsl:$Distro", "root# $Name")) {
    return [pscustomobject]@{ Name = $Name; Command = $BashScript; ExitCode = $null; Ok = $true; Skipped = $true; Detail = 'skipped (-WhatIf)' }
  }
  $probe = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('-d', $Distro, '-u', 'root', '--', 'bash', '-lc', $BashScript)
  [pscustomobject]@{ Name = $Name; Command = $BashScript; ExitCode = $probe.ExitCode; Ok = ($probe.ExitCode -eq 0); Skipped = $false; Detail = $probe.Text }
}

$report = [ordered]@{
  schemaVersion = 'aos.host-install.v1'
  generatedAtUtc = [DateTime]::UtcNow.ToString('o')
  phase1 = [ordered]@{ attempted = $false }
  phase2 = [ordered]@{ attempted = $false; steps = @() }
  status = 'error'
}

try {
  # ---- Phase 1: Windows WSL feature + default distro (needs elevation) ----
  if (-not $Phase2Only) {
    $report.phase1.attempted = $true
    $statusProbe = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('--status')
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
          $installProbe = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('--install')
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
    $helpProbe = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('--help')
    $looksLikeFullCli = ($helpProbe.Text -match '--list' -or $helpProbe.Text -match '--distribution' -or $helpProbe.Text -match '--set-default')
    if (-not $looksLikeFullCli) {
      $report.phase2.result = 'blocked-phase1-incomplete'
      $report.phase2.detail = 'wsl.exe is still the pre-install bootstrap stub; complete phase 1 (install + reboot) first'
    } else {
      $listProbe = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('-l', '-v')
      $distros = if ($listProbe.ExitCode -eq 0) { ConvertFrom-WslListVerbose -Text $listProbe.Text } else { @() }
      $chosen = if ($DistroName) { $distros | Where-Object { $_.Name -eq $DistroName } | Select-Object -First 1 } else { $distros | Select-Object -First 1 }

      if (-not $chosen) {
        $report.phase2.result = 'blocked-no-distribution'
        $report.phase2.detail = 'no registered Linux distribution found; complete phase 1 and its one-time interactive first launch first'
      } else {
        $distro = $chosen.Name
        $report.phase2.distro = $distro

        $present = Invoke-NativeUnicode -Exe 'wsl.exe' -NativeArgs @('-d', $distro, '-u', 'root', '--', 'bash', '-lc', 'command -v docker')
        if ($present.ExitCode -eq 0) {
          $report.phase2.result = 'already-satisfied'
          $report.phase2.detail = "docker already present in '$distro' at $($present.Text)"
        } else {
          # Mirrors docs.docker.com/engine/install/ubuntu/ (apt repository method) one step at a
          # time so each step's own exit code is recorded; stops at the first real failure.
          $steps = New-Object System.Collections.Generic.List[object]
          $ok = $true

          $removeConflicting = 'PKGS="$(dpkg --get-selections docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc 2>/dev/null | cut -f1)"; if [ -n "$PKGS" ]; then apt-get remove -y $PKGS; fi'
          $planned = @(
            @{ Name = 'remove-conflicting-packages'; Script = $removeConflicting },
            @{ Name = 'apt-update'; Script = 'apt-get update -y' },
            @{ Name = 'apt-install-prereqs'; Script = 'apt-get install -y ca-certificates curl' },
            @{ Name = 'keyring-dir'; Script = 'install -m 0755 -d /etc/apt/keyrings' },
            @{ Name = 'docker-gpg-key'; Script = 'curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc' },
            @{ Name = 'docker-gpg-key-perms'; Script = 'chmod a+r /etc/apt/keyrings/docker.asc' },
            @{ Name = 'docker-apt-source'; Script = '. /etc/os-release; printf "Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n" "${UBUNTU_CODENAME:-$VERSION_CODENAME}" "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/docker.sources' },
            @{ Name = 'apt-update-with-docker-repo'; Script = 'apt-get update -y' },
            @{ Name = 'apt-install-docker-engine'; Script = 'apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin' },
            @{ Name = 'enable-start-docker'; Script = 'systemctl enable --now docker.service containerd.service' },
            @{ Name = 'docker-group-existing-home-users'; Script = 'for u in $(ls /home 2>/dev/null); do id -u "$u" >/dev/null 2>&1 && usermod -aG docker "$u" 2>/dev/null; done; true' },
            @{ Name = 'verify-docker-version'; Script = 'docker --version' }
          )

          foreach ($step in $planned) {
            if (-not $ok) {
              $steps.Add([pscustomobject]@{ Name = $step.Name; Command = $step.Script; ExitCode = $null; Ok = $false; Skipped = $true; Detail = 'skipped: earlier step failed' }) | Out-Null
              continue
            }
            $stepResult = Invoke-WslRootStep -Distro $distro -Name $step.Name -BashScript $step.Script
            $steps.Add($stepResult) | Out-Null
            if (-not $stepResult.Skipped -and -not $stepResult.Ok) { $ok = $false }
          }

          $report.phase2.steps = @($steps)
          $report.phase2.result = if ($ok) { 'installed' } else { 'install-failed' }
          $report.phase2.detail = if ($ok) { "Docker Engine installed in '$distro'" } else { "a required step failed in '$distro'; see steps for the first failing command/exit code" }
        }
      }
    }
  }

  $phase1Blocked = $report.phase1.attempted -and $report.phase1.result -and ($report.phase1.result -like 'blocked*')
  $phase2Blocked = $report.phase2.attempted -and $report.phase2.result -and ($report.phase2.result -like 'blocked*' -or $report.phase2.result -eq 'install-failed')
  $report.status = if ($phase1Blocked -or $phase2Blocked) { 'blocked' } else { 'done' }
}
catch {
  $report.status = 'error'
  $report.error = $_.Exception.Message
}

$json = $report | ConvertTo-Json -Depth 8
Write-Output $json

switch ($report.status) {
  'done'    { exit 0 }
  'blocked' { exit 1 }
  default   { exit 2 }
}
