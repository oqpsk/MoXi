$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    # Scan prospective source as well as tracked files, never dependencies or test output.
    $files = @(& git ls-files --cached --others --exclude-standard)
    if ($LASTEXITCODE) { throw 'Cannot enumerate repository sources' }
    $bad = @()
    foreach ($file in $files) {
        if ($file -match '(^|/)(userdata|node_modules|bin|obj|artifacts|dist|\.cache)/|\.(log|pdb|zip|nupkg)$') { $bad += $file; continue }
        if ($file -match '\.(ico|png)$') { continue }
        $content = [IO.File]::ReadAllText((Join-Path $root $file))
        # Construct patterns without embedding a real credential or a machine path in source.
        $credential = '(?:gh[pousr]_' + '[A-Za-z0-9]{30,}|sk-' + '[A-Za-z0-9]{24,}|-----BEGIN ' + '(?:RSA |EC )?PRIVATE KEY-----)'
        $localPath = '[A-Z]:[\\/]' + 'Users[\\/]'
        if ($content -match $credential -or $content -match $localPath) { $bad += $file }
    }
    if ($bad.Count) { throw ('Private or generated content detected in: ' + ($bad -join ', ')) }
    Write-Host ('Privacy/source checks passed (' + $files.Count + ' files).')
} finally { Pop-Location }
