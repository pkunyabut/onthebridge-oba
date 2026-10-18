@echo off
rem Double-click to start OBA on Windows (needs Node.js 20.12 or newer on the PATH)
cd /d "%~dp0"
node src/server.mjs
echo.
echo The server stopped (exit code %errorlevel%).
pause
