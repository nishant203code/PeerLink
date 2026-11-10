@echo off
setlocal

pushd "%~dp0"
if errorlevel 1 exit /b 1

echo Building frontend, backend, and Docker image...
docker build -f dockerfile -t peerlink .
if errorlevel 1 (
    popd
    exit /b 1
)

echo Build process completed!
popd
endlocal
