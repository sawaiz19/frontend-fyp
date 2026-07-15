@echo off
echo.
echo  ==========================================
echo   ChemTech Frontend Launcher
echo  ==========================================
echo.
echo  Starting local HTTP server on port 8080...
echo  Open: http://localhost:8080
echo.
echo  (Keep this window open while using the app)
echo  Press Ctrl+C to stop.
echo.
python -m http.server 8080
