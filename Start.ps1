#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$PythonPath,
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# CmdletBinding already exposes -Debug as a common parameter.
$debugMode = $PSBoundParameters.ContainsKey('Debug') -and $PSBoundParameters['Debug']
$DebugPreference = 'SilentlyContinue'
$projectRoot = $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'backend'
$runtimeRoot = Join-Path $projectRoot '.runtime'
$venvRoot = Join-Path $runtimeRoot 'venv'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'
$requirements = Join-Path $backendRoot 'requirements-runtime.txt'
$environmentFile = Join-Path $runtimeRoot 'environment.json'
$sessionFile = Join-Path $runtimeRoot 'session.json'
$pageUrl = 'http://localhost:8000'
$healthUrl = 'http://127.0.0.1:8000/api/health'
$script:lastReadinessError = ''
$script:serviceVersion = ''
$script:startupStep = $null
$script:spinnerFrame = 0
$script:transientLineVisible = $false
$spinnerFrames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
$lockStream = $null
$serviceProcess = $null
$script:serviceOutput = $null
$script:setupProcess = $null
$stopFile = $null
$logSession = $null
$consoleChanged = $false
$exitCode = 0

function Clear-TransientLine {
    if ($script:transientLineVisible) {
        $width = [Console]::CursorLeft
        [Console]::CursorLeft = 0
        [Console]::Write(' ' * $width)
        [Console]::CursorLeft = 0
        $script:transientLineVisible = $false
    }
}

function Write-Status([string]$Message) {
    Clear-TransientLine
    Write-Host $Message
}

function Write-Step([string]$Symbol, [string]$Name, [string]$Result) {
    Clear-TransientLine
    if ($Symbol -eq '✗') {
        Write-Host "$Symbol $Name  $Result" -ForegroundColor Red
        return
    }
    if ($Symbol -eq '!') {
        Write-Host "$Symbol $Name  $Result" -ForegroundColor Yellow
        return
    }
    if ($Symbol -eq '✓') { Write-Host $Symbol -ForegroundColor Green -NoNewline }
    else { Write-Host $Symbol -NoNewline }
    Write-Host " $Name" -ForegroundColor DarkGray -NoNewline
    Write-Host "  $Result"
}

function Update-Step {
    if ([Console]::IsOutputRedirected) { return }
    [Console]::CursorLeft = 0
    Write-Host $spinnerFrames[$script:spinnerFrame] -NoNewline
    Write-Host " $script:startupStep" -ForegroundColor DarkGray -NoNewline
    $script:spinnerFrame = ($script:spinnerFrame + 1) % $spinnerFrames.Length
    $script:transientLineVisible = $true
}

function Start-Step([string]$Name) {
    $script:startupStep = $Name
    $script:spinnerFrame = 0
    Update-Step
}

function Finish-Step([string]$Symbol, [string]$Result) {
    $name = $script:startupStep
    if (-not $name) { $name = 'Rename Studio' }
    Write-Step $Symbol $name $Result
    $script:startupStep = $null
}

function Write-TaskOutput([string]$Line) {
    $eventMatch = [regex]::Match($Line, '^\[(INFO|ERROR|PROGRESS)\] (.*)$')
    if (-not $eventMatch.Success) {
        Write-Status $Line
        return
    }
    Clear-TransientLine
    $kind = $eventMatch.Groups[1].Value
    $body = $eventMatch.Groups[2].Value
    $isProgress = $kind -eq 'PROGRESS'
    $prefix = '[INFO]'
    $color = 'Green'
    if ($kind -eq 'ERROR') {
        $prefix = '[ERROR]'
        $color = 'Red'
    }
    if ($isProgress -and ([Console]::IsOutputRedirected -or
        $Host.UI.RawUI.LengthInBufferCells("$prefix $body") -ge [Console]::BufferWidth)) { return }

    Write-Host $prefix -ForegroundColor $color -NoNewline
    Write-Host " $body" -NoNewline:$isProgress
    $script:transientLineVisible = $isProgress
}

function Read-ServiceOutput([switch]$Wait) {
    while ($script:serviceOutput -and ($Wait -or $script:serviceOutput.IsCompleted)) {
        $line = $script:serviceOutput.GetAwaiter().GetResult()
        if ($null -eq $line) {
            $script:serviceOutput = $null
            break
        }
        Write-TaskOutput $line
        $script:serviceOutput = $serviceProcess.StandardOutput.ReadLineAsync()
    }
}

function New-AppLogSession([string]$Executable) {
    $logArguments = @('-B', '-E', '-S', '-m', 'app.core.log_sessions', '--runtime', $runtimeRoot)
    Push-Location -LiteralPath $backendRoot
    try {
        $name = & $Executable @logArguments 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'Could not create a log session.' }
    }
    finally { Pop-Location }
    return (Join-Path (Join-Path $runtimeRoot 'logs') $name)
}

function Test-StopKey {
    if ([Console]::KeyAvailable) {
        $key = [Console]::ReadKey($true)
        return ($key.Key -eq [ConsoleKey]::Q -or
            ($key.Key -eq [ConsoleKey]::C -and ($key.Modifiers -band [ConsoleModifiers]::Control)))
    }
    return $false
}

function Get-PythonInfo([string]$Executable) {
    try {
        $raw = & $Executable -c 'import json,sys; print(json.dumps(dict(executable=sys.executable,version=sys.version.split()[0],major=sys.version_info.major,minor=sys.version_info.minor)))' 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return ($raw | ConvertFrom-Json)
    }
    catch {
        # A candidate can be an unavailable launcher alias or a broken interpreter.
        return $null
    }
}

function Find-Python {
    $candidates = @()
    if ($PythonPath) {
        $candidates = @((Resolve-Path -LiteralPath $PythonPath).Path)
    }
    else {
        $pyCommand = Get-Command py.exe -ErrorAction SilentlyContinue
        if ($pyCommand) {
            # List installed runtimes rather than asking a Python manager to install one.
            try {
                $installed = & $pyCommand.Source -0p 2>$null
                foreach ($line in $installed) {
                    if ($line -match '(?i)([a-z]:\\.*\\python\.exe)\s*$') {
                        $candidates += $Matches[1]
                    }
                }
            }
            catch { Write-Step '!' 'Check Python' 'Could not list Python installations. Checking PATH.' }
        }
        $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
        if ($pythonCommand -and $pythonCommand.Source -notlike '*\Microsoft\WindowsApps\*') {
            $candidates += $pythonCommand.Source
        }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        $info = Get-PythonInfo $candidate
        if ($info -and $info.major -eq 3 -and $info.minor -ge 12) { return $info }
    }
    throw 'No supported Python installation found. Install Python 3.12 or later, or use -PythonPath with the full path to python.exe.'
}

function Invoke-PythonTask([string]$Executable, [string[]]$Arguments) {
    # Arguments are fixed switches, paths, or code without double quotes. Quote each
    # argument because Start-Process joins ArgumentList into a Windows command line.
    $argumentLine = ($Arguments | ForEach-Object { '"{0}"' -f $_ }) -join ' '
    $script:setupProcess = Start-Process -FilePath $Executable -ArgumentList $argumentLine `
        -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru
    # Cache the handle to read ExitCode even after the process exits.
    $null = $script:setupProcess.Handle
    while (-not $script:setupProcess.WaitForExit(100)) {
        if (Test-StopKey) { throw [OperationCanceledException]::new('Startup canceled.') }
        Update-Step
    }
    $result = $script:setupProcess.ExitCode
    if ($null -eq $result) {
        throw 'Could not read the process exit code.'
    }
    $script:setupProcess.Dispose()
    $script:setupProcess = $null
    return $result
}

function Test-Healthy([string]$InstanceId, [switch]$IncludePage) {
    $probeUrl = $healthUrl
    try {
        $response = Invoke-WebRequest -Uri $probeUrl -UseBasicParsing -TimeoutSec 2
        if ($response.Headers['x-rename-studio-instance'] -ne $InstanceId) { return $false }
        $body = $response.Content | ConvertFrom-Json
        if ($response.StatusCode -ne 200 -or $body.status -ne 'ok') { return $false }
        if ($IncludePage) {
            # Probe the address Uvicorn binds; localhost can try IPv6 first.
            $probeUrl = 'http://127.0.0.1:8000/'
            $page = Invoke-WebRequest -Uri $probeUrl -UseBasicParsing -TimeoutSec 2
            if ($page.StatusCode -ne 200 -or $page.Headers['x-rename-studio-instance'] -ne $InstanceId) { return $false }
            $script:serviceVersion = [string]$response.Headers['x-rename-studio-version']
        }
        return $true
    }
    # A readiness probe can fail while binding/starting. The caller retries within
    # 30 seconds, or reports the existing launch as not ready, without trusting it.
    catch {
        $script:lastReadinessError = '{0}: {1}' -f $probeUrl, $_.Exception.Message
        return $false
    }
}

function Save-JsonFile([object]$Value, [string]$Path) {
    $temporary = $Path + '.tmp'
    $Value | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
    # A .NET string argument needs NullString: PowerShell converts $null to "".
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $Path) }
}

function Open-WebUI {
    if (-not $NoBrowser) {
        try { Start-Process -FilePath $pageUrl | Out-Null }
        catch { Write-Step '!' 'Open browser' ('Could not open the browser. Open {0} manually.' -f $pageUrl) }
    }
}

try {
    if ($env:OS -ne 'Windows_NT' -or [Console]::IsInputRedirected) {
        throw 'Run this script in an interactive PowerShell terminal on Windows.'
    }
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    try {
        $lockStream = [IO.File]::Open((Join-Path $runtimeRoot 'launcher.lock'),
            [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    }
    catch [IO.IOException] {
        # Only a sharing violation means another launcher owns this project.
        if (($_.Exception.HResult -band 0xffff) -notin @(32, 33)) { throw }
        Write-Step '−' 'Start service' 'Already starting or running'
        if (Test-Path -LiteralPath $sessionFile) {
            $session = Get-Content -LiteralPath $sessionFile -Raw | ConvertFrom-Json
            if (Test-Healthy $session.instance_id) { Open-WebUI }
        }
        return
    }

    Start-Step 'Check Python'
    $python = Find-Python
    Finish-Step '✓' ('Python {0}' -f $python.version)
    $previousControlC = [Console]::TreatControlCAsInput
    [Console]::TreatControlCAsInput = $true
    $consoleChanged = $true

    Start-Step 'Check release package'
    foreach ($requiredFile in @($requirements, (Join-Path $backendRoot 'app\launcher.py'),
        (Join-Path $backendRoot 'app\release.py'),
        (Join-Path $projectRoot 'frontend\dist\index.html'))) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw ('Missing file: {0}. Download and extract the complete release package.' -f $requiredFile)
        }
    }
    Finish-Step '✓' 'All required files present'
    Start-Step 'Check port'
    $occupied = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
    if ($occupied.Count) {
        $owners = ($occupied.OwningProcess | Select-Object -Unique) -join ', '
        throw ('Port 8000 is in use (PID: {0}). Close the program using it and try again.' -f $owners)
    }
    Finish-Step '✓' 'Port 8000 available'

    Start-Step 'Prepare virtual environment'
    $fingerprint = (Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash
    $savedEnvironment = $null
    if (Test-Path -LiteralPath $environmentFile) {
        $savedEnvironment = Get-Content -LiteralPath $environmentFile -Raw | ConvertFrom-Json
    }
    $needsInstall = $true
    if (Test-Path -LiteralPath $venvRoot) {
        $venvInfo = Get-PythonInfo $venvPython
        if (-not $savedEnvironment -or -not $venvInfo -or
            $savedEnvironment.project_root -ne $projectRoot -or
            $savedEnvironment.python_executable -ne $python.executable -or
            $savedEnvironment.python_version -ne $python.version -or
            $venvInfo.version -ne $python.version) {
            throw 'The virtual environment is unavailable, Python has changed, or the project has moved. Exit, move or delete .runtime\venv, then restart.'
        }
        $needsInstall = ($savedEnvironment.fingerprint -ne $fingerprint)
        Finish-Step '−' 'Reusing existing environment'
    }
    else {
        $taskExit = Invoke-PythonTask $python.executable @('-m', 'venv', $venvRoot)
        if ($taskExit -ne 0) {
            throw ('Could not create the environment (exit_code={0}).' -f $taskExit)
        }
        $savedEnvironment = [pscustomobject]@{
            project_root = $projectRoot; python_executable = $python.executable;
            python_version = $python.version; fingerprint = ''
        }
        Save-JsonFile $savedEnvironment $environmentFile
        Finish-Step '✓' 'Created'
    }

    $checkCode = "import fastapi,httpx,pydantic_settings,uvicorn; from importlib.metadata import version; from pathlib import Path; import sys; pins=[line.split('==') for line in Path(sys.argv[1]).read_text().splitlines() if line and not line.startswith('#')]; sys.exit(0 if all(version(name)==required for name,required in pins) else 1)"
    $dependenciesHealthy = $false
    if (-not $needsInstall) {
        Start-Step 'Check runtime dependencies'
        $taskExit = Invoke-PythonTask $venvPython @('-c', $checkCode, $requirements)
        $dependenciesHealthy = ($taskExit -eq 0)
        if ($dependenciesHealthy) { Finish-Step '✓' 'Passed' }
        else { Finish-Step '!' ('Check failed (exit_code={0}). Reinstalling dependencies.' -f $taskExit) }
    }
    if ($needsInstall -or -not $dependenciesHealthy) {
        Start-Step 'Install runtime dependencies'
        if ($savedEnvironment.fingerprint -ne '') {
            $savedEnvironment.fingerprint = ''
            Save-JsonFile $savedEnvironment $environmentFile
        }
        $pipArguments = @('-m', 'pip', '--disable-pip-version-check', 'install', '--force-reinstall', '-r', $requirements)
        $taskExit = Invoke-PythonTask $venvPython $pipArguments
        if ($taskExit -ne 0) {
            throw ('Installation failed (exit_code={0}). Check your network or pip settings and try again.' -f $taskExit)
        }
        Finish-Step '✓' 'Installed'
        Start-Step 'Check runtime dependencies'
        $taskExit = Invoke-PythonTask $venvPython @('-c', $checkCode, $requirements)
        if ($taskExit -eq 0) {
            $taskExit = Invoke-PythonTask $venvPython @('-m', 'pip', '--disable-pip-version-check', 'check')
        }
        if ($taskExit -ne 0) {
            throw ('Check failed (exit_code={0}).' -f $taskExit)
        }
        $savedEnvironment.fingerprint = $fingerprint
        Save-JsonFile $savedEnvironment $environmentFile
        Finish-Step '✓' 'Passed'
    }
    else { Write-Step '−' 'Install runtime dependencies' 'Already installed' }

    $logPath = 'Unavailable'
    try {
        $logSession = New-AppLogSession $python.executable
        $logPath = '.runtime\logs\{0}\app.log' -f (Split-Path -Leaf $logSession)
    }
    catch { Write-Step '!' 'Prepare log' ('Could not create the log directory ({0}). Continuing startup.' -f $_.Exception.Message) }
    Start-Step 'Start service'
    $instanceId = [Guid]::NewGuid().ToString('N')
    $stopFile = Join-Path $runtimeRoot ($instanceId + '.stop')
    $arguments = '-m app.launcher --terminal-relay --stop-file "{0}" --parent-pid {1} --instance-id {2}' -f $stopFile, $PID, $instanceId
    if ($logSession) { $arguments += (' --log-dir "{0}"' -f $logSession) }
    if ($debugMode) { $arguments += ' --debug' }
    # Keep the backend off the launcher's console so Ctrl+C is handled by the launcher.
    $serviceStart = [Diagnostics.ProcessStartInfo]::new($venvPython, $arguments)
    $serviceStart.WorkingDirectory = $backendRoot
    $serviceStart.UseShellExecute = $false
    $serviceStart.CreateNoWindow = $true
    $serviceStart.RedirectStandardOutput = $true
    $serviceStart.StandardOutputEncoding = [Text.Encoding]::UTF8
    $serviceStart.EnvironmentVariables['PYTHONIOENCODING'] = 'utf-8'
    $serviceProcess = [Diagnostics.Process]::Start($serviceStart)
    $null = $serviceProcess.Handle
    $script:serviceOutput = $serviceProcess.StandardOutput.ReadLineAsync()
    Save-JsonFile @{ instance_id = $instanceId } $sessionFile

    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        Read-ServiceOutput
        if ($serviceProcess.HasExited) { throw ('Process exited (exit_code={0}). Log file: {1}' -f $serviceProcess.ExitCode, $logPath) }
        if (Test-StopKey) { throw [OperationCanceledException]::new('Startup canceled.') }
        if (Test-Healthy $instanceId -IncludePage) {
            $ready = $true
            break
        }
        Update-Step
        Start-Sleep -Milliseconds 100
    }
    if (-not $ready) {
        throw ('Service was not ready within 30 seconds. {0} Log file: {1}' -f $script:lastReadinessError, $logPath)
    }
    Finish-Step '✓' 'Ready'
    Open-WebUI
    $separator = '-' * 40
    Write-Host "`n$separator"
    Write-Host "Rename Studio $script:serviceVersion" -ForegroundColor Green -NoNewline
    Write-Host " is running`n"
    Write-Host 'Open in browser:' -ForegroundColor DarkGray -NoNewline
    Write-Host " $pageUrl`n"
    Write-Host 'Log file:' -ForegroundColor DarkGray -NoNewline
    Write-Host " $logPath`n"
    Write-Host "Press Q or Ctrl+C to exit safely.`n$separator`n"
    while (-not $serviceProcess.HasExited) {
        Read-ServiceOutput
        if (Test-StopKey) { break }
        Start-Sleep -Milliseconds 250
    }
    if ($serviceProcess.HasExited) { throw ('Service exited unexpectedly (exit_code={0}). Log file: {1}' -f $serviceProcess.ExitCode, $logPath) }
}
catch [OperationCanceledException] {
    Finish-Step '−' 'Canceled'
}
catch {
    $exitCode = 1
    Finish-Step '✗' $_.Exception.Message
}
finally {
    if ($script:setupProcess) {
        if (-not $script:setupProcess.HasExited) { $script:setupProcess.Kill() }
        $script:setupProcess.Dispose()
    }
    if ($serviceProcess) {
        if (-not $serviceProcess.HasExited) {
            Write-Status 'Waiting for active requests to finish. Close the window after the service stops.'
            [IO.File]::WriteAllText($stopFile, 'stop')
            # No timeout kill: an in-flight rename must be allowed to reconcile its result.
            while (-not $serviceProcess.HasExited) {
                Read-ServiceOutput
                Start-Sleep -Milliseconds 250
            }
        }
        $serviceProcess.WaitForExit()
        Read-ServiceOutput -Wait
        if ($serviceProcess.ExitCode -ne 0 -and $exitCode -eq 0) {
            $exitCode = 1
            Write-Step '✗' 'Stop service' ('exit_code={0}. Log file: {1}' -f $serviceProcess.ExitCode, $logPath)
        }
        elseif ($exitCode -eq 0) { Write-Status 'Service stopped.' }
        $serviceProcess.Dispose()
    }
    if ($lockStream) {
        if ($logSession) {
            try { [IO.File]::WriteAllText((Join-Path $logSession '.closed'), '') }
            catch { }
        }
        if (Test-Path -LiteralPath $sessionFile) { Remove-Item -LiteralPath $sessionFile }
        if ($stopFile -and (Test-Path -LiteralPath $stopFile)) { Remove-Item -LiteralPath $stopFile }
        $lockStream.Dispose()
    }
    if ($consoleChanged) { [Console]::TreatControlCAsInput = $previousControlC }
}

if ($exitCode -ne 0 -and -not [Console]::IsInputRedirected) {
    Read-Host 'Press Enter to close' | Out-Null
}
exit $exitCode
