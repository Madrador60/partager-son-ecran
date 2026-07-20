@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Madrador Remote V6 - Publication complete

set "PROJECT=C:\Users\madra\Desktop\RemoteAssist-Complete"
set "REPO=Madrador60/partager-son-ecran"
set "REMOTE=https://github.com/Madrador60/partager-son-ecran.git"
set "TAG=v6.0.0"
set "TITLE=Madrador Remote V6"
set "LOG=%~dp0RAPPORT-PUBLICATION-V6.txt"

> "%LOG%" echo MADRADOR REMOTE V6 - RAPPORT DE PUBLICATION
>>"%LOG%" echo Date : %date% %time%
>>"%LOG%" echo.

echo ============================================================
echo       MADRADOR REMOTE V6 - PUBLICATION COMPLETE
echo ============================================================
echo.
echo Projet :
echo %PROJECT%
echo.
echo Depot :
echo %REPO%
echo.

if not exist "%PROJECT%\package.json" (
    echo [ERREUR] Projet introuvable : %PROJECT%
    >>"%LOG%" echo [ERREUR] Projet introuvable : %PROJECT%
    pause
    exit /b 1
)

cd /d "%PROJECT%"
if errorlevel 1 goto :fatal

call :check_tool node "Node.js"
if errorlevel 1 goto :fatal

call :check_tool npm "npm"
if errorlevel 1 goto :fatal

call :check_tool git "Git"
if errorlevel 1 goto :fatal

where gh >nul 2>nul
if errorlevel 1 (
    echo [INFO] GitHub CLI n'est pas installe.
    echo Installation automatique avec winget...
    >>"%LOG%" echo [INFO] Installation de GitHub CLI avec winget.
    where winget >nul 2>nul
    if errorlevel 1 (
        echo [ERREUR] winget est introuvable.
        echo Installe GitHub CLI depuis https://cli.github.com/
        >>"%LOG%" echo [ERREUR] winget et GitHub CLI introuvables.
        pause
        exit /b 1
    )
    winget install --id GitHub.cli --exact --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo [ERREUR] Installation de GitHub CLI impossible.
        >>"%LOG%" echo [ERREUR] Installation de GitHub CLI impossible.
        pause
        exit /b 1
    )
    set "PATH=%PATH%;C:\Program Files\GitHub CLI"
)

echo [1/9] Connexion a GitHub...
>>"%LOG%" echo [1/9] Verification de la connexion GitHub.
gh auth status >nul 2>nul
if errorlevel 1 (
    echo Une connexion GitHub est necessaire.
    echo Choisis GitHub.com, HTTPS, puis connecte-toi avec le navigateur.
    gh auth login
    if errorlevel 1 (
        echo [ERREUR] Connexion GitHub echouee.
        >>"%LOG%" echo [ERREUR] Connexion GitHub echouee.
        pause
        exit /b 1
    )
)

echo [2/9] Installation des dependances...
>>"%LOG%" echo [2/9] npm install
call npm install
if errorlevel 1 goto :fatal

echo [3/9] Verification du projet...
>>"%LOG%" echo [3/9] npm run check
call npm run check
if errorlevel 1 goto :fatal

call npm run 2>nul | findstr /C:"security:check" >nul
if not errorlevel 1 (
    echo Verification de securite...
    >>"%LOG%" echo npm run security:check
    call npm run security:check
    if errorlevel 1 goto :fatal
)

call npm run 2>nul | findstr /C:"v5:check" >nul
if not errorlevel 1 (
    echo Verification des modules...
    >>"%LOG%" echo npm run v5:check
    call npm run v5:check
    if errorlevel 1 goto :fatal
)

echo [4/9] Creation propre de l'installateur...
>>"%LOG%" echo [4/9] npm run dist
if exist "dist" rmdir /s /q "dist"
call npm run dist
if errorlevel 1 goto :fatal

set "EXE="
for /f "delims=" %%F in ('dir /b /a-d /o-d "dist\Madrador-Remote-Setup-*.exe" 2^>nul') do (
    if not defined EXE set "EXE=%PROJECT%\dist\%%F"
)

if not defined EXE (
    echo [ERREUR] Aucun installateur Madrador-Remote-Setup-*.exe trouve.
    >>"%LOG%" echo [ERREUR] Installateur introuvable dans dist.
    pause
    exit /b 1
)

echo Installateur trouve :
echo !EXE!
>>"%LOG%" echo Installateur : !EXE!

echo [5/9] Preparation du depot Git...
>>"%LOG%" echo [5/9] Preparation Git
if not exist ".git" (
    git init
    if errorlevel 1 goto :fatal
)

git branch -M main
if errorlevel 1 goto :fatal

git remote get-url origin >nul 2>nul
if errorlevel 1 (
    git remote add origin "%REMOTE%"
) else (
    git remote set-url origin "%REMOTE%"
)
if errorlevel 1 goto :fatal

echo [6/9] Publication du code source...
>>"%LOG%" echo [6/9] git add / commit / push
git add -A
if errorlevel 1 goto :fatal

git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Madrador Remote V6 - publication complete"
    if errorlevel 1 goto :fatal
) else (
    echo Aucun nouveau changement a committer.
    >>"%LOG%" echo Aucun nouveau changement a committer.
)

git push -u origin main
if errorlevel 1 (
    echo.
    echo Le push normal a echoue. Tentative apres recuperation de la branche distante...
    >>"%LOG%" echo Push normal echoue, tentative avec pull --rebase.
    git pull --rebase origin main
    if errorlevel 1 (
        echo [ERREUR] Impossible de synchroniser avec GitHub.
        >>"%LOG%" echo [ERREUR] git pull --rebase echoue.
        pause
        exit /b 1
    )
    git push -u origin main
    if errorlevel 1 goto :fatal
)

echo [7/9] Verification de la Release %TAG%...
>>"%LOG%" echo [7/9] Verification de la Release %TAG%
gh release view "%TAG%" --repo "%REPO%" >nul 2>nul

if errorlevel 1 (
    echo Release absente : creation en cours...
    >>"%LOG%" echo Creation de la Release %TAG%.
    gh release create "%TAG%" "!EXE!" --repo "%REPO%" --target main --title "%TITLE%" --notes "Version V6 complete de Madrador Remote." --latest
    if errorlevel 1 goto :release_error
) else (
    echo Release existante : remplacement de l'installateur...
    >>"%LOG%" echo Mise a jour de la Release %TAG%.
    gh release upload "%TAG%" "!EXE!" --repo "%REPO%" --clobber
    if errorlevel 1 goto :release_error
)

echo [8/9] Verification de la publication...
>>"%LOG%" echo [8/9] Verification de la Release
gh release view "%TAG%" --repo "%REPO%"
if errorlevel 1 goto :release_error

echo [9/9] Ouverture de la page GitHub Releases...
>>"%LOG%" echo [9/9] Ouverture de la Release
gh release view "%TAG%" --repo "%REPO%" --web

echo.
echo ============================================================
echo             PUBLICATION TERMINEE AVEC SUCCES
echo ============================================================
echo.
echo Code source publie sur :
echo https://github.com/%REPO%
echo.
echo Installateur publie dans la Release :
echo %TAG%
echo.
echo Fichier local :
echo !EXE!
echo.
>>"%LOG%" echo [SUCCES] Code et installateur publies.
pause
exit /b 0

:release_error
echo.
echo [ERREUR] Le code source a ete publie, mais la Release a echoue.
echo Consulte le rapport :
echo %LOG%
>>"%LOG%" echo [ERREUR] Publication de la Release echouee.
pause
exit /b 2

:fatal
echo.
echo [ERREUR] Une etape obligatoire a echoue.
echo Consulte le rapport :
echo %LOG%
>>"%LOG%" echo [ERREUR] Echec obligatoire. Code : %errorlevel%
pause
exit /b 1

:check_tool
where %~1 >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] %~2 n'est pas installe ou n'est pas accessible.
    >>"%LOG%" echo [ERREUR] %~2 introuvable.
    exit /b 1
)
exit /b 0
