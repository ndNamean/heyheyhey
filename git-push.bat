@echo off
title GitHub Push - Hey Pelo Ops
cd /d "%~dp0"

:: Add Git to PATH (standard install locations)
set PATH=C:\Program Files\Git\cmd;C:\Program Files\Git\bin;%PATH%

echo.
echo =========================================
echo   Pushing code to GitHub
echo =========================================
echo.

:: Check git is available
git --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Git not found.
  echo.
  echo Please install Git from https://git-scm.com/download/win
  echo Then run this file again.
  pause
  exit /b 1
)

echo Git found. Proceeding...
echo.

:: Initialize repo if not already done
if not exist ".git\" (
  echo Initialising git repository...
  git init
  echo.
)

:: Set remote (remove existing if any, then add fresh)
git remote remove origin 2>nul
git remote add origin https://github.com/ndNamean/heyheyhey.git
echo Remote set to: https://github.com/ndNamean/heyheyhey.git
echo.

:: Stage everything (respects .gitignore — .env will NOT be committed)
echo Staging all files...
git add .
echo.

:: Commit
echo Committing...
git commit -m "feat: initial Hey Pelo Ops app - InstantDB, magic code auth, i18n, map picker"
echo.

:: Push
echo Pushing to GitHub (you may be asked to log in)...
git branch -M main
git push -u origin main
if errorlevel 1 (
  echo.
  echo Push failed. Common fixes:
  echo  1. GitHub login popup - sign in then re-run this file
  echo  2. Run in Cursor terminal: git push -u origin main
  pause
  exit /b 1
)

echo.
echo =========================================
echo   Done! Code is live on GitHub.
echo   https://github.com/ndNamean/heyheyhey
echo =========================================
echo.
pause
