# Shared helpers for the website scripts (dot-sourced by preview/publish/new-update).

# 'Continue': git/bundle write progress to stderr, which Windows PowerShell 5.1 would treat as fatal
# under 'Stop'. The scripts check $LASTEXITCODE themselves.
$ErrorActionPreference = 'Continue'
$SiteRoot = Split-Path $PSScriptRoot -Parent
Set-Location $SiteRoot

# Ruby (installed with winget / RubyInstaller) may be missing from PATH in consoles opened before the install.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

function Write-Title([string]$text) {
    Write-Host ''
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host ('  ' + ('=' * $text.Length)) -ForegroundColor DarkCyan
}
function Write-Ok([string]$text)   { Write-Host "  [ok]   $text" -ForegroundColor Green }
function Write-Warn([string]$text) { Write-Host "  [!]    $text" -ForegroundColor Yellow }
function Write-Info([string]$text) { Write-Host "         $text" }
function Stop-WithError([string]$text) {
    Write-Host ''
    Write-Host "  [x]    $text" -ForegroundColor Red
    Write-Host ''
    exit 1
}

# Make sure Ruby and the site's gems are installed (first run takes a few minutes).
function Initialize-Jekyll {
    if (-not (Get-Command bundle -ErrorAction SilentlyContinue)) {
        Stop-WithError "Ruby is not installed. Install it with:  winget install RubyInstallerTeam.RubyWithDevKit.3.3   then run this again."
    }
    bundle config set --local path vendor/bundle | Out-Null
    bundle check *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Info 'Installing the website tools (first run only, a few minutes)...'
        bundle install
        if ($LASTEXITCODE -ne 0) { Stop-WithError 'bundle install failed (see messages above).' }
    }
}

# Editors sometimes save Markdown with a UTF-8 "BOM", which hides the front matter from Jekyll. Remove it.
function Repair-MarkdownBom {
    $fixed = 0
    Get-ChildItem -Path (Join-Path $SiteRoot 'updates'), (Join-Path $SiteRoot '_albums') -Recurse -Filter *.md -ErrorAction SilentlyContinue | ForEach-Object {
        $bytes = [IO.File]::ReadAllBytes($_.FullName)
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
            [IO.File]::WriteAllBytes($_.FullName, $bytes[3..($bytes.Length - 1)])
            $fixed++
        }
    }
    if ($fixed) { Write-Ok "Removed a byte-order mark from $fixed Markdown file(s)" }
}

function Get-LanAddress {
    try {
        (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -in 'Dhcp', 'Manual' } |
            Select-Object -First 1).IPAddress
    } catch { $null }
}
