@echo off
setlocal
cd /d "%~dp0"

echo.
echo  ============================================================
echo    DigitalEdu - Build Offline EXE
echo  ============================================================
echo.

rem --- Check Python is available (use the system Python, NOT the portable one) ---
where python >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python not found in PATH.
    echo          Install Python 3.9+ from https://python.org
    echo          and make sure it is added to PATH.
    pause
    exit /b 1
)

rem --- Install PyInstaller if not already present ---
python -c "import PyInstaller" >nul 2>&1
if errorlevel 1 (
    echo  [setup] Installing PyInstaller...
    python -m pip install pyinstaller --quiet
    if errorlevel 1 (
        echo  [ERROR] Failed to install PyInstaller.
        pause
        exit /b 1
    )
)

rem --- Install project dependencies into the build Python ---
echo  [setup] Ensuring project dependencies are installed...
python -m pip install -r requirements.txt --quiet 2>nul

rem --- Build ---
echo  [build] Building DigitalEdu.exe ...
echo  [build] This may take several minutes for large bundles...
echo.
python -m PyInstaller digiEdu.spec --noconfirm --clean
if errorlevel 1 (
    echo.
    echo  [ERROR] Build failed. Check the output above.
    pause
    exit /b 1
)

rem --- Done ---
echo.
echo  ============================================================
echo    Build complete!
echo.
echo    Output: dist\DigitalEdu.exe
echo.
echo    Copy DigitalEdu.exe to any folder and double-click to run.
echo    First launch may take a few seconds to extract.
echo  ============================================================
echo.
pause
