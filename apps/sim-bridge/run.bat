@echo off
cd /d "%~dp0"
echo Starting FlightCareer SimBridge...
dotnet run --project SimBridge.csproj
pause
