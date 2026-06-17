# ScreenCast startup script
Write-Host "Stopping processes on ports 3000, 1935, 8000..." -ForegroundColor Yellow

foreach ($port in @(3000, 1935, 8000)) {
    $lines = netstat -ano | Select-String ":$port\s" | Select-String "LISTENING"
    foreach ($line in $lines) {
        $procId = ($line.ToString().Trim() -split '\s+')[-1]
        if ($procId -match '^\d+$' -and $procId -ne '0') {
            taskkill /PID $procId /F 2>$null | Out-Null
            Write-Host "  Killed PID $procId on port $port" -ForegroundColor Gray
        }
    }
}

Start-Sleep -Seconds 1
Write-Host "Starting ScreenCast..." -ForegroundColor Green
npx ts-node --project tsconfig.server.json server.ts
