@echo off
setlocal enableextensions enabledelayedexpansion

set "REPO_DIR=%~dp0"
set "ACTION_EXIT_CODE=0"
pushd "%REPO_DIR%" >nul
if errorlevel 1 (
  echo Failed to open the repo directory: "%REPO_DIR%"
  goto end
)

:menu
cls
echo ==========================================
echo  Twitch Song Request Player Release Menu
echo ==========================================
echo.
echo  1. Build EXE for testing only
echo  2. Release patch version and push to GitHub
echo  3. Release minor version and push to GitHub
echo  4. Release major version and push to GitHub
echo  5. Release explicit version and push to GitHub
echo  6. Dry-run next patch release
echo  Q. Quit
echo.
echo Test builds do not modify CHANGELOG.md.
echo CHANGELOG.md is only rolled into a version section during a real release.
echo.
set /p "choice=Choose an option: "

if /i "%choice%"=="1" goto build_only
if /i "%choice%"=="2" goto release_patch
if /i "%choice%"=="3" goto release_minor
if /i "%choice%"=="4" goto release_major
if /i "%choice%"=="5" goto release_explicit
if /i "%choice%"=="6" goto release_dry_run
if /i "%choice%"=="q" goto end

echo.
echo Invalid choice.
pause
goto menu

:build_only
echo.
echo Building EXE for testing. This will not change the version or changelog.
call :run_npm run build:exe
set "ACTION_EXIT_CODE=%errorlevel%"
goto done

:release_patch
call :confirm_release "patch"
if errorlevel 1 goto menu
call :run_npm run release -- patch
set "ACTION_EXIT_CODE=%errorlevel%"
goto done

:release_minor
call :confirm_release "minor"
if errorlevel 1 goto menu
call :run_npm run release -- minor
set "ACTION_EXIT_CODE=%errorlevel%"
goto done

:release_major
call :confirm_release "major"
if errorlevel 1 goto menu
call :run_npm run release -- major
set "ACTION_EXIT_CODE=%errorlevel%"
goto done

:release_explicit
echo.
set /p "explicit_version=Enter the exact version to release (for example 1.2.0): "
if "%explicit_version%"=="" (
  echo No version entered.
  pause
  goto menu
)
call :confirm_release "%explicit_version%"
if errorlevel 1 goto menu
call :run_npm run release -- %explicit_version%
set "ACTION_EXIT_CODE=%errorlevel%"
goto done

:release_dry_run
echo.
echo Running a dry-run preview for the next patch release.
call :run_npm run release -- patch --dry-run
set "ACTION_EXIT_CODE=%errorlevel%"
goto done

:confirm_release
echo.
echo This will bump version %~1, roll the unreleased changelog, build the EXE,
echo create the Git tag, push to GitHub, and publish the release.
set /p "confirm=Continue? (y/N): "
if /i not "%confirm%"=="y" exit /b 1
exit /b 0

:run_npm
call npm %*
exit /b %errorlevel%

:done
echo.
if not "%ACTION_EXIT_CODE%"=="0" (
  echo Action failed.
) else (
  echo Action finished.
)
echo.
if defined RELEASE_MENU_NO_PAUSE goto end
pause
goto menu

:end
popd >nul 2>&1
endlocal
