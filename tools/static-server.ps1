param(
    [string]$Root = ".",
    [int]$Port = 8080
)

$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
$listener.Start()
Write-Host "Serving $resolvedRoot at http://localhost:$Port/"

function Get-ContentType([string]$Path) {
    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        ".html" { "text/html; charset=utf-8" }
        ".css" { "text/css; charset=utf-8" }
        ".js" { "application/javascript; charset=utf-8" }
        ".png" { "image/png" }
        ".jpg" { "image/jpeg" }
        ".jpeg" { "image/jpeg" }
        ".svg" { "image/svg+xml" }
        default { "application/octet-stream" }
    }
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            while ($reader.ReadLine()) { }

            $path = "index.html"
            if ($requestLine -match "^[A-Z]+\s+([^\s]+)\s+HTTP/") {
                $path = [System.Uri]::UnescapeDataString($Matches[1].Split("?")[0].TrimStart("/"))
                if ([string]::IsNullOrWhiteSpace($path)) { $path = "index.html" }
            }

            $target = Join-Path $resolvedRoot $path
            $fullTarget = [System.IO.Path]::GetFullPath($target)
            if (!$fullTarget.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $fullTarget -PathType Leaf)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes("Not found")
                $header = [System.Text.Encoding]::ASCII.GetBytes("HTTP/1.1 404 Not Found`r`nContent-Length: $($body.Length)`r`nContent-Type: text/plain`r`nConnection: close`r`n`r`n")
                $stream.Write($header, 0, $header.Length)
                $stream.Write($body, 0, $body.Length)
            } else {
                $body = [System.IO.File]::ReadAllBytes($fullTarget)
                $contentType = Get-ContentType $fullTarget
                $header = [System.Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Length: $($body.Length)`r`nContent-Type: $contentType`r`nConnection: close`r`n`r`n")
                $stream.Write($header, 0, $header.Length)
                $stream.Write($body, 0, $body.Length)
            }
        }
        finally {
            $client.Close()
        }
    }
}
finally {
    $listener.Stop()
}
