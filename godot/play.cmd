@echo off
rem Pokrece Godot verziju igre. Dodaj -e za otvaranje u uredjivacu: play.cmd -e
set "GODOT=%LOCALAPPDATA%\Microsoft\WinGet\Packages\GodotEngine.GodotEngine_Microsoft.Winget.Source_8wekyb3d8bbwe\Godot_v4.7.2-stable_win64.exe"
if not exist "%GODOT%" (
  echo Godot 4.7.2 nije pronadjen. Instaliraj: winget install GodotEngine.GodotEngine
  pause
  exit /b 1
)
"%GODOT%" --path "%~dp0." %*
