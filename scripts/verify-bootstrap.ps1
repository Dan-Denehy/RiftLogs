$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\bootstrap.ps1"

function Assert-True($Value, [string]$Message) { if (!$Value) { throw $Message } }
Assert-True ((Select-Node24Version @('26.0.0', '24.9.0', '24.19.0', '22.1.0')) -eq '24.19.0') 'Must choose newest listed Node 24, not latest LTS.'
$rejected = $false
try { Select-Node24Version @('26.0.0') } catch { $rejected = $true }
Assert-True $rejected 'Must reject a list without Node 24.'

# Mock all installer interactions: this verification never installs software.
function Read-Host { return '' }
$rejected = $false
try { Install-Prerequisite 'Test dependency' 'Test.Package' } catch { $rejected = $_.Exception.Message -like '*declined*' }
Assert-True $rejected 'Default response must decline installation.'

function Read-Host { return 'y' }
function Get-Command { return $null }
$rejected = $false
try { Install-Prerequisite 'Test dependency' 'Test.Package' } catch { $rejected = $_.Exception.Message -like '*Windows Package Manager is unavailable*' }
Assert-True $rejected 'Missing winget must explain manual fallback.'

function Get-Command { return @{ Source = 'Invoke-FakeWinget' } }
$script:installerCalls = @()
function Invoke-FakeWinget {
    $script:installerCalls += ,@($args)
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'show') { return @('26.0.0', '24.19.0') }
}
Install-Prerequisite 'Node.js 24' 'OpenJS.NodeJS.LTS' -Node24
Assert-True (($script:installerCalls[1] -join ' ') -eq 'install --id OpenJS.NodeJS.LTS --exact --source winget --version 24.19.0') 'Install must pin the queried 24.x version.'
function Invoke-FakeWinget { $global:LASTEXITCODE = 1 }
$rejected = $false
try { Install-Prerequisite 'Chrome' 'Google.Chrome' } catch { $rejected = $_.Exception.Message -like '*did not finish*' }
Assert-True $rejected 'Installer errors must stop startup.'

$script:CheckOnly = $true
function Get-Node24 { return 'node.exe' }
function Get-ChromePath { return 'chrome.exe' }
Start-RiftLogs
function Get-Node24 { return $null }
$rejected = $false
try { Start-RiftLogs } catch { $rejected = $_.Exception.Message -like '*missing*' }
Assert-True $rejected 'Check-only mode must report missing prerequisites without installing.'
Write-Host 'Bootstrap checks passed (version selection, consent, missing winget, exact install command, installer failure, check-only mode).'
