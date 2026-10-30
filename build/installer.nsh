; Instalador guiado: mostra o que esta sendo feito, em portugues, sem pedir administrador.

; Ao definir customCheckAppRunning o electron-builder deixa de incluir estes dois itens; sao necessarios
; para a checagem padrao de "app aberto" continuar funcionando (instalador e desinstalador)
!include "getProcessInfo.nsh"
Var pid

!macro customHeader
  ; Deixa a lista de arquivos copiados visivel durante a instalacao
  ShowInstDetails show
  ShowUninstDetails show
!macroend

!macro customInstallMode
  ; Sempre instala so para o usuario atual (sem pergunta de "todos os usuarios" e sem administrador)
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customWelcomePage
  ; Nao avanca sozinho ao terminar: a pessoa le a lista e clica em Avancar
  !define MUI_FINISHPAGE_NOAUTOCLOSE
  !define MUI_UNFINISHPAGE_NOAUTOCLOSE
  !define MUI_WELCOMEPAGE_TITLE "Instalar o DZ Toolkit"
  !define MUI_WELCOMEPAGE_TEXT "Este assistente vai instalar o DZ Toolkit no seu computador.$\r$\n$\r$\nO que o app faz: Auto Run, Cliques Automáticos e Monitor de Servidor para o DayZ.$\r$\n$\r$\nO que a instalação faz: copia os arquivos do app para a pasta que você escolher e cria um atalho no Menu Iniciar e na Área de Trabalho. Não pede administrador e não altera nada fora disso.$\r$\n$\r$\nO app não grava o que você digita, não mexe na memória do jogo e não tem telemetria. O código é aberto (licença MIT).$\r$\n$\r$\nClique em Avançar para continuar."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstall
  ; O instalador padrao esconde a lista de detalhes; aqui mostramos o que foi feito
  SetDetailsPrint both
  DetailPrint "Arquivos do app copiados para: $INSTDIR"
  FindFirst $0 $1 "$INSTDIR\*.*"
  loop_listar:
    StrCmp $1 "" fim_listar
    StrCmp $1 "." proximo_listar
    StrCmp $1 ".." proximo_listar
    DetailPrint "  $1"
    proximo_listar:
    FindNext $0 $1
    Goto loop_listar
  fim_listar:
  FindClose $0
  DetailPrint "Atalho criado no Menu Iniciar e na Área de Trabalho"
  DetailPrint "Desinstalador registrado em Configurações > Aplicativos (somente para o seu usuário)"
  DetailPrint "Instalação concluída."
!macroend

!macro customCheckAppRunning
  ; Roda antes de copiar os arquivos: liga a lista de detalhes ja no inicio da instalacao
  !ifndef BUILD_UNINSTALLER
    SetDetailsPrint both
    DetailPrint "Pasta de instalação: $INSTDIR"
    DetailPrint "Verificando se o DZ Toolkit está aberto..."
  !endif
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
    DetailPrint "Removendo versão anterior, se houver..."
  !endif
!macroend
