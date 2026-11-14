@echo off
rem ---------------------------------------------------------------------------
rem  DnsConf UI - one-click start for Windows.
rem
rem  Just double-click this file.
rem
rem  It builds and starts the app with Docker. There is nothing to fill in.
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

rem --- 2. build and run -------------------------------------------------------
rem .env is optional and carries nothing but HOST_PORT, so there is no file to create here: without one the app
rem serves on 3000, which is what the default below says.
set "HOST_PORT="
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"HOST_PORT=" ".env" 2^>nul`) do set "HOST_PORT=%%B"
rem Stripped only when there is something to strip: `!VAR: =!` on an unset variable expands to a literal " =",
rem which the line below would then take for a port and print in the address.
if defined HOST_PORT set "HOST_PORT=!HOST_PORT: =!"
if not defined HOST_PORT set "HOST_PORT=3000"

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
