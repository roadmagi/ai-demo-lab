# Renders the thumbnail HTML to the PNG sizes Upwork uses.
#
# Upwork shows portfolio images at different aspect ratios across its grid,
# project page, and search results. Cropping one square layout to 16:9 cuts off
# the bottom half, so the wide formats get their own two-column layout instead.
# Same approach as the Speed-to-Lead thumbnails, so the two portfolio pieces
# sit together cleanly.
#
#   pwsh assets/render-thumbnails.ps1

$ErrorActionPreference = "Stop"

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) { throw "No Chrome or Edge found to render with." }

$assets = $PSScriptRoot

function Resolve-Source([string]$name) {
  $path = Join-Path $assets $name
  if (-not (Test-Path $path)) { throw "Missing $path" }
  return ([System.Uri]$path).AbsoluteUri
}

$square = Resolve-Source "thumbnail-chat-upwork.html"      # authored at 1200x1200
$wide   = Resolve-Source "thumbnail-chat-upwork-wide.html" # authored at 1280x720

# source, authored width, authored height, output width, output height, filename
$targets = @(
  @($square, 1200, 1200, 1200, 1200, "thumbnail-chat-1200.png"),
  @($square, 1200, 1200, 1000, 1000, "thumbnail-chat-1000.png"),
  @($square, 1200, 1200,  800,  800, "thumbnail-chat-800.png"),
  @($square, 1200, 1200,  600,  600, "thumbnail-chat-600.png"),
  @($wide,   1280,  720, 1280,  720, "thumbnail-chat-16x9-1280x720.png"),
  @($wide,   1280,  720, 1920, 1080, "thumbnail-chat-16x9-1920x1080.png")
)

foreach ($t in $targets) {
  $url, $authoredW, $authoredH, $outW, $outH, $name = $t
  $out = Join-Path $assets $name

  # Each layout is authored at a fixed size, so other exports are scaled by the
  # device pixel ratio rather than reflowed — the composition stays identical.
  $scale = [Math]::Round($outW / [double]$authoredW, 4)

  & $chrome --headless --disable-gpu --hide-scrollbars `
    --screenshot="$out" `
    --window-size="$authoredW,$authoredH" `
    --force-device-scale-factor=$scale `
    $url 2>$null | Out-Null

  if (Test-Path $out) {
    "{0,-40} {1}x{2}" -f $name, $outW, $outH
  } else {
    Write-Warning "Failed to render $name"
  }
}
