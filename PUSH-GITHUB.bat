@echo off
setlocal EnableExtensions EnableDelayedExpansion
title RemoteAssist - Envoi GitHub
cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo Git n'est pas installe.
  pause
  exit /b 1
)

for /f "delims=" %%A in ('git config --global user.name 2^>nul') do set "GITNAME=%%A"
for /f "delims=" %%A in ('git config --global user.email 2^>nul') do set "GITEMAIL=%%A"

if not defined GITNAME (
  set /p "GITNAME=Nom GitHub : "
  git config --global user.name "!GITNAME!"
)

if not defined GITEMAIL (
  set /p "GITEMAIL=Email GitHub : "
  git config --global user.email "!GITEMAIL!"
)

if not exist ".git" git init
git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/Madrador60/partager-son-ecran.git

if not exist ".gitignore" (
  >.gitignore echo node_modules/
  >>.gitignore echo dist/
  >>.gitignore echo *.log
)

git add .
git diff --cached --quiet
if errorlevel 1 git commit -m "RemoteAssist complet"

git push -u origin main
if errorlevel 1 (
  git pull origin main --allow-unrelated-histories --no-rebase
  git push -u origin main
)

pause
