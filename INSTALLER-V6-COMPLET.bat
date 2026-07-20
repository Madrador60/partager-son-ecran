@echo off
setlocal
cd /d "%~dp0"
title Installation complete Madrador Remote V6
where node >nul 2>nul || (echo Installe Node.js LTS puis relance ce fichier.& pause & exit /b 1)
call npm install || (echo Echec npm install.& pause & exit /b 1)
call npm run verify || (echo Verification echouee.& pause & exit /b 1)
echo.
echo Installation terminee. Lance LANCER-EN-TEST.bat pour tester.
echo Lance PUBLICATION-TOTALE.bat pour creer l'EXE et publier GitHub.
pause
