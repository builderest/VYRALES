@echo off
rem Bucle del agente: si se cierra o falla, vuelve a arrancar a los 10 s. Lo lanza
rem agente\iniciar_oculto.vbs (sin ventana) al iniciar sesion en Windows.
cd /d "%~dp0.."
:bucle
echo [%date% %time%] arrancando agente>> agente\agente.log
node agente\agente.js >> agente\agente.log 2>&1
timeout /t 10 /nobreak > nul
goto bucle
