[CmdletBinding()]
param([string]$Dotnet = 'dotnet', [string]$NugetSource)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    & npm.cmd run build
    if ($LASTEXITCODE) { throw 'Editor bundle failed' }
    & npm.cmd test
    if ($LASTEXITCODE) { throw 'Editor program checks failed' }
    $arguments = @('build','MoXi.slnx','-c','Release','--disable-build-servers','-m:1','-p:UseSharedCompilation=false')
    if ($NugetSource) { $arguments += @('--source',$NugetSource) }
    & $Dotnet @arguments
    if ($LASTEXITCODE) { throw 'Native build failed' }
    $checks = Join-Path $root ('artifacts/check-' + [Guid]::NewGuid().ToString('N'))
    & $Dotnet Moxi.Checks/bin/Release/net10.0/Moxi.Checks.dll $checks
    if ($LASTEXITCODE) { throw 'Native file checks failed' }
} finally { Pop-Location }
