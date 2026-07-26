@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Publier Madrador Remote

echo.
echo ==================================================
echo        Publication de Madrador Remote
echo ==================================================
echo.

where git >nul 2>&1 || (echo ERREUR: Git est introuvable.& pause & exit /b 1)
where node >nul 2>&1 || (echo ERREUR: Node.js est introuvable.& pause & exit /b 1)
where gh >nul 2>&1 || (echo ERREUR: GitHub CLI est introuvable.& pause & exit /b 1)

git rev-parse --show-toplevel >nul 2>&1 || (echo ERREUR: ce script doit rester dans le depot Git.& pause & exit /b 1)
for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"
if /i not "%CURRENT_BRANCH%"=="main" if /i not "%CURRENT_BRANCH%"=="master" (
  echo ERREUR: la publication doit etre lancee depuis main ou master.
  echo Branche actuelle: %CURRENT_BRANCH%
  echo Fusionnez d'abord la pull request, puis relancez ce fichier.
  pause
  exit /b 1
)

for /f "delims=" %%S in ('git status --porcelain') do set "DIRTY=1"
if defined DIRTY (
  echo ERREUR: des fichiers ne sont pas encore commits.
  git status --short
  pause
  exit /b 1
)

set "VERSION=%~1"
if not defined VERSION set /p "VERSION=Version a publier, par exemple 6.2.0 : "
echo %VERSION%| findstr /r "^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$" >nul || (
  echo ERREUR: utilisez une version comme 6.2.0.
  pause
  exit /b 1
)

call gh auth status || (echo ERREUR: connectez GitHub CLI avec gh auth login.& pause & exit /b 1)
git pull --ff-only || (echo ERREUR pendant git pull.& pause & exit /b 1)
call npm ci || (echo ERREUR pendant npm ci.& pause & exit /b 1)
call npm run verify || (echo ERREUR: les tests ont echoue. Rien ne sera publie.& pause & exit /b 1)
call npm version %VERSION% || (echo ERREUR pendant la creation de la version.& pause & exit /b 1)
git push origin %CURRENT_BRANCH% || (echo ERREUR pendant l'envoi du commit.& pause & exit /b 1)
git push origin v%VERSION% || (echo ERREUR pendant l'envoi du tag.& pause & exit /b 1)

echo.
echo Version v%VERSION% envoyee.
echo GitHub Actions compile et publie maintenant automatiquement la Release.
start "" "https://github.com/Madrador60/partager-son-ecran/actions/workflows/release.yml"
pause
