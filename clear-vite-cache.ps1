# Clear all Vite and Angular caches to fix SSR pre-bundle issues
Write-Host "Clearing all caches..." -ForegroundColor Yellow

$paths = @(
    ".angular",
    ".angular\cache",
    "node_modules\.vite",
    ".vite",
    "dist"
)

foreach ($path in $paths) {
    if (Test-Path $path) {
        Write-Host "Removing $path..." -ForegroundColor Cyan
        Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
        Write-Host "✓ Cleared $path" -ForegroundColor Green
    } else {
        Write-Host "✗ $path not found" -ForegroundColor Gray
    }
}

Write-Host "`nAll caches cleared! Please restart your dev server." -ForegroundColor Green
Write-Host "If the issue persists, run: npm run clean" -ForegroundColor Yellow















