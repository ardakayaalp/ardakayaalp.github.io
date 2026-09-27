<#
  Publish the website: checks it, commits everything and pushes to GitHub.
  GitHub Pages then rebuilds ardakayaalp.com (about a minute).
  Double-click "Publish website.cmd", or run:  .\tools\publish.ps1 [-Message "..."] [-DryRun] [-Yes]

    -DryRun   run all checks and show what would be published, change nothing
    -Yes      don't ask for confirmation
#>
param(
    [string]$Message,
    [switch]$DryRun,
    [switch]$Yes
)
. (Join-Path $PSScriptRoot 'common.ps1')

Write-Title 'Publish website'

# ---- 1. Is this the git repository of the site? -------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Stop-WithError 'git is not installed.' }
git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) { Stop-WithError "This folder is not a git repository: $SiteRoot" }
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
$remote = (git remote get-url origin 2>$null)
if (-not $remote) { Stop-WithError 'No "origin" remote is set up for this repository.' }
$repo = ($remote -replace '^.*github\.com[:/]', '' -replace '\.git$', '').Trim()
Write-Ok "Repository $repo, branch $branch"

Repair-MarkdownBom

# Drafts (published: false) are never committed: the GitHub repository is public, so even an
# unpublished file's text would be readable there. They stay on this PC until the flag is removed.
$drafts = @(Get-ChildItem (Join-Path $SiteRoot 'updates') -Recurse -Filter *.md -ErrorAction SilentlyContinue |
    Where-Object { (Get-Content -LiteralPath $_.FullName -TotalCount 15) -match '^\s*published:\s*false' } |
    ForEach-Object { $_.Directory.Name } | Sort-Object -Unique)

# ---- 2. What changed? ----------------------------------------------------------------------------
git fetch --quiet origin 2>$null
$changes = @(git -c core.quotepath=false status --porcelain --untracked-files=all)
$ahead = 0
$upstream = git rev-parse --abbrev-ref '@{u}' 2>$null
if ($LASTEXITCODE -eq 0) {
    $ahead = [int](git rev-list --count "$upstream..HEAD")
    $behind = [int](git rev-list --count "HEAD..$upstream")
    if ($behind -gt 0) { Write-Warn "GitHub has $behind change(s) that are not on this PC yet; they will be merged in first." }
}

# Summarise by what it means rather than by file.
$updates = @{}; $albums = @{}; $other = New-Object System.Collections.Generic.List[string]
$newFiles = New-Object System.Collections.Generic.List[string]
foreach ($line in $changes) {
    $state = $line.Substring(0, 2).Trim()
    $path = $line.Substring(3).Trim('"')
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1] }
    if ($path -match '^updates/([^/]+)/' -and $drafts -contains $Matches[1]) { continue }
    $kind = switch -regex ($state) { '\?|A' { 'new' } 'D' { 'deleted' } default { 'changed' } }
    if ($kind -ne 'deleted') { $newFiles.Add($path) }
    if ($path -match '^updates/([^/]+)/') { $updates[$Matches[1]] = $true }
    elseif ($path -match '^_albums/(.+)\.md$' -or $path -match '^images/albums/([^/]+)/') { $albums[$Matches[1]] = $true }
    else { $other.Add("$kind  $path") }
}
$publishable = $newFiles.Count + @($changes | Where-Object { $_.Substring(0, 2) -match 'D' }).Count
if ($publishable -eq 0 -and $ahead -eq 0) {
    if ($drafts) { Write-Info "Drafts (kept on this PC): $($drafts -join ', ')" }
    Write-Ok 'Nothing new to publish. The live site is up to date.'
    exit 0
}
Write-Host ''
Write-Info "$publishable changed file(s)$(if ($ahead) { " and $ahead saved commit(s) not pushed yet" })"
foreach ($u in ($updates.Keys | Sort-Object)) { Write-Info "  update:  $u" }
foreach ($a in ($albums.Keys | Sort-Object))  { Write-Info "  album:   $a" }
$other | Select-Object -First 12 | ForEach-Object { Write-Info "  $_" }
if ($other.Count -gt 12) { Write-Info "  ... and $($other.Count - 12) more" }
Write-Host ''

# ---- 3. Checks -------------------------------------------------------------------------------------
# Files GitHub refuses (>100 MB) or that make the site slow.
foreach ($f in $newFiles) {
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { continue }
    $mb = (Get-Item -LiteralPath $f).Length / 1MB
    if ($mb -gt 95) { Stop-WithError ("{0} is {1:N0} MB; GitHub does not accept files over 100 MB." -f $f, $mb) }
    elseif ($mb -gt 10) { Write-Warn ("{0} is {1:N0} MB. Large files make the site slow; consider resizing." -f $f, $mb) }
}

# Build exactly like GitHub Pages does (production, safe mode). Stop if it fails.
Initialize-Jekyll
Write-Info 'Test-building the site...'
$out = Join-Path $env:TEMP 'ardakayaalp-publish-check'
$env:JEKYLL_ENV = 'production'
$log = bundle exec jekyll build --safe --destination $out 2>&1
$buildFailed = $LASTEXITCODE -ne 0
Remove-Item Env:JEKYLL_ENV
if ($buildFailed) {
    $log | Where-Object { $_ -notmatch 'faraday-retry|Faraday v2' } | Select-Object -Last 15 | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkYellow }
    Stop-WithError 'The site does not build, so nothing was published. Fix the error above (often a typo in front matter) and try again.'
}
Write-Ok 'Site builds without errors'

# House style: no en/em dashes on the site.
$dashPattern = '[' + [char]0x2013 + [char]0x2014 + ']|&[nm]dash;'   # en dash, em dash
$dashHits = Get-ChildItem $out -Recurse -Include *.html | Where-Object {
    [IO.File]::ReadAllText($_.FullName) -match $dashPattern
} | ForEach-Object { $_.FullName.Substring($out.Length + 1) }
if ($dashHits) { Write-Warn "Long dashes found in: $($dashHits -join ', ')" } else { Write-Ok 'No long dashes' }

if ($drafts) { Write-Info "Drafts (kept on this PC, not published): $($drafts -join ', ')" }

if ($DryRun) {
    Write-Host ''
    Write-Ok 'Dry run finished: everything above would be published. Nothing was changed.'
    exit 0
}

# ---- 4. Confirm ------------------------------------------------------------------------------------
Write-Host ''
if (-not $Message) {
    $default = if ($updates.Count -eq 1) { "New update: $(@($updates.Keys)[0])" } else { "Update website $(Get-Date -Format 'yyyy-MM-dd')" }
    if ($Yes) { $Message = $default } else {
        $Message = Read-Host "  Short description of this change [$default]"
        if (-not $Message.Trim()) { $Message = $default }
    }
}
if (-not $Yes) {
    $answer = Read-Host '  Publish to ardakayaalp.com now? (y/n)'
    if ($answer -notmatch '^(y|yes)$') { Write-Info 'Cancelled. Nothing was published.'; exit 0 }
}

# ---- 5. Commit and push ------------------------------------------------------------------------------
# git needs a name and email for commits; ask once and remember them for this repository.
if (-not (git config user.email)) {
    if ($Yes) { Stop-WithError 'git does not know your name/email yet. Run "Publish website" once without -Yes to set it.' }
    Write-Info 'git needs a name and email for the change history (shown on GitHub). Asked only once.'
    $name = Read-Host '  Your name'
    $email = Read-Host '  Your email (the one on your GitHub account)'
    if (-not $name.Trim() -or -not $email.Trim()) { Stop-WithError 'Name and email are needed to publish.' }
    git config user.name $name.Trim()
    git config user.email $email.Trim()
}
if ($publishable -gt 0) {
    git -c core.safecrlf=false add --all      # no "LF will be replaced by CRLF" noise
    foreach ($d in $drafts) { git reset --quiet -- "updates/$d" 2>$null }
    git commit --quiet -m $Message
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'git commit failed (see above).' }
}
if ($upstream) {
    git pull --rebase --quiet
    if ($LASTEXITCODE -ne 0) {
        git rebase --abort 2>$null
        Stop-WithError 'Your changes conflict with edits made on GitHub. Your commit is saved locally; ask for help to merge.'
    }
}
git push --quiet origin $branch
if ($LASTEXITCODE -ne 0) { Stop-WithError 'git push failed (check your internet connection or GitHub login).' }
$sha = (git rev-parse HEAD).Trim()
Write-Ok "Pushed to GitHub ($($sha.Substring(0, 7)))"

# ---- 6. Wait for GitHub Pages ------------------------------------------------------------------------
$ghReady = $false
if ($remote -match 'github\.com' -and (Get-Command gh -ErrorAction SilentlyContinue)) { gh auth status *> $null; $ghReady = $LASTEXITCODE -eq 0 }
if ($ghReady) {
    Write-Info 'Waiting for GitHub Pages to rebuild the site...'
    $deadline = (Get-Date).AddMinutes(6)
    $status = ''
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 10
        $build = gh api "repos/$repo/pages/builds/latest" 2>$null | ConvertFrom-Json
        if ($build -and $build.commit -eq $sha) {
            $status = $build.status
            if ($status -eq 'built') { break }
            if ($status -eq 'errored') { break }
        }
    }
    if ($status -eq 'built') {
        Write-Ok 'Live at https://ardakayaalp.com  (press Ctrl+F5 if you still see the old version)'
        Start-Process 'https://ardakayaalp.com'
    } elseif ($status -eq 'errored') {
        Stop-WithError "GitHub could not build the site. Details: https://github.com/$repo/actions"
    } else {
        Write-Warn "Still building. Check https://github.com/$repo/actions in a minute."
    }
} else {
    Write-Ok 'Done. The site updates within a minute or two: https://ardakayaalp.com'
}
