# Renders each invoice HTML to PDF.
#
# The HTML stays in the repo so the samples remain editable rather than
# becoming opaque binaries — the same reasoning behind render-thumbnails.ps1.
# Run from the assets/ directory:  .\render-invoices.ps1

$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw "No Chrome or Edge found for headless rendering." }

$outDir = Join-Path (Split-Path $PSScriptRoot -Parent) "content\invoices"
New-Item -ItemType Directory -Force $outDir | Out-Null

# One timestamped profile root per run. Nothing is deleted afterwards: these
# live under TEMP, the OS reclaims them, and a cleanup step here would be one
# more thing to get wrong on a path containing spaces.
$profileRoot = Join-Path ([System.IO.Path]::GetTempPath()) "invoice-render-$(Get-Random)"

foreach ($name in @("clean", "bad-total", "inferred-field")) {
  $src = (Resolve-Path (Join-Path $PSScriptRoot "invoices\$name.html")).Path
  $out = Join-Path $outDir "$name.pdf"
  $uri = "file:///" + ($src -replace '\\', '/')

  # Three flags are load-bearing and none is obvious:
  #   --headless=new    current Edge and Chrome silently decline to print
  #                     under the legacy bare `--headless`.
  #   --user-data-dir   a distinct profile per invoice; otherwise the second
  #                     run attaches to the first's still-closing singleton
  #                     and exits without printing, so only one PDF appears.
  #   --no-first-run    required *because* the profile is fresh — Edge would
  #                     otherwise run its first-run flow and never print.
  # Values are quoted *inside* each argument. This repo lives under a path
  # containing a space ("Claude Code"), and Start-Process splits unquoted
  # -ArgumentList entries on whitespace — Edge then sees the two halves as
  # two navigation targets and dies with "Multiple targets are not supported
  # in headless mode" without printing anything.
  $browserArgs = @(
    "--headless=new"
    "--disable-gpu"
    "--no-pdf-header-footer"
    "--user-data-dir=`"$profileRoot-$name`""
    "--no-first-run"
    "--no-default-browser-check"
    "--print-to-pdf=`"$out`""
    "`"$uri`""
  )

  # Remove any previous render first, so a stale file can never be mistaken
  # for a fresh one — that exact confusion cost real debugging time here.
  if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }

  # Start-Process -Wait, not `& $browser`: the call operator returns as soon
  # as Edge detaches, and the script then tests for a file that is still
  # being written.
  Start-Process -FilePath $browser -ArgumentList $browserArgs -Wait -NoNewWindow

  # Even after exit the write can lag briefly, so poll rather than assume.
  $deadline = (Get-Date).AddSeconds(20)
  while (-not (Test-Path -LiteralPath $out) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 200
  }

  if (-not (Test-Path -LiteralPath $out)) { throw "Failed to render $name.pdf" }
  Write-Host ("rendered {0} ({1:N0} bytes)" -f "$name.pdf", (Get-Item $out).Length)
}
