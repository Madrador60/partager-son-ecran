@echo off
setlocal
title RemoteAssist - Installation et creation EXE
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js LTS n'est pas installe.
  echo Installe Node.js LTS puis relance ce fichier.
  pause
  exit /b 1
)

echo.
echo Installation des dependances...
call npm install
if errorlevel 1 goto :error

echo.
echo Creation de l'installateur Windows...
call npm run dist
if errorlevel 1 goto :error

echo.
echo TERMINE.
echo L'installateur se trouve dans le dossier dist.
pause
exit /b 0

:error
echo.
echo Une erreur est survenue. Lis le message au-dessus.
pause
exit /b 1
