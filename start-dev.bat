@echo off
title Hey Pelo Ops - Dev Server
cd /d "%~dp0"

set NODE=C:\Program Files\nodejs\node.exe
set NPM=C:\Program Files\nodejs\npm.cmd
set PATH=C:\Program Files\nodejs;%PATH%

echo.
echo =========================================
echo   Hey Pelo Ops - Starting App
echo =========================================
echo.

echo Checking dependencies (this is fast if already installed)...
echo.
"%NPM%" install
if errorlevel 1 (
  echo.
  echo ERROR: Something went wrong during install.
  echo Please send a screenshot of this window for help.
  pause
  exit /b 1
)

echo.
echo App is starting at http://localhost:5173
echo Open that address in your browser.
echo.
echo Keep this black window open while using the app.
echo To stop the app, press Ctrl+C or close this window.
echo.
"%NPM%" run dev
pause
