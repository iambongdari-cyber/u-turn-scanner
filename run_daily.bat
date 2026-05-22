@echo off
chcp 65001 >nul
cd /d C:\Users\iambo\dev\u-turn-scanner

echo ============================================
echo  U-Turn Scanner - Run
echo  Start: %date% %time%
echo ============================================
echo.

echo [1/9] Refreshing stock master (new listings)...
".venv\Scripts\python.exe" scripts\load_stocks.py --market ALL --stocks-only
if errorlevel 1 (
    echo.
    echo [WARN] Stock master refresh failed. Continuing with existing master.
)
echo.

echo [2/9] Updating daily prices...
".venv\Scripts\python.exe" scripts\load_stocks.py --market ALL --prices-only --days 15
if errorlevel 1 (
    echo.
    echo [ERROR] Price update step failed.
    pause
    goto :end
)
echo.

echo [3/9] Updating market indices...
".venv\Scripts\python.exe" scripts\load_indices.py
if errorlevel 1 (
    echo.
    echo [ERROR] Market indices update failed.
    pause
    goto :end
)
echo.

echo [4/9] Updating news risks (DART disclosures, last 30 days)...
".venv\Scripts\python.exe" scripts\load_news_risks.py
if errorlevel 1 (
    echo.
    echo [ERROR] News risks update failed.
    pause
    goto :end
)
echo.

echo [5/9] Running DAILY scan...
".venv\Scripts\python.exe" scripts\run_scan.py --report-type daily
if errorlevel 1 (
    echo.
    echo [ERROR] Daily scan failed.
    pause
    goto :end
)
echo.

echo [6/9] Running WEEKLY scan...
".venv\Scripts\python.exe" scripts\run_scan.py --report-type weekly
if errorlevel 1 (
    echo.
    echo [ERROR] Weekly scan failed.
    pause
    goto :end
)
echo.

echo [7/9] Updating backtest results (open positions, new reports)...
".venv\Scripts\python.exe" scripts\run_backtest.py
if errorlevel 1 (
    echo.
    echo [WARN] Backtest update failed. Continuing.
)
echo.

echo [8/9] Generating alerts (new CRITICAL / new TOP / interest stocks)...
".venv\Scripts\python.exe" scripts\generate_alerts.py
if errorlevel 1 (
    echo.
    echo [WARN] Alert generation failed. Continuing.
)
echo.

echo [9/9] Starting web server and opening browser...
start "U-Turn Web Server" cmd /k "cd /d C:\Users\iambo\dev\u-turn-scanner && npm run dev"
echo Waiting for server to start...
timeout /t 12 /nobreak >nul
start "" http://localhost:3000
echo.

echo ============================================
echo  Done: %date% %time%
echo  - Stock master refreshed (new listings included)
echo  - Daily prices + market indices updated
echo  - News risks refreshed (CRITICAL auto-excluded)
echo  - Reports updated (daily + weekly)
echo  - Backtest re-evaluated (open positions)
echo  - Alerts generated (see alerts.log + /alerts page)
echo  - Web server running in a separate window
echo  - Browser opened at http://localhost:3000
echo.
echo  Close the "U-Turn Web Server" window when finished.
echo ============================================
echo.
pause

:end
