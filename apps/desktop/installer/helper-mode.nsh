; Custom NSIS page: helper LLM mode for DSH Desktop.
; Modes: cloud (online API) | local (on-device sidecar) | off (helpers disabled).

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var HelperDialog
Var HelperRadioCloud
Var HelperRadioLocal
Var HelperRadioOff
Var HelperMode

!macro customInit
  StrCpy $HelperMode "cloud"
!macroend

Function HelperModePage
  !insertmacro MUI_HEADER_TEXT "Helper model" "Choose how draft optimize / compaction helpers run"
  nsDialogs::Create 1018
  Pop $HelperDialog
  ${If} $HelperDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 36u "Helpers clean drafts and summarize long context. They are separate from the main chat model."
  Pop $0

  ${NSD_CreateRadioButton} 10 48u 100% 16u "Online API (helpers follow Settings model; DeepSeek preset)"
  Pop $HelperRadioCloud
  ${NSD_CreateRadioButton} 10 72u 100% 16u "Local small model (OpenAI-compatible sidecar on this PC)"
  Pop $HelperRadioLocal
  ${NSD_CreateRadioButton} 10 96u 100% 16u "Disable helpers (chat only; no optimize / local-edge)"
  Pop $HelperRadioOff

  ${If} $HelperMode == "local"
    ${NSD_Check} $HelperRadioLocal
  ${ElseIf} $HelperMode == "off"
    ${NSD_Check} $HelperRadioOff
  ${Else}
    ${NSD_Check} $HelperRadioCloud
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function HelperModePageLeave
  ${NSD_GetState} $HelperRadioCloud $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $HelperMode "cloud"
  ${Else}
    ${NSD_GetState} $HelperRadioLocal $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $HelperMode "local"
    ${Else}
      StrCpy $HelperMode "off"
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro customPageAfterChangeDir
  Page custom HelperModePage HelperModePageLeave
!macroend

!macro customInstall
  CreateDirectory "$INSTDIR\resources"
  FileOpen $0 "$INSTDIR\resources\helper-mode.json" w
  FileWrite $0 '{"mode":"$HelperMode"}$\r$\n'
  FileClose $0
!macroend
