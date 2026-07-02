@echo off
title Vercel Deploy - Hey Pelo Ops
cd /d "%~dp0"

set NPX=C:\Program Files\nodejs\npx.cmd
set NPM=C:\Program Files\nodejs\npm.cmd
set PATH=C:\Program Files\nodejs;%PATH%

echo.
echo =========================================
echo   Deploying to Vercel
echo =========================================
echo.

:: Check Node is available
"%NPX%" --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found at C:\Program Files\nodejs
  pause
  exit /b 1
)

:: First time: Vercel will open your browser to log in.
:: After login it will ask a few setup questions:
::   Set up and deploy? -> Y
::   Which scope? -> your Vercel account
::   Link to existing project? -> N (first time)
::   Project name -> heyheyhey (or press Enter)
::   Which directory is your code? -> . (press Enter)
::   Override settings? -> N

echo Launching Vercel CLI...
echo.
echo FIRST TIME ONLY: Your browser will open to log in to Vercel.
echo Answer the setup questions, then the deploy will start.
echo.

"%NPX%" vercel --prod

echo.
echo =========================================
echo   Deployment complete!
echo   Your live URL is shown above (vercel.app)
echo =========================================
echo.
pause
