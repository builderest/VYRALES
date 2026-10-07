@echo off
rem Abre el puerto 8188 de ComfyUI SOLO para la red de Tailscale (100.64.0.0/10).
rem Ejecutar UNA vez como administrador (clic derecho -> Ejecutar como administrador).
net session >nul 2>&1
if errorlevel 1 (
  echo Este archivo necesita permisos de administrador.
  echo Clic derecho sobre el archivo -^> "Ejecutar como administrador".
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="ComfyUI VYRALES (Tailscale)" >nul 2>&1
netsh advfirewall firewall add rule name="ComfyUI VYRALES (Tailscale)" dir=in action=allow protocol=TCP localport=8188 remoteip=100.64.0.0/10
if errorlevel 1 (echo No se pudo crear la regla.) else (echo Listo: puerto 8188 abierto solo para tus aparatos de Tailscale.)
pause
