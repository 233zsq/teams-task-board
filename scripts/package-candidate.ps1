param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $root
$stage = $null
try {
    $status = & git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $status) { throw 'Commit the candidate source before packaging; the worktree must be clean.' }
    $revision = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot identify the source commit.' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
    $version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
    $name = "team-task-board-$version-rc-$($revision.Substring(0,7))"
    $artifactRoot = Join-Path $root '.artifacts'
    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
    $stage = Join-Path $artifactRoot ("package-stage-" + [guid]::NewGuid().ToString('N'))
    $packageRoot = Join-Path $stage $name
    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
    if (-not $OutputDirectory) { $OutputDirectory = Join-Path $artifactRoot 'releases' }
    $OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $files = @(& git -c core.quotepath=false ls-files)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate tracked source files.' }
    foreach ($buildPath in @('shared/dist', 'backend/dist', 'frontend/dist')) {
        $files += @(Get-ChildItem -LiteralPath (Join-Path $root $buildPath) -Recurse -File | ForEach-Object { $_.FullName.Substring($root.Length + 1).Replace('\','/') })
    }
    $manifestFiles = @()
    foreach ($relative in ($files | Sort-Object -Unique)) {
        if ($relative -match '(^|/)(\.git|node_modules|data|\.artifacts)(/|$)' -or $relative -match '(^|/)\.env($|\.)' -and $relative -ne '.env.example' -or $relative -match '\.sqlite($|-)') {
            throw "Excluded local or sensitive file entered the package list: $relative"
        }
        $source = [IO.Path]::GetFullPath((Join-Path $root $relative))
        if (-not $source.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source path escaped the repository.' }
        $target = Join-Path $packageRoot $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target
        $manifestFiles += [ordered]@{ path = $relative; sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    $manifest = [ordered]@{
        name = $name; version = $version; sourceCommit = $revision
        createdUtc = [DateTime]::UtcNow.ToString('o'); candidate = $true
        independentAcceptance = 'pending'; finalRelease = $false
        prerequisites = @('Node.js and npm; tested with Node 24.18.0 and npm 11.16.0', 'npm ci requires access to the npm registry', 'Chrome/Edge required only for browser regression')
        files = $manifestFiles
    }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $packageRoot 'package-manifest.json') -Encoding UTF8
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = Join-Path $OutputDirectory ("$name-" + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.zip')
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([IO.Path]::GetFileName($zip))" | Set-Content -LiteralPath ($zip + '.sha256') -Encoding ASCII
    Write-Output "Candidate: $zip"
    Write-Output "Source commit: $revision"
    Write-Output "Files: $($manifestFiles.Count); SHA256: $hash"
    Write-Output 'Independent human acceptance is pending; this is not a final release.'
} finally {
    if ($stage) {
        $resolvedStage = [IO.Path]::GetFullPath($stage)
        $expectedParent = [IO.Path]::GetFullPath((Join-Path $root '.artifacts'))
        if ((Split-Path -Parent $resolvedStage) -ne $expectedParent -or (Split-Path -Leaf $resolvedStage) -notlike 'package-stage-*') { throw 'Unsafe staging cleanup path.' }
        if (Test-Path -LiteralPath $resolvedStage) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
    }
    Pop-Location
}
