param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$previewRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "dist"))
$previewPrefix = $previewRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$address = [System.Net.IPAddress]::Loopback
$port = 4173

if (-not (Test-Path -LiteralPath (Join-Path $previewRoot "index.html"))) {
  throw "Preview files are incomplete. Extract the complete ZIP archive and retry."
}

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg" = "image/svg+xml"
  ".png" = "image/png"
  ".ico" = "image/x-icon"
}

$listener = [System.Net.Sockets.TcpListener]::new($address, $port)
$listener.Start()
$previewUrl = "http://127.0.0.1:$port/?lang=ru&surface=customer&step=home"
Write-Host "AGAT PRINT preview is available at $previewUrl"
Write-Host "Synthetic data only. Press Ctrl+C to stop."
if (-not $NoBrowser) { Start-Process $previewUrl }

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      while ($reader.ReadLine()) { }

      $parts = if ($requestLine) { $requestLine.Split(" ") } else { @() }
      if ($parts.Count -lt 2 -or ($parts[0] -ne "GET" -and $parts[0] -ne "HEAD")) {
        $status = "405 Method Not Allowed"
        $body = [System.Text.Encoding]::UTF8.GetBytes("Method not allowed")
        $contentType = "text/plain; charset=utf-8"
      } else {
        $requestPath = [System.Uri]::UnescapeDataString(($parts[1].Split("?")[0])).TrimStart("/")
        if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = "index.html" }
        $candidate = [System.IO.Path]::GetFullPath((Join-Path $previewRoot $requestPath.Replace("/", [System.IO.Path]::DirectorySeparatorChar)))
        if (-not $candidate.StartsWith($previewPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
          $status = "403 Forbidden"
          $body = [System.Text.Encoding]::UTF8.GetBytes("Forbidden")
          $contentType = "text/plain; charset=utf-8"
        } elseif (Test-Path -LiteralPath $candidate -PathType Leaf) {
          $status = "200 OK"
          $body = [System.IO.File]::ReadAllBytes($candidate)
          $extension = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
          $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { "application/octet-stream" }
        } else {
          $status = "404 Not Found"
          $body = [System.Text.Encoding]::UTF8.GetBytes("Not found")
          $contentType = "text/plain; charset=utf-8"
        }
      }

      $headers = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store, private`r`nX-Content-Type-Options: nosniff`r`nContent-Security-Policy: default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'`r`nConnection: close`r`n`r`n"
      $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      if ($parts.Count -ge 1 -and $parts[0] -ne "HEAD") {
        $stream.Write($body, 0, $body.Length)
      }
      $stream.Flush()
    } finally {
      $client.Dispose()
    }
  }
} finally {
  $listener.Stop()
}
