@echo off
cd /d "%~dp0"

echo Jieyang Ceramic Sculpture
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js, then run this script again.
  pause
  exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm was not found. Enabling it with corepack...
  call corepack enable
  call corepack prepare pnpm@9 --activate
  where pnpm >nul 2>&1
  if errorlevel 1 (
    echo Failed to enable pnpm. Install it manually: npm install -g pnpm
    pause
    exit /b 1
  )
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call pnpm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

echo Starting the dev server...
echo Open the local URL printed by Vite. It is usually http://localhost:5173
echo.
call pnpm dev
if errorlevel 1 (
  echo.
  echo The dev server has exited.
  pause
  exit /b 1
)
