@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Can cai Node.js 24.19 tro len truoc khi chay.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>24 || v[0]===24 && v[1]>=19 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js qua cu. Hay cai Node.js 24.19 tro len.
  pause
  exit /b 1
)
node scripts/prepare.js
if errorlevel 1 (
  pause
  exit /b 1
)
node --use-env-proxy launch.js
pause
