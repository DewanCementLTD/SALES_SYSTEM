<#
  Weighbridge agent: start with Windows and restart when it stops (TASKS P3-02).
  Registers a scheduled task that runs at boot as SYSTEM, restarts every minute on failure, and
  never stops on its own. No extra software needed (no NSSM / WinSW).

  Run in an elevated PowerShell on the weighbridge PC:
    .\install-task.ps1 -AgentDir 'C:\dcl\weighbridge-agent' [-NodeExe 'C:\Program Files\nodejs\node.exe']
  Remove:
    .\install-task.ps1 -AgentDir 'C:\dcl\weighbridge-agent' -Uninstall

  AgentDir must hold agent.config.json and device.secret (readable by SYSTEM and administrators
  only: the script restricts the secret file).
#>
param(
  [Parameter(Mandatory = $true)][string]$AgentDir,
  [string]$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source,
  [string]$TaskName = 'DCL Weighbridge Agent',
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed task '$TaskName'."
  exit 0
}
if (-not $NodeExe -or -not (Test-Path $NodeExe)) { throw 'node.exe not found: pass -NodeExe' }
$config = Join-Path $AgentDir 'agent.config.json'
if (-not (Test-Path $config)) { throw "Missing $config (copy agent.config.example.json)" }
$entry = Join-Path $AgentDir 'src\index.js'
if (-not (Test-Path $entry)) { throw "Missing $entry" }

$secret = Join-Path $AgentDir 'device.secret'
if (Test-Path $secret) {
  # only SYSTEM and Administrators may read the device secret
  icacls $secret /inheritance:r /grant:r 'SYSTEM:R' 'Administrators:R' | Out-Null
}

$action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$entry`"" -WorkingDirectory $AgentDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 9999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
$note = "config $config"

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
  -Settings $settings -Description "DCL Sales weighbridge agent ($note)" -Force | Out-Null
# AGENT_CONFIG defaults to agent.config.json in the working directory (AgentDir)
Start-ScheduledTask -TaskName $TaskName
Write-Host "Task '$TaskName' registered and started. Logs: see logFile in agent.config.json."
