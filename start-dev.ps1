Set-Location "C:\Users\mohit\OneDrive\Desktop\PrintX\printx-frontend"
$log = "C:\Users\mohit\OneDrive\Desktop\PrintX\.freebuff\preview-9100e15b-7f51-4fb9-8089-02197790ea04.log"
$logErr = "$log.err"
$proc = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -RedirectStandardOutput $log -RedirectStandardError $logErr -WindowStyle Hidden -PassThru
Write-Output "Server started with PID: $($proc.Id)"
