@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Madrador Remote - Verification, build et publication

set "REPO=Madrador60/partager-son-ecran"
set "REMOTE=https://github.com/Madrador60/partager-son-ecran.git"

echo [1/7] Installation des dependances...
call npm install || goto :fatal

echo [2/7] Verification du code...
call npm run verify || goto :fatal

echo [3/7] Creation de l'installateur...
call npm run dist || goto :fatal

echo [4/7] Configuration GitHub...
if not exist .git git init || goto :fatal
git branch -M main || goto :fatal
git remote get-url origin >nul 2>nul
if errorlevel 1 (git remote add origin "%REMOTE%") else (git remote set-url origin "%REMOTE%")

echo [5/7] Publication du code...
git add -A || goto :fatal
git diff --cached --quiet
if errorlevel 1 git commit -m "Madrador Remote V6 - amelioration complete"
git push -u origin main --force || goto :fatal

echo [6/7] Code publie avec succes.
echo [7/7] Publication facultative de l'EXE dans GitHub Releases...
where gh >nul 2>nul
if errorlevel 1 goto :release_skip
gh auth status >nul 2>nul
if errorlevel 1 goto :release_skip
set "EXE=dist\Madrador-Remote-Setup-6.0.0.exe"
if not exist "%EXE%" goto :release_skip
gh release view v6.0.0 --repo %REPO% >nul 2>nul
if errorlevel 1 (
  gh release create v6.0.0 "%EXE%" --repo %REPO% --title "Madrador Remote V6" --notes "Version V6 : sécurité, serveur configurable, build et publication fiabilisés."
) else (
  gh release upload v6.0.0 "%EXE%" --repo %REPO% --clobber
)
if errorlevel 1 goto :release_skip

echo.
echo TOUT EST TERMINE : code et EXE publies.
pause
exit /b 0

:release_skip
echo.
echo Le code est bien publie. La Release EXE a ete ignoree sans annuler le travail.
echo L'installateur reste disponible dans le dossier dist.
pause
exit /b 0

:fatal
echo.
echo ERREUR BLOQUANTE AVANT LA PUBLICATION. Aucun retour automatique en arriere.
pause
exit /b 1
