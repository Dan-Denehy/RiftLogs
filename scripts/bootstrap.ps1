param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'

function Get-Node24 {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    $candidates = @()
    if ($command) { $candidates += $command.Source }
    $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe')
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $candidate) {
            $version = & $candidate --version
            if ($LASTEXITCODE -eq 0 -and $version -match '^v24\.\d+\.\d+$') { return $candidate }
        }
    }
    return $null
}

function Get-ChromePath {
    foreach ($directory in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (!$directory) { continue }
        $candidate = Join-Path $directory 'Google\Chrome\Application\chrome.exe'
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

function Select-Node24Version([string[]]$Lines) {
    # Do not blindly install "latest LTS": that will eventually be Node 26.
    $versions = @($Lines | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^24\.\d+\.\d+$' })
    if (!$versions.Count) { throw 'WinGet did not list Node.js 24. Install version 24 manually from https://nodejs.org/ then retry.' }
    return ($versions | Sort-Object { [version]$_ } -Descending | Select-Object -First 1)
}

function Install-Prerequisite([string]$Name, [string]$Id, [switch]$Node24) {
    Write-Host "$Name is required. Installation changes software on this computer and may request Windows administrator approval."
    if ($Node24) { Write-Host 'Installing Node.js 24 may replace another system-wide Node version used by other projects.' }
    $answer = Read-Host "Install $Name using Windows Package Manager? [y/N]"
    if ($answer -notmatch '^(?i:y|yes)$') { throw "$Name installation declined. No installation was started." }
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (!$winget) {
        throw 'Windows Package Manager is unavailable. Install/update App Installer from Microsoft Store, or install Node.js 24 from https://nodejs.org/ and Chrome from https://www.google.com/chrome/, then rerun start.cmd.'
    }
    $arguments = @('install', '--id', $Id, '--exact', '--source', 'winget')
    if ($Node24) {
        # Leave WinGet agreement prompts interactive; do not accept them on the user's behalf.
        $lines = & $winget.Source show --id $Id --exact --source winget --versions
        if ($LASTEXITCODE -ne 0) { throw 'Could not query Node versions. Check internet access and WinGet source agreements, then retry.' }
        $arguments += @('--version', (Select-Node24Version $lines))
    }
    & $winget.Source @arguments
    if ($LASTEXITCODE -ne 0) { throw "$Name installation did not finish successfully. Retry after resolving the installer error; do not disable security checks." }
}

function Start-RiftLogs {
    $node = Get-Node24
    $chrome = Get-ChromePath
    if ($CheckOnly) {
        if (!$node -or !$chrome) { throw 'Node.js 24 or Chrome is missing. No changes made in check-only mode.' }
        Write-Host 'Node.js 24 and Chrome detected. No installation or app launch performed.'
        return
    }
    if (!$node) {
        Install-Prerequisite 'Node.js 24' 'OpenJS.NodeJS.LTS' -Node24
        $node = Get-Node24
        if (!$node) { throw 'Node.js 24 is still unavailable. Reopen your terminal and retry start.cmd. If you use a Node version manager, select version 24 there.' }
    }
    if (!$chrome) {
        Install-Prerequisite 'Google Chrome' 'Google.Chrome'
        $chrome = Get-ChromePath
        if (!$chrome) { throw 'Chrome is still unavailable. Finish installation, then rerun start.cmd.' }
    }
    # The parent terminal has an old PATH after installation. Use the verified Node
    # directory for this process and its children without editing the user's PATH.
    $env:PATH = (Split-Path -Parent $node) + ';' + $env:PATH
    Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
    & $node scripts/setup.ts
    if ($LASTEXITCODE -ne 0) { throw 'Dependency setup failed. See the message above.' }
    $npm = Join-Path (Split-Path -Parent $node) 'npm.cmd'
    if (!(Test-Path -LiteralPath $npm)) { throw 'npm.cmd is missing beside Node. Repair your Node.js 24 installation.' }
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Interface build failed. See the message above.' }
    & $node scripts/start.ts
    if ($LASTEXITCODE -ne 0) { throw 'RiftLogs stopped with an error. See the message above.' }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Start-RiftLogs }
    catch { Write-Host "RiftLogs startup stopped: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
}
