@echo off
setlocal

echo Building frontend...
cd frontend
call npm run build
cd ..

echo Building backend...
cd backend
call npm run build
cd ..

echo Building Docker image...
docker build -t peerlink .

echo Build process completed!

endlocal
