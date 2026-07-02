# Hey Pelo Ops — GitHub Push + Vercel Deploy
# This script does EVERYTHING automatically.

$env:PATH = "C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files\nodejs;" + $env:PATH
Set-Location "c:\Users\ADMIN\Desktop\CURSOR\Learning cursor\restaurant-ops-instant"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Yellow
Write-Host "  STEP 1: Pushing code to GitHub" -ForegroundColor Yellow
Write-Host "=========================================" -ForegroundColor Yellow
Write-Host ""

# Init git
git init
git remote remove origin 2>$null
git remote add origin https://github.com/ndNamean/heyheyhey.git
git add .
git commit -m "feat: initial Hey Pelo Ops app - InstantDB magic auth, i18n, map picker, full ops platform"
git branch -M main
git push -u origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "GitHub push failed. Check if you are logged in to GitHub." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  Code pushed to GitHub!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""

Write-Host "=========================================" -ForegroundColor Yellow
Write-Host "  STEP 2: Deploying to Vercel" -ForegroundColor Yellow
Write-Host "=========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Your browser will open - log in to Vercel." -ForegroundColor Cyan
Write-Host "Then answer the prompts (just press Enter for each one)." -ForegroundColor Cyan
Write-Host ""

& "C:\Program Files\nodejs\npx.cmd" vercel --yes --prod

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  ALL DONE! Your live URL is above." -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to close"
