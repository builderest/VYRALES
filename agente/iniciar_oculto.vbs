' Arranca el agente de VYRALES SIN ventana (lo usa la tarea programada al iniciar sesion).
Set sh = CreateObject("WScript.Shell")
carpeta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c """ & carpeta & "\agente_bucle.bat""", 0, False
