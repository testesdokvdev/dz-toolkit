# Desenvolvimento

## Comandos

```bash
npm install
npm start          # abre o app
npm run dist       # gera o instalador em dist/
npm run icon       # regenera src/assets/icon.png
```

Publicação de versões: veja [PUBLICAR.md](PUBLICAR.md).

## Idiomas

Para corrigir uma tradução ou acrescentar um idioma, edite ou copie um arquivo de `src/locales/` (os textos são
iguais em todos, com `{parametros}` que não devem ser traduzidos) e inclua o código em `CODES` de
`src/main/i18n.js`. As novidades de cada versão vêm das Releases e aparecem no idioma em que foram escritas.

## Estrutura

```
src/main/      processo principal
  main.js        janela, IPC e eventos
  toolkit.js     estado e lógica das ferramentas
  win32.js       API do Windows (janelas, foco, SendInput)
  a2s.js         consulta Steam A2S do monitor de servidor
  updater.js     atualização automática pelas Releases do GitHub (electron-updater)
  datadir.js     pasta de dados (mantém %APPDATA%\DayZ Toolkit de quem já usa, apesar do nome novo)
  settings.js    preferências salvas
  i18n.js        idiomas (carrega src/locales e traduz os avisos)
  toast.js       aviso flutuante no canto da tela
  overlay.js     relógio do jogo na tela
  mapview.js     mapas (iZurvive e Nasdara Map) presos à janela principal
  appaudio.js    captura o som de um programa só (o DZ), via WASAPI por processo
  gameversion.js versão do DZ instalado (para comparar com a do servidor)
src/shared/      lógica compartilhada: ciclo dia/noite, decodificador de morse do rádio, bunkers da Nasdara
src/preload.js   ponte segura com a interface
src/renderer/    interface (HTML/CSS/JS)
src/locales/     textos de cada idioma (um JSON por idioma)
```
