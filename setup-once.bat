@echo off
title Hey Pelo Ops - One-Time Setup
cd /d "%~dp0"

set NPX=C:\Program Files\nodejs\npx.cmd
set NPM=C:\Program Files\nodejs\npm.cmd
set PATH=C:\Program Files\nodejs;%PATH%
set INSTANT_APP_ADMIN_TOKEN=58ea1b1e-0565-487a-89d8-4a1f506c947a

echo.
echo =========================================
echo   Hey Pelo Ops - One-Time Database Setup
echo =========================================
echo.
echo Step 1 of 2: Pushing database structure...
echo.
"%NPX%" instant-cli@latest push schema --yes
if errorlevel 1 (
  echo.
  echo ERROR on Step 1. Send a screenshot for help.
  pause
  exit /b 1
)

echo.
echo Step 2 of 2: Pushing security rules...
echo.
"%NPX%" instant-cli@latest push perms --yes
if errorlevel 1 (
  echo.
  echo ERROR on Step 2. Send a screenshot for help.
  pause
  exit /b 1
)

echo.
echo =========================================
echo   Setup complete!
echo =========================================
echo.
echo You can now run start-dev.bat to open the app.
echo.
pause
