param(
  [Parameter(Mandatory = $true)][string]$SshTarget
)
$ErrorActionPreference = 'Stop'
if ($SshTarget -notmatch '^[a-zA-Z][a-zA-Z0-9_-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$') { throw 'Specify user@known-inventory-host.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
$jobPath = Join-Path $projectRoot 'dist\scripts\pull-backup.js'
if (-not (Test-Path -LiteralPath $jobPath)) { throw 'Build the project before registering its backup task.' }
$taskName = 'Iboltscan-Backup-Pull'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'The backup task already exists. Inspect it before changing its schedule.' }
function Quote-PsLiteral([string]$value) { return "'" + $value.Replace("'", "''") + "'" }
$jobCommand = '& ' + (Quote-PsLiteral $nodePath) + ' ' + (Quote-PsLiteral $jobPath) + ' ' + (Quote-PsLiteral $SshTarget) + '; exit $LASTEXITCODE'
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -Command "' + $jobCommand + '"') -WorkingDirectory $projectRoot
$userName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User $userName),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 1))
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew -Hidden -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $userName -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Pull verified inventory backups to this PC hourly and at sign-in. Uses existing SSH credentials and strict known-host verification.' | Select-Object TaskName, State
