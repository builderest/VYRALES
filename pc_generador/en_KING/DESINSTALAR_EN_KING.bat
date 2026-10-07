@echo off
schtasks /delete /tn "VYRALES ComfyUI" /f
netsh advfirewall firewall delete rule name="ComfyUI VYRALES (Tailscale)"
echo Quitado. (Si ComfyUI sigue abierto, cierralo desde el Administrador de tareas: python.exe)
pause
