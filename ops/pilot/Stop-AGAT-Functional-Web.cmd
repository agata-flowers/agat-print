@echo off
setlocal
cd /d "%~dp0\..\.."
docker compose --profile processing stop web api processing-worker postgres redis minio clamav
if errorlevel 1 (
  echo Не удалось остановить один или несколько сервисов.
  pause
  exit /b 1
)
echo AGAT PRINT остановлен. Тестовые данные сохранены для следующего запуска.
pause
endlocal
