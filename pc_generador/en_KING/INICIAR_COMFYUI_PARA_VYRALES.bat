@echo off
setlocal EnableDelayedExpansion
title ComfyUI para VYRALES (no cerrar)
rem Arranca ComfyUI escuchando SOLO en la IP de Tailscale de esta PC, puerto 8188.
rem La API de ComfyUI no tiene contrasena: por eso nunca se abre a 0.0.0.0 (todo tu Wi-Fi).

set "MODO=%~1"
rem --- IP de Tailscale (en modo oculto espera hasta que Tailscale conecte al iniciar Windows) ---
:esperar_ip
set "TSIP="
for /f "delims=" %%i in ('tailscale ip -4 2^>nul') do if not defined TSIP set "TSIP=%%i"
if not defined TSIP if exist "C:\Program Files\Tailscale\tailscale.exe" for /f "delims=" %%i in ('"C:\Program Files\Tailscale\tailscale.exe" ip -4 2^>nul') do if not defined TSIP set "TSIP=%%i"
if not defined TSIP if /i "%MODO%"=="/oculto" (timeout /t 15 /nobreak >nul & goto esperar_ip)
if not defined TSIP (
  echo No encontre la IP de Tailscale. Abre Tailscale, conectate y vuelve a intentar.
  pause
  exit /b 1
)

rem --- Carpeta de ComfyUI (se guarda la primera vez en comfyui_ruta.txt) ---
set "CFG=%~dp0comfyui_ruta.txt"
set "COMFY="
if exist "%CFG%" set /p COMFY=<"%CFG%"
if defined COMFY if not exist "!COMFY!" set "COMFY="
if not defined COMFY (
  for %%d in ("C:\ComfyUI\ComfyUI_windows_portable" "C:\ComfyUI_windows_portable" "D:\ComfyUI_windows_portable" "E:\ComfyUI_windows_portable" "%USERPROFILE%\Desktop\ComfyUI_windows_portable" "%USERPROFILE%\ComfyUI_windows_portable" "C:\ComfyUI" "D:\ComfyUI" "%USERPROFILE%\ComfyUI" "%USERPROFILE%\Documents\ComfyUI") do (
    if not defined COMFY if exist "%%~d\ComfyUI\main.py" set "COMFY=%%~d"
    if not defined COMFY if exist "%%~d\main.py" set "COMFY=%%~d"
  )
)
if not defined COMFY (
  echo No encontre ComfyUI. Arrastra aqui la carpeta de ComfyUI y presiona Enter:
  set /p "COMFY="
  set "COMFY=!COMFY:"=!"
)
if not exist "!COMFY!" (
  echo Esa carpeta no existe: !COMFY!
  pause
  exit /b 1
)
>"%CFG%" echo !COMFY!

rem --- Elegir python y main.py segun el tipo de instalacion ---
set "PY="
set "MAIN="
set "EXTRA="
if exist "!COMFY!\python_embeded\python.exe" if exist "!COMFY!\ComfyUI\main.py" (
  set "PY=!COMFY!\python_embeded\python.exe"
  set "MAIN=!COMFY!\ComfyUI\main.py"
  set "EXTRA=-s"
  set "WIN=--windows-standalone-build"
)
if not defined PY if exist "!COMFY!\main.py" (
  set "MAIN=!COMFY!\main.py"
  if exist "!COMFY!\venv\Scripts\python.exe" set "PY=!COMFY!\venv\Scripts\python.exe"
  if not defined PY if exist "!COMFY!\.venv\Scripts\python.exe" set "PY=!COMFY!\.venv\Scripts\python.exe"
  if not defined PY set "PY=python"
)
if not defined MAIN (
  echo En "!COMFY!" no hay main.py de ComfyUI.
  echo Si usas ComfyUI Desktop: en Settings -^> Server Config pon la direccion !TSIP! y el puerto 8188.
  del "%CFG%" >nul 2>&1
  pause
  exit /b 1
)

if /i "%MODO%"=="/solo_ruta" (echo Carpeta de ComfyUI: !COMFY! & exit /b 0)
if /i "%MODO%"=="/oculto" goto oculto
echo.
echo  ComfyUI para VYRALES
echo  Escuchando en: http://!TSIP!:8188  (solo tus aparatos de Tailscale)
echo  Deja esta ventana abierta mientras se generen videos.
echo.
"!PY!" !EXTRA! "!MAIN!" !WIN! --listen !TSIP! --port 8188
echo.
echo ComfyUI se cerro.
pause
exit /b 0

:oculto
rem Arranque automatico sin ventana: si ComfyUI se cierra o falla, vuelve a arrancar a los 15 s.
set "LOG=%~dp0comfyui.log"
:bucle
>>"%LOG%" echo [%date% %time%] arrancando ComfyUI en !TSIP!:8188
"!PY!" !EXTRA! "!MAIN!" !WIN! --listen !TSIP! --port 8188 >>"%LOG%" 2>&1
timeout /t 15 /nobreak >nul
goto bucle
