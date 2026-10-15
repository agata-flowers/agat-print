$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location -LiteralPath $projectRoot

function Stop-WithMessage([string]$Message) {
  Write-Host ""
  Write-Host $Message -ForegroundColor Red
  Write-Host "Исправьте указанную проблему и запустите файл ещё раз."
  exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Stop-WithMessage "Docker Desktop не найден. Установите Docker Desktop и включите Linux containers / WSL 2."
}

try {
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw "docker-info" }
} catch {
  Stop-WithMessage "Docker Desktop установлен, но сейчас не запущен. Запустите его и дождитесь статуса Engine running."
}

$env:NODE_ENV = "development"
$env:WEB_ORIGIN = "http://localhost:3000"
$env:OTP_PROVIDER = "mock"
$env:PAYMENT_PROVIDER = "mock"
$env:FISCAL_PROVIDER = "mock"
$env:PAYOUT_PROVIDER = "mock"
$env:DELIVERY_PROVIDER = "internal"
$env:STAGE13_FULFILLMENT_ENABLED = "true"

Write-Host "AGAT PRINT: проверка Docker Compose..." -ForegroundColor Cyan
docker compose --profile processing config --quiet
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Docker Compose configuration is invalid." }

Write-Host "AGAT PRINT: сборка защищённых сервисов..." -ForegroundColor Cyan
docker compose --profile processing build api web processing-runtime processing-worker
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Не удалось собрать контейнеры AGAT PRINT." }

Write-Host "AGAT PRINT: запуск PostgreSQL, Redis, MinIO и ClamAV..." -ForegroundColor Cyan
docker compose up -d --wait postgres redis minio clamav
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Базовые сервисы не перешли в healthy state." }

Write-Host "AGAT PRINT: применение миграций..." -ForegroundColor Cyan
docker compose run --rm api pnpm --filter @agat/api exec prisma migrate deploy
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Миграции PostgreSQL не применились." }

Write-Host "AGAT PRINT: подготовка синтетической студии и каталога..." -ForegroundColor Cyan
docker compose run --rm api node apps/api/scripts/pilot-seed.mjs
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Не удалось подготовить безопасные тестовые данные." }

Write-Host "AGAT PRINT: запуск API, Web и изолированной обработки..." -ForegroundColor Cyan
docker compose --profile processing up -d --wait api web processing-worker
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Приложение не перешло в ready state." }

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    $api = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:4000/api/v1/health/ready" -TimeoutSec 2
    $web = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000" -TimeoutSec 2
    if ($api.StatusCode -eq 200 -and $web.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}
if (-not $ready) { Stop-WithMessage "API или Web не ответили в течение двух минут." }

Write-Host ""
Write-Host "AGAT PRINT готов: http://localhost:3000" -ForegroundColor Green
Write-Host "Откроется клиентский Web. Инструкция находится в ops\pilot\README_RU.txt."
Start-Process "http://localhost:3000/?lang=ru"
