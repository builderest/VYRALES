@echo off
title Quitar agente VYRALES
schtasks /delete /tn "VYRALES Agente" /f
rem Cierra el agente que esta corriendo ahora (bucle + node del agente).
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*agente_bucle.bat*' -or $_.CommandLine -like '*agente\agente.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" > nul 2>&1
echo Agente quitado: ya no arranca solo y se cerro el que estaba corriendo.
pause
