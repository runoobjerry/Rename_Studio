#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$PythonPath,
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
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
$lockStream = $null
$serviceProcess = $null
$script:setupProcess = $null
$stopFile = $null
$launcherLog = $null
$consoleChanged = $false
$exitCode = 0

function Write-Status([string]$Message) {
    Write-Host $Message
    if ($launcherLog) {
        Add-Content -LiteralPath $launcherLog -Value ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message) -Encoding UTF8
    }
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
            catch { Write-Status '无法读取 Python launcher 列表，将检查 PATH。' }
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
    throw '未找到可用的 Python 3.12+。请自行安装 Python；也可使用 -PythonPath 指定 python.exe 的完整路径。脚本不会安装系统运行环境。'
}

function Invoke-PythonTask([string]$Executable, [string[]]$Arguments, [string]$Label) {
    $stdout = Join-Path $logRoot ($runName + '-' + $Label + '.stdout.log')
    $stderr = Join-Path $logRoot ($runName + '-' + $Label + '.stderr.log')
    # Arguments are fixed switches, paths, or code without double quotes. Quote each
    # argument because Start-Process joins ArgumentList into a Windows command line.
    $argumentLine = ($Arguments | ForEach-Object { '"{0}"' -f $_ }) -join ' '
    $script:setupProcess = Start-Process -FilePath $Executable -ArgumentList $argumentLine `
        -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    # Windows PowerShell needs a cached handle to read ExitCode after redirected
    # processes exit: https://github.com/PowerShell/PowerShell/issues/5421
    $null = $script:setupProcess.Handle
    while (-not $script:setupProcess.HasExited) {
        if (Test-StopKey) { throw [OperationCanceledException]::new('启动已取消。') }
        Start-Sleep -Milliseconds 250
    }
    $script:setupProcess.WaitForExit()
    $result = $script:setupProcess.ExitCode
    if ($null -eq $result) {
        throw ('无法读取 {0} 进程的退出码，请查看对应日志；不能据此判定任务成功或失败。' -f $Label)
    }
    Write-Status ('{0} 进程退出码：{1}' -f $Label, $result)
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
            return ($page.StatusCode -eq 200 -and $page.Headers['x-rename-studio-instance'] -eq $InstanceId)
        }
        return $true
    }
    # A readiness probe can fail while binding/starting. The caller retries within
    # 30 seconds, or reports the existing launch as not ready, without trusting it.
    catch {
        $script:lastReadinessError = '{0}：{1}' -f $probeUrl, $_.Exception.Message
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
        catch { Write-Status ('无法自动打开浏览器，请手动访问 {0}' -f $pageUrl) }
    }
}

try {
    if ($env:OS -ne 'Windows_NT' -or [Console]::IsInputRedirected) {
        throw '请在 Windows 的交互式 PowerShell 终端中运行本脚本。'
    }
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    try {
        $lockStream = [IO.File]::Open((Join-Path $runtimeRoot 'launcher.lock'),
            [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    }
    catch [IO.IOException] {
        # Only a sharing violation means another launcher owns this project.
        if (($_.Exception.HResult -band 0xffff) -notin @(32, 33)) { throw }
        Write-Host '本项目已经在启动或运行，不会重复创建进程。'
        if (Test-Path -LiteralPath $sessionFile) {
            $session = Get-Content -LiteralPath $sessionFile -Raw | ConvertFrom-Json
            if (Test-Healthy $session.instance_id) { Open-WebUI }
        }
        return
    }

    $logRoot = Join-Path $runtimeRoot 'logs'
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    # Delete only old log files in our own log directory, never user state or credentials.
    Get-ChildItem -LiteralPath $logRoot -Filter '*.log' -File |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip 40 |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName }
    $runName = (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
    $launcherLog = Join-Path $logRoot ($runName + '-launcher.log')
    Write-Status ('启动 Rename Studio；日志目录：{0}' -f $logRoot)
    $previousControlC = [Console]::TreatControlCAsInput
    [Console]::TreatControlCAsInput = $true
    $consoleChanged = $true

    foreach ($requiredFile in @($requirements, (Join-Path $backendRoot 'pyproject.toml'),
        (Join-Path $backendRoot 'app\launcher.py'), (Join-Path $backendRoot 'app\release.py'),
        (Join-Path $projectRoot 'frontend\dist\index.html'))) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw ('发布包缺少文件：{0}。请获取完整发布包；脚本不会构建前端。' -f $requiredFile)
        }
    }
    $occupied = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
    if ($occupied.Count) {
        $owners = ($occupied.OwningProcess | Select-Object -Unique) -join ', '
        throw ('端口 8000 已被占用（PID: {0}）。请自行关闭占用程序后重试；脚本不会杀死其他进程或自动换端口。' -f $owners)
    }

    $python = Find-Python
    Write-Status ('使用 Python {0}：{1}' -f $python.version, $python.executable)
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
            throw '运行环境不可用、Python 已变化或项目已移动。请关闭项目，将 .runtime\venv 移走或删除后重新启动；开发用 backend\.venv 和 settings.json 不受影响。'
        }
        $needsInstall = ($savedEnvironment.fingerprint -ne $fingerprint)
    }
    else {
        Write-Status '首次启动：创建独立 Python 虚拟环境（可按 Q 取消）……'
        if ((Invoke-PythonTask $python.executable @('-m', 'venv', $venvRoot) 'venv') -ne 0) {
            throw '虚拟环境创建失败，请查看本次 venv 日志。'
        }
        $savedEnvironment = [pscustomobject]@{
            project_root = $projectRoot; python_executable = $python.executable;
            python_version = $python.version; fingerprint = ''
        }
        Save-JsonFile $savedEnvironment $environmentFile
    }

    $checkCode = "import fastapi,httpx,pydantic_settings,sqlalchemy,uvicorn; from importlib.metadata import version; from pathlib import Path; import sys; pins=[line.split('==') for line in Path(sys.argv[1]).read_text().splitlines() if line and not line.startswith('#')]; sys.exit(0 if all(version(name)==required for name,required in pins) else 1)"
    $dependenciesHealthy = $false
    if (-not $needsInstall) {
        $dependenciesHealthy = ((Invoke-PythonTask $venvPython @('-c', $checkCode, $requirements) 'dependencies') -eq 0)
    }
    if ($needsInstall -or -not $dependenciesHealthy) {
        # Keep environment identity for retry, but invalidate installation success.
        $savedEnvironment.fingerprint = ''
        Save-JsonFile $savedEnvironment $environmentFile
        Write-Status '安装运行依赖，需要联网；详细输出写入 install 日志（可按 Q 取消）……'
        $pipArguments = @('-m', 'pip', '--disable-pip-version-check', 'install', '--force-reinstall', '-r', $requirements)
        if ((Invoke-PythonTask $venvPython $pipArguments 'install') -ne 0) {
            throw '依赖安装失败。请查看本次 install 日志，检查网络或 pip 配置后重试；未记录安装成功。'
        }
        if ((Invoke-PythonTask $venvPython @('-c', $checkCode, $requirements) 'dependencies') -ne 0 -or
            (Invoke-PythonTask $venvPython @('-m', 'pip', '--disable-pip-version-check', 'check') 'pip-check') -ne 0) {
            throw '运行依赖检查失败，请查看 dependencies / pip-check 日志。'
        }
        $savedEnvironment.fingerprint = $fingerprint
        Save-JsonFile $savedEnvironment $environmentFile
    }
    else { Write-Status '依赖未变化且检查通过，跳过 pip install（无需联网）。' }

    $instanceId = [Guid]::NewGuid().ToString('N')
    $stopFile = Join-Path $runtimeRoot ($instanceId + '.stop')
    $arguments = '-m app.launcher --stop-file "{0}" --parent-pid {1} --instance-id {2}' -f $stopFile, $PID, $instanceId
    $serviceProcess = Start-Process -FilePath $venvPython -ArgumentList $arguments `
        -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logRoot ($runName + '-service.stdout.log')) `
        -RedirectStandardError (Join-Path $logRoot ($runName + '-service.stderr.log'))
    $null = $serviceProcess.Handle
    Save-JsonFile @{ instance_id = $instanceId } $sessionFile

    Write-Status '等待页面和 API 就绪（约 30 秒超时）……'
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($serviceProcess.HasExited) { throw '服务启动失败，请查看本次 service 日志。' }
        if (Test-StopKey) { throw [OperationCanceledException]::new('启动已取消。') }
        if (Test-Healthy $instanceId -IncludePage) {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) {
        if ($script:lastReadinessError) { Write-Status ('最后一次就绪探测错误：{0}' -f $script:lastReadinessError) }
        throw '服务在 30 秒内未就绪，请查看本次 service 日志。'
    }
    Write-Status ('服务已就绪：{0}。保持此窗口打开；按 Q 或 Ctrl+C 安全退出。' -f $pageUrl)
    Open-WebUI
    while (-not $serviceProcess.HasExited) {
        if (Test-StopKey) { break }
        Start-Sleep -Milliseconds 250
    }
    if ($serviceProcess.HasExited) { throw '服务意外退出，请查看本次 service 日志。' }
}
catch [OperationCanceledException] {
    Write-Status '启动已取消。'
}
catch {
    $exitCode = 1
    Write-Status ('错误：{0}' -f $_.Exception.Message)
}
finally {
    if ($script:setupProcess) {
        if (-not $script:setupProcess.HasExited) { $script:setupProcess.Kill() }
        $script:setupProcess.Dispose()
    }
    if ($serviceProcess) {
        if (-not $serviceProcess.HasExited) {
            Write-Status '正在停止服务：等待当前请求完成，请勿强行关闭窗口……'
            [IO.File]::WriteAllText($stopFile, 'stop')
            # No timeout kill: an in-flight rename must be allowed to reconcile its result.
            while (-not $serviceProcess.HasExited) { Start-Sleep -Milliseconds 250 }
        }
        $serviceProcess.WaitForExit()
        if ($serviceProcess.ExitCode -ne 0 -and $exitCode -eq 0) {
            $exitCode = 1
            Write-Status ('服务退出时返回错误码 {0}，请查看本次 service 日志。' -f $serviceProcess.ExitCode)
        }
        elseif ($exitCode -eq 0) { Write-Status '服务已停止。' }
        $serviceProcess.Dispose()
    }
    if ($lockStream) {
        if (Test-Path -LiteralPath $sessionFile) { Remove-Item -LiteralPath $sessionFile }
        if ($stopFile -and (Test-Path -LiteralPath $stopFile)) { Remove-Item -LiteralPath $stopFile }
        $lockStream.Dispose()
    }
    if ($consoleChanged) { [Console]::TreatControlCAsInput = $previousControlC }
}

if ($exitCode -ne 0 -and -not [Console]::IsInputRedirected) {
    Read-Host '按 Enter 关闭；错误日志已保留' | Out-Null
}
exit $exitCode
