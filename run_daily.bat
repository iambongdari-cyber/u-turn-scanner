@echo off
chcp 65001 >nul
cd /d C:\Users\iambo\dev\u-turn-scanner

set "PY=.venv\Scripts\python.exe"
set "LOGFILE=%~dp0logs\run_daily.log"

echo ============================================
echo  U-Turn Scanner - Run
echo  Start: %date% %time%
echo ============================================
echo.

"%PY%" scripts\run_logger.py start "%LOGFILE%"

echo [1/12] Refreshing stock master (new listings)...
"%PY%" scripts\load_stocks.py --market ALL --stocks-only
if errorlevel 1 (
    echo.
    echo [WARN] Stock master refresh failed. Continuing with existing master.
    echo   [1] 종목 마스터 갱신: 실패-계속진행>>"%LOGFILE%"
) else (
    echo   [1] 종목 마스터 갱신: 성공>>"%LOGFILE%"
)
echo.

echo [2/12] Updating daily prices (market-cap filtered + gap-fill)...
"%PY%" scripts\load_stocks.py --market ALL --prices-only --gap-fill --min-cap 800 --workers 8 --fast-ticker-index --log-file "%LOGFILE%"
if errorlevel 1 (
    echo.
    echo [ERROR] Price update step failed.
    "%PY%" scripts\run_logger.py fail "%LOGFILE%" "일봉 갱신" "일봉 수집 단계 실패 - 네트워크 또는 데이터 제공처 응답 이상일 수 있음"
    pause
    goto :end
)
echo   [2] 일봉 갱신: 성공>>"%LOGFILE%"
if exist "%~dp0logs\_price_cache.pkl" del /q "%~dp0logs\_price_cache.pkl"
echo.

echo [3/12] Updating market indices...
"%PY%" scripts\load_indices.py
if errorlevel 1 (
    echo.
    echo [ERROR] Market indices update failed.
    "%PY%" scripts\run_logger.py fail "%LOGFILE%" "시장 지수" "시장 지수 수집 실패"
    pause
    goto :end
)
echo   [3] 시장 지수: 성공>>"%LOGFILE%"
echo.

echo [4/12] Updating news risks (DART disclosures, last 30 days)...
"%PY%" scripts\load_news_risks.py
if errorlevel 1 (
    echo.
    echo [ERROR] News risks update failed.
    "%PY%" scripts\run_logger.py fail "%LOGFILE%" "뉴스 리스크" "DART 공시 수집 실패"
    pause
    goto :end
)
echo   [4] 뉴스 리스크: 성공>>"%LOGFILE%"
echo.

echo [5/12] Running DAILY scan...
"%PY%" scripts\run_scan.py --report-type daily --use-price-cache
if errorlevel 1 (
    echo.
    echo [ERROR] Daily scan failed.
    "%PY%" scripts\run_logger.py fail "%LOGFILE%" "일일 스캔" "일일 스캔 실패"
    pause
    goto :end
)
echo   [5] 일일 스캔: 성공>>"%LOGFILE%"
echo.

echo [6/12] Running WEEKLY scan...
"%PY%" scripts\run_scan.py --report-type weekly --use-price-cache
if errorlevel 1 (
    echo.
    echo [ERROR] Weekly scan failed.
    "%PY%" scripts\run_logger.py fail "%LOGFILE%" "주간 스캔" "주간 스캔 실패"
    pause
    goto :end
)
echo   [6] 주간 스캔: 성공>>"%LOGFILE%"
echo.

echo [7/12] scan_dump sidecar...
"%PY%" scripts\scan_dump.py
if errorlevel 1 (
    echo.
    echo [WARN] scan_dump sidecar failed. Continue to sector_dump.
    echo   [7] scan_dump sidecar: failed-continue>>"%LOGFILE%"
) else (
    echo   [7] scan_dump sidecar: ok>>"%LOGFILE%"
)
echo.

echo [8/12] sector_dump sidecar...
"%PY%" scripts\sector_dump.py
if errorlevel 1 (
    echo.
    echo [WARN] sector_dump sidecar failed. Continue to backtest.
    echo   [8] sector_dump sidecar: failed-continue>>"%LOGFILE%"
) else (
    echo   [8] sector_dump sidecar: ok>>"%LOGFILE%"
)
echo.

echo [9/12] archive sidecar snapshots (daily)...
"%PY%" scripts\archive_sidecar.py
if errorlevel 1 (
    echo.
    echo [WARN] archive_sidecar failed. Continue to backtest.
    echo   [9] archive sidecar: failed-continue>>"%LOGFILE%"
) else (
    echo   [9] archive sidecar: ok>>"%LOGFILE%"
)
echo.

echo [10/12] Updating backtest results (open positions, new reports)...
"%PY%" scripts\run_backtest.py
if errorlevel 1 (
    echo.
    echo [WARN] Backtest update failed. Continuing.
    echo   [10] 백테스트: 실패-계속진행>>"%LOGFILE%"
) else (
    echo   [10] 백테스트: 성공>>"%LOGFILE%"
)
echo.

echo [11/12] Generating alerts (new CRITICAL / new TOP / interest stocks)...
"%PY%" scripts\generate_alerts.py
if errorlevel 1 (
    echo.
    echo [WARN] Alert generation failed. Continuing.
    echo   [11] 알림 생성: 실패-계속진행>>"%LOGFILE%"
) else (
    echo   [11] 알림 생성: 성공>>"%LOGFILE%"
)
echo.

echo [12/12] Starting web server and opening browser...
start "U-Turn Web Server" cmd /k "cd /d C:\Users\iambo\dev\u-turn-scanner && npm run dev"
echo   [12] 웹 서버: 실행 시도>>"%LOGFILE%"
echo Waiting for server to start...
timeout /t 12 /nobreak >nul
start "" http://localhost:3000
echo.

"%PY%" scripts\run_logger.py done "%LOGFILE%"

echo ============================================
echo  Done: %date% %time%
echo  - Stock master refreshed (new listings included)
echo  - Daily prices updated (market-cap filtered + gap-fill)
echo  - Market indices updated
echo  - News risks refreshed (CRITICAL auto-excluded)
echo  - Reports updated (daily + weekly)
echo  - Sidecars generated (logs\sidecar\*.json) [scan_dump + sector_dump]
echo  - Sidecar daily snapshots archived (logs\sidecar\daily\*.json)
echo  - Backtest re-evaluated (open positions)
echo  - Alerts generated (see alerts.log + /alerts page)
echo  - Web server running in a separate window
echo  - Browser opened at http://localhost:3000
echo  - Run log: logs\run_daily.log
echo.
echo  Close the "U-Turn Web Server" window when finished.
echo ============================================
echo.
pause

:end
