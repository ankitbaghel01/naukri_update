# Registers the three hourly automation tasks in Windows Task Scheduler.
#
#   Run it from this folder:   powershell -ExecutionPolicy Bypass -File setup-schedule.ps1
#   Remove the tasks again:    powershell -ExecutionPolicy Bypass -File setup-schedule.ps1 -Remove
#   Check what is registered:  powershell -ExecutionPolicy Bypass -File setup-schedule.ps1 -Status
#
# No admin rights needed: these run as you, in your own session.
#
# Why "at logon" rather than "at startup": Chrome cannot run headless here (Naukri's
# Akamai bot-check blocks headless browsers), so every run needs a real desktop
# session to draw into. A boot trigger would fire before one exists.
#
# Nothing appears on screen: Task Scheduler launches wscript.exe, which starts node
# with no console window, and the browser itself launches off-screen and hidden.

param([switch]$Remove, [switch]$Status)

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs  = Join-Path $repo "run-hidden.vbs"

$defs = @(
  @{ Name = "NaukriProfileRefresh"
     Args = "naukri-profile-refresh.js"
     Desc = "Hourly Naukri profile refresh (headline dot cycle + daily resume re-upload). Runs hidden." },
  @{ Name = "NaukriAutoApply"
     Args = "auto-apply-runner.js naukri --live --scheduled"
     Desc = "Hourly Naukri auto-apply. 10 per run, 20/day cap, 09:00-23:00 only. Runs hidden." },
  @{ Name = "WellfoundAutoApply"
     Args = "auto-apply-runner.js wellfound --live --scheduled"
     Desc = "Hourly Wellfound auto-apply. 10 per run, 50/day cap, 09:00-23:00 only. Runs hidden." }
)

if ($Status) {
  foreach ($d in $defs) {
    $t = Get-ScheduledTask -TaskName $d.Name -ErrorAction SilentlyContinue
    if (-not $t) { "{0,-22} NOT REGISTERED" -f $d.Name; continue }
    $i = Get-ScheduledTaskInfo -TaskName $d.Name -ErrorAction SilentlyContinue
    "{0,-22} {1,-10} last={2} next={3} lastResult={4}" -f $d.Name, $t.State, $i.LastRunTime, $i.NextRunTime, $i.LastTaskResult
  }
  return
}

if ($Remove) {
  foreach ($d in $defs) {
    try {
      Unregister-ScheduledTask -TaskName $d.Name -Confirm:$false -ErrorAction Stop
      "removed: $($d.Name)"
    } catch { "not present: $($d.Name)" }
  }
  return
}

if (-not (Test-Path $vbs)) { throw "run-hidden.vbs not found next to this script ($vbs)" }

foreach ($d in $defs) {
  try { Unregister-ScheduledTask -TaskName $d.Name -Confirm:$false -ErrorAction Stop | Out-Null } catch {}

  $action = New-ScheduledTaskAction -Execute "wscript.exe" `
              -Argument ('"{0}" "{1}"' -f $vbs, $d.Args) -WorkingDirectory $repo

  # At logon, then every hour for as long as you stay logged in.
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $rep = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
            -RepetitionInterval (New-TimeSpan -Hours 1) `
            -RepetitionDuration ([TimeSpan]::MaxValue)).Repetition
  $trigger.Repetition = $rep
  $trigger.Delay = "PT2M"   # let the desktop settle before the first run

  # IgnoreNew: if an hourly run is still going when the next hour comes round, skip the
  # new one rather than running two browsers against the same Chrome profile.
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
                -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
                -MultipleInstances IgnoreNew `
                -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)

  Register-ScheduledTask -TaskName $d.Name -Action $action -Trigger $trigger `
    -Settings $settings -Description $d.Desc -RunLevel Limited | Out-Null
  "registered: $($d.Name)"
}

""
"Done. Verify with:  powershell -ExecutionPolicy Bypass -File setup-schedule.ps1 -Status"
"Run one now:        Start-ScheduledTask NaukriProfileRefresh"
"Pause one:          Disable-ScheduledTask NaukriAutoApply"
