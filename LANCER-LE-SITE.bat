@echo off
setlocal
cd /d "%~dp0"
title Madrador Remote - Site local

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe.
  echo Telechargez-le depuis https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installation des dependances...
  call npm install
  if errorlevel 1 (
    echo [ERREUR] Installation impossible.
    pause
    exit /b 1
  )
)

echo.
echo Site Madrador Remote : http://127.0.0.1:3000
echo Fermez cette fenetre pour arreter le site.
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:3000'"
call npm run server

if errorlevel 1 (
  echo.
  echo [ERREUR] Le serveur n'a pas pu demarrer.
  pause
)
endlocal
