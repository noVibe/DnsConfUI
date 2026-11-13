@echo off
rem ---------------------------------------------------------------------------
rem  DnsConf UI - one-click start for Windows.
rem
rem  Just double-click this file.
rem
rem  It creates .env on first run, then builds and starts the app with
rem  Docker. Nothing has to be filled in: a GitHub Client ID is optional.
rem ---------------------------------------------------------------------------
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ===============================================
echo   DnsConf UI - starting with Docker
echo ===============================================
echo.

rem --- 1. is Docker there and running? ---------------------------------------
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker is not installed.
  echo.
  echo Install Docker Desktop from:
  echo   https://www.docker.com/products/docker-desktop/
  echo.
  echo Then run this file again.
  goto :fail
)

docker info >nul 2>nul
if errorlevel 1 (
  echo Docker is installed but not running.
  echo.
  echo Start Docker Desktop, wait until it reports "running",
  echo then run this file again.
  goto :fail
)

set "COMPOSE=docker compose"
docker compose version >nul 2>nul
if errorlevel 1 set "COMPOSE=docker-compose"

rem --- 2. make sure .env exists ----------------------------------------------
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env from .env.example
)

rem --- 3. the Client ID is optional ------------------------------------------
set "CLIENT_ID="
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"NEXT_PUBLIC_GITHUB_CLIENT_ID=" ".env"`) do set "CLIENT_ID=%%B"

if "!CLIENT_ID!"=="" (
  echo.
  echo No GitHub Client ID in .env - the project's shared GitHub app will be used.
  echo Nothing else to do. If you would rather use your own OAuth App later:
  echo   1. open https://github.com/settings/developers
  echo   2. New OAuth App  -^>  any name, homepage http://localhost:3000
  echo   3. after creating it, tick "Enable Device Flow" and save
  echo   4. put the Client ID into NEXT_PUBLIC_GITHUB_CLIENT_ID in .env
  echo   5. run this file again
  echo.
)

rem --- 4. build and run -------------------------------------------------------
set "HOST_PORT="
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"HOST_PORT=" ".env"`) do set "HOST_PORT=%%B"
set "HOST_PORT=!HOST_PORT: =!"
if "!HOST_PORT!"=="" set "HOST_PORT=3000"

echo.
echo Building and starting DnsConf UI...
echo The very first build downloads and compiles things - a few minutes is normal.
echo.

%COMPOSE% up --build -d
if errorlevel 1 (
  echo.
  echo Startup failed. The output above says why.
  echo Full log:  %COMPOSE% logs
  goto :fail
)

echo.
echo ===============================================
echo   DnsConf UI is running:
echo   http://localhost:!HOST_PORT!
echo ===============================================
echo.
echo   show logs:  %COMPOSE% logs -f
echo   stop:       %COMPOSE% down
echo.
start "" "http://localhost:!HOST_PORT!"
pause
exit /b 0

:fail
echo.
pause
exit /b 1
