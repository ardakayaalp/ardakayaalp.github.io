<#
  Start a new update: creates updates/YYYY-MM-DD-short-title/update.md and a figures/ folder,
  then opens it in your editor.
  Double-click "New update.cmd", or run:  .\tools\new-update.ps1 "Beam time at ISOLDE" [-Tags research,travel]
#>
param(
    [string]$Title,
    [string]$Tags = '',
    [switch]$NoOpen
)
. (Join-Path $PSScriptRoot 'common.ps1')

Write-Title 'New update'
if (-not $Title) { $Title = Read-Host '  Title' }
if (-not $Title.Trim()) { Stop-WithError 'A title is needed.' }
if (-not $Tags) { $Tags = Read-Host '  Tags, comma separated (optional, e.g. research,photography)' }

# "Beam time at ISOLDE!" -> "beam-time-at-isolde" (accents are removed)
$ascii = -join ($Title.Normalize([Text.NormalizationForm]::FormD).ToCharArray() |
        Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne 'NonSpacingMark' })
$slug = ($ascii.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
if (-not $slug) { $slug = 'update' }

$date = Get-Date -Format 'yyyy-MM-dd'
$folder = Join-Path $SiteRoot "updates\$date-$slug"
if (Test-Path $folder) { Stop-WithError "updates\$date-$slug already exists." }
New-Item -ItemType Directory -Path (Join-Path $folder 'figures') -Force | Out-Null

$tagList = ($Tags -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ }) -join ', '
$safeTitle = $Title.Replace('\', '\\').Replace('"', '\"')
$text = @"
---
title: "$safeTitle"
tags: [$tagList]
# description: "One sentence for the Updates list and link previews (optional)"
# math: true          # enables LaTeX, e.g. `$E = mc^2`$
# published: false    # draft: only visible in the preview, never published
---

Write the first paragraph here. It is used as the preview on the Updates page.

![This text becomes the caption of Figure 1. *Italics* work too.](figures/my-figure.png){#fig:my-figure}

## A section heading {#sec:first}

Put images in the figures folder next to this file. Refer to them and to sections
like this: @fig:my-figure shows ..., as discussed in @sec:first.

<!-- Figures and sections are numbered automatically. Add "section_numbers: false" to the
     front matter to turn off section numbers. Equations: \label{eq:x} and \eqref{eq:x}. -->
"@
$file = Join-Path $folder 'update.md'
[IO.File]::WriteAllText($file, $text.Replace("`r`n", "`n"), (New-Object Text.UTF8Encoding $false))   # UTF-8 without BOM

Write-Ok "Created updates\$date-$slug\update.md"
Write-Ok "Put figures in updates\$date-$slug\figures\"
if ($NoOpen) {
    # just create the files
} elseif (Get-Command code -ErrorAction SilentlyContinue) {
    code $folder $file
} else {
    Start-Process notepad $file
    Start-Process explorer (Join-Path $folder 'figures')
}
Write-Info 'Run "Preview website" to see it, "Publish website" when it is ready.'
