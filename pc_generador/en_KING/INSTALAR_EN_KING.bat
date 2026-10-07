@echo off
setlocal
title Instalar generador de VYRALES en esta PC
rem UNA SOLA VEZ, como administrador. Despues no hay que volver a tocar esta PC:
rem   1. Abre el puerto 8188 SOLO para tus aparatos de Tailscale (100.64.0.0/10).
rem   2. Encuentra la carpeta de ComfyUI (te la pide si no la encuentra).
rem   3. Crea una tarea de Windows: al iniciar sesion arranca ComfyUI oculto, escuchando
rem      solo en la IP de Tailscale, y si se cierra vuelve a arrancar solo.
net session >nul 2>&1
if errorlevel 1 (
  echo Clic derecho sobre este archivo -^> "Ejecutar como administrador".
  pause
  exit /b 1
)
echo [1/3] Firewall: puerto 8188 solo para Tailscale...
netsh advfirewall firewall delete rule name="ComfyUI VYRALES (Tailscale)" >nul 2>&1
netsh advfirewall firewall add rule name="ComfyUI VYRALES (Tailscale)" dir=in action=allow protocol=TCP localport=8188 remoteip=100.64.0.0/10 >nul
echo [2/3] Buscando ComfyUI...
call "%~dp0INICIAR_COMFYUI_PARA_VYRALES.bat" /solo_ruta
if errorlevel 1 (echo No se pudo configurar ComfyUI. & pause & exit /b 1)
echo [3/3] Arranque automatico al iniciar Windows...
schtasks /create /tn "VYRALES ComfyUI" /tr "wscript.exe \"%~dp0iniciar_oculto.vbs\"" /sc onlogon /rl highest /f >nul
if errorlevel 1 (echo No se pudo crear la tarea. & pause & exit /b 1)
wscript.exe "%~dp0iniciar_oculto.vbs"
echo.
echo LISTO. ComfyUI ya arranco en segundo plano y lo hara solo cada vez que prendas esta PC.
echo Log: %~dp0comfyui.log
echo Ya no hace falta tocar esta PC: VYRALES la usa desde Cronix por Tailscale.
pause
