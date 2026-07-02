@echo off
title Hey Pelo Ops - Make Me Admin
cd /d "%~dp0"

set NPM=C:\Program Files\nodejs\npm.cmd
set PATH=C:\Program Files\nodejs;%PATH%

echo.
echo =========================================
echo   Hey Pelo Ops - Admin Account Setup
echo =========================================
echo.
echo This makes ops@heypelo.com the app owner/admin.
echo.
echo IMPORTANT: You must have signed in to the app
echo at least once before running this.
echo.
"%NPM%" run seed-owner -- ops@heypelo.com
if errorlevel 1 (
  echo.
  echo ERROR: Could not set admin account.
  echo Make sure you signed in to the app first.
  echo Send a screenshot for help.
  pause
  exit /b 1
)

echo.
echo =========================================
echo   Done! ops@heypelo.com is now the admin.
echo =========================================
echo.
echo Go back to the app in your browser.
echo It will update automatically - no refresh needed.
echo.
pause
