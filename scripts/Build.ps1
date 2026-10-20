[CmdletBinding()]
param([string]$Dotnet = 'dotnet', [string]$NugetSource, [string]$Output)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (!$Output) { $Output = Join-Path $root ('artifacts/MoXi-clean-' + [Guid]::NewGuid().ToString('N')) }
$Output = [IO.Path]::GetFullPath($Output)
if ((Test-Path -LiteralPath $Output) -and (Get-ChildItem -LiteralPath $Output -Force | Select-Object -First 1)) { throw 'Build output must be a new or empty directory' }
Push-Location $root
try {
    & npm.cmd run build
    if ($LASTEXITCODE) { throw 'Editor build failed' }
    $arguments = @('publish','Moxi.App/Moxi.App.csproj','-c','Release','-r','win-x64','--self-contained','false','--disable-build-servers','-m:1','-p:UseSharedCompilation=false','-p:DebugType=none','-p:DebugSymbols=false','-o',$Output)
    if ($NugetSource) { $arguments += @('--source',$NugetSource) }
    & $Dotnet @arguments
    if ($LASTEXITCODE) { throw 'Native publish failed' }
    Copy-Item README.md,LICENSE,THIRD_PARTY_NOTICES.txt,Welcome.md -Destination $Output
    & (Join-Path $PSScriptRoot 'Check-Package.ps1') -Directory $Output
    Write-Host "Clean Windows program: $Output"
    return $Output
} finally { Pop-Location }
