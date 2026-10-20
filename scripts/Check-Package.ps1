[CmdletBinding()]
param([Parameter(Mandatory)][string]$Directory)
$ErrorActionPreference = 'Stop'
$dir = [IO.Path]::GetFullPath($Directory)
foreach ($name in @('MoXi.exe','MoXi.dll','Moxi.Core.dll','MoXi.runtimeconfig.json','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.Wpf.dll','Web/index.html','Web/editor.js','Web/editor.css','Welcome.md','Welcome.png','LICENSE','THIRD_PARTY_NOTICES.txt')) {
    if (!(Test-Path -LiteralPath (Join-Path $dir $name))) { throw "Missing public package file: $name" }
}
foreach ($file in Get-ChildItem -LiteralPath $dir -Recurse -Force) {
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package contains links' }
    if ($file.Name -match '^(userdata|node_modules|\.git|recovery\.json|window\.json)$|\.(pdb|log|tmp)$') { throw 'Package contains private or intermediate files' }
}
$html = Get-Content -LiteralPath (Join-Path $dir 'Web/index.html') -Raw
if ($html -match '<script[^>]+src=["'']https?://|<link[^>]+href=["'']https?://') { throw 'Runtime CDN dependency found' }
Write-Host 'Clean package contents verified.'
