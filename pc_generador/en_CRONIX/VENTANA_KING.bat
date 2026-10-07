@echo off
setlocal
title VYRALES -> PC king (generador de video)
set "KING=http://100.66.84.73:8188"
rem (Si cambia la IP de king en Tailscale, cambiala en la linea de arriba.)
:menu
cls
echo ==========================================================
echo   VYRALES  -^>  PC king  (%KING%)
echo ==========================================================
echo   1. Probar conexion (ver tarjeta de video y memoria)
echo   2. Ver la cola de ComfyUI (que esta generando)
echo   3. Ver los ultimos trabajos terminados
echo   4. Abrir ComfyUI de king en el navegador
echo   5. Probar Tailscale (ping a king)
echo   0. Salir
echo.
set "op="
set /p "op=Elige una opcion: "
if "%op%"=="1" goto stats
if "%op%"=="2" goto cola
if "%op%"=="3" goto hist
if "%op%"=="4" start "" "%KING%" & goto menu
if "%op%"=="5" goto ping
if "%op%"=="0" exit /b 0
goto menu
:stats
echo.
curl -s -m 8 "%KING%/system_stats"
if errorlevel 1 echo [NO RESPONDE] Revisa: Tailscale encendido en las dos PCs, INSTALAR_EN_KING.bat ejecutado en king.
echo.
pause
goto menu
:cola
echo.
curl -s -m 8 "%KING%/queue"
echo.
pause
goto menu
:hist
echo.
curl -s -m 8 "%KING%/history?max_items=3"
echo.
pause
goto menu
:ping
echo.
ping -n 3 100.66.84.73
pause
goto menu
