@echo off
rem Double-click to start OBA on Windows (needs Node.js 22 or newer on the PATH)
cd /d "%~dp0"
node src/server.mjs
echo.
echo The server stopped (exit code %errorlevel%).
pause
