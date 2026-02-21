# Build apex-scanner image from project root.
# Run from repo root: .\docker\build-scanner.ps1
Set-Location $PSScriptRoot\..
docker build -f docker/Dockerfile.scanner -t apex-scanner:latest . --progress=plain
if ($LASTEXITCODE -eq 0) {
  Write-Host "Done. Verify with: docker images apex-scanner" -ForegroundColor Green
}
