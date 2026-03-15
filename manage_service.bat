@echo off
setlocal EnableDelayedExpansion

:: ============================================================================
::  NXVNC Service Manager
::  Installs, removes, starts, and stops the NXVNC Windows Service via NSSM.
:: ============================================================================

set "SERVICE_NAME=NXVNC"
set "SERVICE_DISPLAY=NXVNC Remote Desktop"
set "SERVICE_DESC=Web-based remote desktop client. Provides VNC access through a web browser."
set "SCRIPT_DIR=%~dp0"

:: ── Locate NSSM ─────────────────────────────────────────────────────────────
:: Check local directory, then PATH
if exist "%SCRIPT_DIR%nssm.exe" (
    set "NSSM_EXE=%SCRIPT_DIR%nssm.exe"
) else (
    where nssm.exe >nul 2>&1
    if !errorlevel! equ 0 (
        for /f "delims=" %%i in ('where nssm.exe') do set "NSSM_EXE=%%i"
    ) else (
        echo ERROR: nssm.exe not found.
        echo Place nssm.exe in %SCRIPT_DIR% or add it to your PATH.
        echo Download from https://nssm.cc/
        pause
        exit /b 1
    )
)
echo Using NSSM: %NSSM_EXE%

:: ── Check Admin ──────────────────────────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -ArgumentList '%1' -Verb RunAs"
    exit /b
)

:: ── Command Dispatch ─────────────────────────────────────────────────────────
if "%1"=="" goto :menu
if /i "%1"=="install" goto :install
if /i "%1"=="remove" goto :remove
if /i "%1"=="uninstall" goto :remove
if /i "%1"=="start" goto :start
if /i "%1"=="stop" goto :stop
if /i "%1"=="restart" goto :restart
if /i "%1"=="status" goto :status
echo Unknown command: %1
goto :menu

:: ── Interactive Menu ─────────────────────────────────────────────────────────
:menu
echo.
echo ===================================================
echo   %SERVICE_DISPLAY% - Service Manager
echo ===================================================
echo.
echo   1. Install service
echo   2. Remove service
echo   3. Start service
echo   4. Stop service
echo   5. Restart service
echo   6. Show status
echo   7. Exit
echo.
set /p "choice=Select option: "
if "%choice%"=="1" goto :install
if "%choice%"=="2" goto :remove
if "%choice%"=="3" goto :start
if "%choice%"=="4" goto :stop
if "%choice%"=="5" goto :restart
if "%choice%"=="6" goto :status
if "%choice%"=="7" exit /b 0
echo Invalid choice.
goto :menu

:: ── Install ──────────────────────────────────────────────────────────────────
:install
echo.
echo Installing %SERVICE_DISPLAY%...

:: Check if already installed
sc query %SERVICE_NAME% >nul 2>&1
if %errorlevel% equ 0 (
    echo Service is already installed. Remove it first to reinstall.
    goto :done
)

:: Determine application to run
if exist "%SCRIPT_DIR%NXVNCSvc.exe" (
    echo Using compiled binary: NXVNCSvc.exe
    "%NSSM_EXE%" install %SERVICE_NAME% "%SCRIPT_DIR%NXVNCSvc.exe"
) else (
    echo Using Node.js: node service_runner.js
    :: Find node.exe
    where node.exe >nul 2>&1
    if !errorlevel! neq 0 (
        echo ERROR: node.exe not found in PATH.
        echo Install Node.js or build NXVNCSvc.exe with pkg.
        goto :done
    )
    for /f "delims=" %%i in ('where node.exe') do set "NODE_EXE=%%i"
    "%NSSM_EXE%" install %SERVICE_NAME% "!NODE_EXE!" "service_runner.js"
    "%NSSM_EXE%" set %SERVICE_NAME% AppDirectory "%SCRIPT_DIR%"
)

:: Display name and description
"%NSSM_EXE%" set %SERVICE_NAME% DisplayName "%SERVICE_DISPLAY%"
"%NSSM_EXE%" set %SERVICE_NAME% Description "%SERVICE_DESC%"

:: Auto-start
"%NSSM_EXE%" set %SERVICE_NAME% Start SERVICE_AUTO_START

:: Log rotation: stdout and stderr to service.log
"%NSSM_EXE%" set %SERVICE_NAME% AppStdout "%SCRIPT_DIR%service.log"
"%NSSM_EXE%" set %SERVICE_NAME% AppStderr "%SCRIPT_DIR%service.log"
"%NSSM_EXE%" set %SERVICE_NAME% AppStdoutCreationDisposition 4
"%NSSM_EXE%" set %SERVICE_NAME% AppStderrCreationDisposition 4
"%NSSM_EXE%" set %SERVICE_NAME% AppRotateFiles 1
"%NSSM_EXE%" set %SERVICE_NAME% AppRotateOnline 1
"%NSSM_EXE%" set %SERVICE_NAME% AppRotateBytes 10485760
"%NSSM_EXE%" set %SERVICE_NAME% AppRotateFiles 3
"%NSSM_EXE%" set %SERVICE_NAME% AppNoConsole 1

:: Graceful shutdown
"%NSSM_EXE%" set %SERVICE_NAME% AppStopMethodSkip 0
"%NSSM_EXE%" set %SERVICE_NAME% AppStopMethodConsole 5000
"%NSSM_EXE%" set %SERVICE_NAME% AppStopMethodWindow 5000
"%NSSM_EXE%" set %SERVICE_NAME% AppStopMethodThreads 5000

echo.
echo Service installed successfully.
echo Run 'manage_service.bat start' to start it.
goto :done

:: ── Remove ───────────────────────────────────────────────────────────────────
:remove
echo.
echo Removing %SERVICE_DISPLAY%...

:: Stop first if running
sc query %SERVICE_NAME% 2>nul | find "RUNNING" >nul
if %errorlevel% equ 0 (
    echo Stopping service first...
    "%NSSM_EXE%" stop %SERVICE_NAME%
    timeout /t 3 /nobreak >nul
)

"%NSSM_EXE%" remove %SERVICE_NAME% confirm
echo Service removed.
goto :done

:: ── Start ────────────────────────────────────────────────────────────────────
:start
echo Starting %SERVICE_DISPLAY%...
"%NSSM_EXE%" start %SERVICE_NAME%
goto :done

:: ── Stop ─────────────────────────────────────────────────────────────────────
:stop
echo Stopping %SERVICE_DISPLAY%...
"%NSSM_EXE%" stop %SERVICE_NAME%
goto :done

:: ── Restart ──────────────────────────────────────────────────────────────────
:restart
echo Restarting %SERVICE_DISPLAY%...
"%NSSM_EXE%" restart %SERVICE_NAME%
goto :done

:: ── Status ───────────────────────────────────────────────────────────────────
:status
echo.
"%NSSM_EXE%" status %SERVICE_NAME%
echo.
sc query %SERVICE_NAME%
goto :done

:: ── Done ─────────────────────────────────────────────────────────────────────
:done
echo.
if "%1"=="" pause
exit /b 0
