@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 from https://nodejs.org then reopen your terminal and run this again.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0]) !== 24) process.exit(1)"
if errorlevel 1 (
  echo This launcher requires Node.js 24. Install it from https://nodejs.org then reopen your terminal.
  pause
  exit /b 1
)
node scripts/setup.ts
if errorlevel 1 (
  pause
  exit /b 1
)
echo Building the replay interface...
call npm.cmd run build
if errorlevel 1 (
  echo Build failed. RiftLogs was not started. See the error above.
  pause
  exit /b 1
)
node scripts/start.ts
if errorlevel 1 pause
