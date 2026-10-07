' Arranca ComfyUI para VYRALES sin ventana (lo usa la tarea de Windows al iniciar sesion).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\INICIAR_COMFYUI_PARA_VYRALES.bat"" /oculto", 0, False
