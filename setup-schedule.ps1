# Registers the three hourly automation tasks in Windows Task Scheduler.
#
#   Register:  powershell -ExecutionPolicy Bypass -File setup-schedule.ps1
#   Status:    powershell -ExecutionPolicy Bypass -File setup-schedule.ps1 -Status
#   Remove:    powershell -ExecutionPolicy Bypass -File setup-schedule.ps1 -Remove
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

$ErrorActionPreference = 'Stop'
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
    $every = $t.Triggers[0].Repetition.Interval
    "{0,-22} {1,-8} every={2,-5} next={3} last={4} result={5}" -f `
      $d.Name, $t.State, $every, $i.NextRunTime, $i.LastRunTime, $i.LastTaskResult
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

$ok = 0; $bad = 0
foreach ($d in $defs) {
  try { Unregister-ScheduledTask -TaskName $d.Name -Confirm:$false -ErrorAction SilentlyContinue | Out-Null } catch {}

  try {
    $action = New-ScheduledTaskAction -Execute "wscript.exe" `
                -Argument ('"{0}" "{1}"' -f $vbs, $d.Args) -WorkingDirectory $repo

    # At logon, then every hour for as long as you stay logged in.
    #
    # The repetition pattern is built directly rather than with
    #   -RepetitionDuration ([TimeSpan]::MaxValue)
    # which serialises to P99999999DT23H59M59S and is rejected outright:
    #   "The task XML contains a value which is incorrectly formatted or out of range."
    # Leaving Duration empty with StopAtDurationEnd false is what "repeat indefinitely"
    # actually looks like in the task XML.
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $trigger.Repetition = New-CimInstance -ClassName MSFT_TaskRepetitionPattern `
                            -Namespace Root/Microsoft/Windows/TaskScheduler -ClientOnly `
                            -Property @{ Interval = 'PT1H'; StopAtDurationEnd = $false }
    $trigger.Delay = 'PT2M'   # let the desktop settle before the first run

    # IgnoreNew: if an hourly run is still going when the next hour comes round, skip
    # the new one rather than running two browsers against the same Chrome profile.
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
                  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
                  -MultipleInstances IgnoreNew `
                  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)

    Register-ScheduledTask -TaskName $d.Name -Action $action -Trigger $trigger `
      -Settings $settings -Description $d.Desc -RunLevel Limited -ErrorAction Stop | Out-Null

    # Verify rather than assume. The previous version of this script printed
    # "registered" from a loop that never checked, and reported success for three
    # tasks that had all failed to register.
    $check = Get-ScheduledTask -TaskName $d.Name -ErrorAction SilentlyContinue
    if ($check) { "  OK   $($d.Name)  (every $($check.Triggers[0].Repetition.Interval), at logon)"; $ok++ }
    else        { "  FAIL $($d.Name)  (Register reported no error but the task is not there)"; $bad++ }
  }
  catch {
    "  FAIL $($d.Name)  $($_.Exception.Message)"
    $bad++
  }
}

""
"$ok registered, $bad failed."
if ($bad -eq 0) {
  "Verify:      powershell -ExecutionPolicy Bypass -File setup-schedule.ps1 -Status"
  "Run one now: Start-ScheduledTask NaukriProfileRefresh"
  "Pause one:   Disable-ScheduledTask NaukriAutoApply"
  "Remove all:  powershell -ExecutionPolicy Bypass -File setup-schedule.ps1 -Remove"
} else {
  "Some tasks did not register - nothing will run on a schedule until that is fixed."
  exit 1
}
