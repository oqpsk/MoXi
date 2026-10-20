[CmdletBinding()]
param([string]$Dotnet = 'dotnet', [string]$NugetSource)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root ('artifacts/package-' + [Guid]::NewGuid().ToString('N'))
$build = @{ Dotnet=$Dotnet; Output=$stage }; if($NugetSource){$build.NugetSource=$NugetSource}
& (Join-Path $PSScriptRoot 'Build.ps1') @build | Out-Host
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$version = ([xml](Get-Content -LiteralPath (Join-Path $root 'Directory.Build.props') -Raw)).Project.PropertyGroup.Version
$zip = Join-Path $dist ("MoXi-$version-win-x64.zip")
if(Test-Path -LiteralPath $zip){throw 'Version package already exists; choose a new version or move it aside.'}
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$zip)
$verify = Join-Path $root ('artifacts/verify-' + [Guid]::NewGuid().ToString('N'))
[IO.Compression.ZipFile]::ExtractToDirectory($zip,$verify)
& (Join-Path $PSScriptRoot 'Check-Package.ps1') -Directory $verify
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($zip+'.sha256',$hash+'  '+[IO.Path]::GetFileName($zip)+"`n")
Write-Host "Verified portable ZIP: $zip"
