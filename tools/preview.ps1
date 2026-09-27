<#
  Preview the website on this PC (and on your phone, same Wi-Fi).
  Double-click "Preview website.cmd", or run:  .\tools\preview.ps1 [-NoBrowser] [-Port 4000]

  Pages reload by themselves when you save a file. Drafts (published: false) are shown here
  with a "draft" label, but are never published. Press Ctrl+C to stop.
#>
param(
    [switch]$NoBrowser,
    [int]$Port = 4000
)
. (Join-Path $PSScriptRoot 'common.ps1')

Write-Title 'Website preview'
Initialize-Jekyll
Repair-MarkdownBom

$ip = Get-LanAddress
Write-Host ''
Write-Host "  On this PC:     http://localhost:$Port" -ForegroundColor Green
if ($ip) {
    Write-Host "  On your phone:  http://${ip}:$Port   (same Wi-Fi)" -ForegroundColor Green
    Write-Info "If the phone can't connect, allow 'Ruby' through the Windows firewall (see README)."
}
Write-Info 'Save a file and the page refreshes. Press Ctrl+C to stop.'
Write-Host ''

if (-not $NoBrowser) {
    # Open the browser as soon as the server answers (in a hidden helper process).
    $url = "http://localhost:$Port/"
    $wait = "for (`$i = 0; `$i -lt 180; `$i++) { try { Invoke-WebRequest -UseBasicParsing '$url' -TimeoutSec 2 | Out-Null; Start-Process '$url'; break } catch { Start-Sleep -Seconds 1 } }"
    Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', $wait
}

bundle exec jekyll serve --livereload --unpublished --host 0.0.0.0 --port $Port
