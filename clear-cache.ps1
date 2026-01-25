# Clear all Vite and Angular caches
Write-Host "Clearing caches..." -ForegroundColor Yellow

$paths = @(
    ".angular",
    "node_modules\.vite",
    ".vite",
    "dist"
)

foreach ($path in $paths) {
    if (Test-Path $path) {
        Write-Host "Removing $path..." -ForegroundColor Cyan
        Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
        Write-Host "Cleared $path" -ForegroundColor Green
    } else {
        Write-Host "$path not found" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "Cache cleared successfully! Please restart your dev server." -ForegroundColor Green
