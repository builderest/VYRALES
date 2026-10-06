@echo off
title Instalar agente VYRALES (arranque automatico)
cd /d "%~dp0"
rem Crea una tarea de Windows que arranca el agente oculto cada vez que inicias sesion.
schtasks /create /tn "VYRALES Agente" /tr "wscript.exe \"%~dp0agente\iniciar_oculto.vbs\"" /sc onlogon /rl limited /f
if errorlevel 1 (
  echo.
  echo No se pudo crear la tarea. Haz clic derecho en este archivo y elige "Ejecutar como administrador".
  pause
  exit /b 1
)
rem Lo arranca ya mismo, sin esperar a reiniciar.
wscript.exe "%~dp0agente\iniciar_oculto.vbs"
echo.
echo Listo: el agente queda corriendo en segundo plano y arrancara solo cada vez que inicies sesion.
echo Su registro esta en agente\agente.log. Para quitarlo: DESINSTALAR_AGENTE.bat
pause
