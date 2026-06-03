@echo off
chcp 65001 >nul
setlocal

REM Work in the project root (where this batch lives)
cd /d "%~dp0"

echo ============================================
echo  U-Turn Scanner Sidecar
echo  Start: %date% %time%
echo ============================================
echo.
echo This batch runs sidecar scripts only.
echo It does not modify run_daily.bat.
echo If one step fails, the next step continues.
echo Output: logs\sidecar\
echo.

REM Create output folders if missing
if not exist "logs" mkdir "logs"
if not exist "logs\sidecar" mkdir "logs\sidecar"

set "PY=.venv\Scripts\python.exe"
set "SCAN_STATE=not-run"
set "SECTOR_STATE=not-run"
set "ARCHIVE_STATE=not-run"

echo [1/3] scan_dump.py
"%PY%" scripts\scan_dump.py
if errorlevel 1 (
    echo.
    echo [WARN] scan_dump.py failed. Continue to sector_dump.py.
    set "SCAN_STATE=failed-continue"
) else (
    set "SCAN_STATE=ok"
)
echo.

echo [2/3] sector_dump.py
"%PY%" scripts\sector_dump.py
if errorlevel 1 (
    echo.
    echo [WARN] sector_dump.py failed. Continue to archive_sidecar.py.
    set "SECTOR_STATE=failed-continue"
) else (
    set "SECTOR_STATE=ok"
)
echo.

echo [3/3] archive_sidecar.py
"%PY%" scripts\archive_sidecar.py
if errorlevel 1 (
    echo.
    echo [WARN] archive_sidecar.py failed. Continue to final file check.
    set "ARCHIVE_STATE=failed-continue"
) else (
    set "ARCHIVE_STATE=ok"
)
echo.

echo ============================================
echo  Final file check
echo ============================================
if exist "logs\sidecar\scan_dump_latest.json" (
    echo   scan_dump_latest.json   : exists
) else (
    echo   scan_dump_latest.json   : missing
)
if exist "logs\sidecar\sector_dump_latest.json" (
    echo   sector_dump_latest.json : exists
) else (
    echo   sector_dump_latest.json : missing
)
echo.

echo ============================================
echo  Done: %date% %time%
echo  - scan_dump       : %SCAN_STATE%
echo  - sector_dump     : %SECTOR_STATE%
echo  - archive_sidecar : %ARCHIVE_STATE%
echo  - Output dir      : logs\sidecar\ (daily snapshots in logs\sidecar\daily\)
echo ============================================
echo.
echo This batch is independent of run_daily.bat.
echo Web screens fall back gracefully if JSON is missing.
echo You can re-run this batch anytime.
echo.
echo Done. Press any key to exit.
pause >nul

endlocal
