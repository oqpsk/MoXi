[CmdletBinding()]
param([string]$Dotnet = 'dotnet', [string]$NugetSource)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outputRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $root) 'outputs'))
$destination = [IO.Path]::GetFullPath((Join-Path $outputRoot 'MoXi'))
if (!$destination.StartsWith($outputRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid local install path' }
foreach ($folder in @($outputRoot,$destination)) {
    if ((Test-Path -LiteralPath $folder) -and ((Get-Item -LiteralPath $folder -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Local install path must not be a link' }
}
$exe = Join-Path $destination 'MoXi.exe'
if (Get-Process MoXi -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) { throw 'MoXi is running from the local install. Close it before updating; unsaved work must be preserved.' }
$stage = Join-Path $root ('artifacts/local-' + [Guid]::NewGuid().ToString('N'))
$arguments = @{ Dotnet=$Dotnet; Output=$stage }
if ($NugetSource) { $arguments.NugetSource=$NugetSource }
& (Join-Path $PSScriptRoot 'Build.ps1') @arguments | Out-Host
if (Get-Process MoXi -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) { throw 'MoXi was opened during the build. Close it before updating; unsaved work must be preserved.' }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
# Only clean public build files are copied. Existing userdata is never deleted or replaced.
foreach ($entry in Get-ChildItem -LiteralPath $stage -Recurse -File) {
    $relative = [IO.Path]::GetRelativePath($stage, $entry.FullName)
    $target = Join-Path $destination $relative
    if (Test-Path -LiteralPath $target) {
        if ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Local install contains a linked program path' }
        # Unchanged runtime DLLs may still be mapped by Windows. Leave identical files in place.
        if ((Get-FileHash -LiteralPath $entry.FullName).Hash -eq (Get-FileHash -LiteralPath $target).Hash) { continue }
    }
    $parent = Split-Path -Parent $target
    $ancestor = $parent
    while ($ancestor -ne $destination) {
        if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Local install contains a linked program directory' }
        $ancestor = Split-Path -Parent $ancestor
    }
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    # Windows permits renaming mapped DLLs, even when overwriting them is blocked.
    # Stage the replacement first and keep any still-mapped old file for later cleanup.
    $pending = $target + '.update-' + [Guid]::NewGuid().ToString('N')
    $previous = $target + '.previous-' + [Guid]::NewGuid().ToString('N')
    Copy-Item -LiteralPath $entry.FullName -Destination $pending
    try {
        if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $previous }
        try { Move-Item -LiteralPath $pending -Destination $target }
        catch { if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $target }; throw }
        if (Test-Path -LiteralPath $previous) {
            try { Remove-Item -LiteralPath $previous -ErrorAction Stop }
            catch [IO.IOException] { }
            catch [UnauthorizedAccessException] { }
        }
    } finally { if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending } }
}
Write-Host "Runnable local application: $exe"
