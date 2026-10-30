# DayZ Toolkit

Ferramentas para DayZ em um app só: **Auto Run**, **Cliques Automáticos** e **Monitor de Servidor**.
Feito em Electron; teclado, mouse e janelas usam a API do Windows direto (via `koffi`).
Código aberto sob a licença [MIT](LICENSE).

## O que o app faz (e o que não faz)

| Ferramenta | O que faz |
|---|---|
| Auto Run | Segura Shift + W enquanto ativo e o DayZ estiver em foco |
| Cliques Automáticos | Segura o botão direito e clica o esquerdo repetidamente, só com o DayZ em foco |
| Monitor de Servidor | Quando o servidor cai, você não precisa ficar atualizando o DayZ Launcher: o app consulta o servidor (Steam A2S, UDP) e avisa com som e alerta na tela quando ele voltar. O "Status ao vivo" mostra a hora do jogo, a fila, os jogadores, o ping e se a versão do seu jogo bate com a do servidor |
| Relógio na tela | Mostra a hora do jogo, exatamente como o servidor informa, num canto da tela, por cima do DayZ em janela ou janela sem bordas. Não pega clique nem foco |
| Rádio Nasdara | Só para o mapa Nasdara (Badlands): escuta só o som do DayZ, decodifica o morse do rádio dos bunkers (80.0 MHz, de noite) e mostra a grade do mapa e o código da porta de cada bunker. Mostra ao vivo os bipes que está ouvindo e os dígitos que decifrou, avisa na tela quando um bunker é confirmado e abre a posição dele no mapa escolhido (iZurvive ou Nasdara Map) com um clique |
| Mapa | Mapas interativos dentro do app, com as marcações do próprio mapa: [iZurvive](https://www.izurvive.com/) ou [Nasdara Map](https://nasdaramap.com/), à sua escolha (um seletor na própria aba; a escolha fica salva) |

- **Não grava o que você digita.** Os atalhos são atalhos globais do Windows (`RegisterHotKey`): o app só é avisado
  das teclas que você escolheu, e só os registra com o DayZ em foco e a chave da ferramenta ligada. Não existe hook
  de teclado nem de mouse e nada é registrado ou guardado.
- **Não lê nem mexe na memória do jogo e não injeta código.** Só envia teclas e cliques como se fossem seus
  (`SendInput`) e lista as janelas abertas para achar a do DayZ.
- **Sem telemetria e sem conta.** A única rede usada é: a consulta UDP ao servidor que você configurar (e o DNS dele)
  e a checagem de atualização, que consulta a página de download (`dayz-toolkit.netlify.app/baixar`) a cada 2 horas
  só para ler a versão publicada. A aba Mapa só acessa a rede quando você a abre, e carrega apenas o site do mapa
  escolhido, o iZurvive ou o Nasdara Map (qualquer outro link abre no navegador). O app apenas avisa; você baixa e instala por conta própria. As preferências
  (inclusive qual mapa você escolheu) ficam num `settings.json` local.
- **Os mapas são sites de terceiros e seguem as práticas deles.** Cada um roda com sessão própria (cookies e armazenamento
  separados do resto do app e do outro mapa), e o app nega todos os pedidos de permissão deles (câmera, microfone, localização, captura de tela). O
  iZurvive exibe anúncios e carrega rastreadores de publicidade. O Nasdara Map não tem conta, anúncio nem cookie de
  rastreamento, mas, enquanto um mapa está aberto, conta visitantes (um identificador aleatório e o mapa aberto) e, se você
  usar os grupos opcionais, guarda as marcações compartilhadas num servidor dele (ver a
  [política de privacidade](https://nasdaramap.com/privacy)). Cada mapa só é carregado quando você o escolhe na aba; depois
  disso ele fica aberto, escondido, até você fechar o app.
- **O Rádio Nasdara só escuta, localmente, e só o DayZ.** Enquanto você está escutando, ele captura o som do
  processo do jogo (captura de áudio por processo do Windows 10/11, `ActivateAudioInterfaceAsync`), procura os
  bipes do morse e descarta o resto na hora. Nada do áudio é gravado nem enviado. Se o Windows não deixar isolar
  o jogo, o app avisa e cai para o som do PC todo (também só durante a escuta).
- **Escolha teclas que o DayZ não usa.** Enquanto a chave da ferramenta está ligada, a tecla do atalho é do app e
  **o jogo não a recebe** (o C, por exemplo, deixaria de agachar). Com a chave desligada, a tecla volta toda para o
  jogo. Por isso o padrão é F7 (Auto Run) e F8 (Cliques Automáticos); prefira F5 a F12 ou uma combinação com Ctrl
  ou Alt. O app avisa quando a tecla escolhida costuma ser usada pelo jogo. Duas ferramentas não podem usar a mesma
  tecla.

> Muitos servidores proíbem macros e qualquer automação de jogo, mesmo quando o BattlEye não bloqueia.
> Confira as regras do servidor antes de usar. O app mostra esse aviso toda vez que é aberto, e o uso é por sua conta e risco.

## Desenvolvimento

```bash
npm install
npm start          # abre o app
npm run dist       # gera o instalador em dist/
npm run icon       # regenera src/assets/icon.png
```

## Publicar uma versão nova

1. Suba a versão com `npm run bump`. Ele parte da versão do último commit (rodar de novo não sobe duas vezes) e
   segue o semver: **minor** quando há recurso novo (texto novo de interface em `src/locales/pt-BR.json` ou
   arquivo novo em `src/`), **patch** para correção ou ajuste. Para forçar: `npm run bump -- patch|minor|major`
   (major só para quebra de compatibilidade); `--dry-run` mostra a conta sem gravar. Ele também atualiza o
   `package-lock.json` e o `src/changelog.json`. Uma versão já publicada nunca se reaproveita: commite a
   anterior antes de começar a próxima.
2. Escreva as novidades em `build/release-notes.md` (português, também é o texto da Release no GitHub) e em
   `build/release-notes.en.md` (inglês): um item por linha, começando com `- `. O `npm run release` e o `npm run dist`
   geram `src/changelog.json` a partir delas, e o app mostra essa lista uma vez depois que o usuário atualiza
   (os outros idiomas veem o texto em inglês).
3. Rode `npm run release -- --dry-run`: gera o instalador e mostra o SHA256, sem publicar.
4. Ao fim do build, o script pergunta se deve rodar o [VirusTotal](https://www.virustotal.com) agora. Com a chave
   grátis em `VT_API_KEY`, ele envia o instalador e gera o selo para o site em `dist/virustotal.html`. Também dá para
   rodar à parte com `npm run virustotal`. Confira o resultado antes de publicar.
5. Rode `npm run release` (usa o login do `gh`). Ele pede confirmação e publica a Release com o instalador,
   o `latest.yml` e o `SHA256SUMS.txt`.
6. Envie o mesmo instalador para o Google Drive que a página `/baixar` aponta: é o nome do arquivo
   (`DayZ-Toolkit-Setup-X.Y.Z.exe`) que o app lê para saber qual é a versão mais nova.

Boas práticas: publique poucas versões e espaçadas, não envie várias seguidas.

### Assinatura do instalador (recomendado)

Instalador sem assinatura costuma ser marcado por antivírus e pelo SmartScreen. Com um certificado de code
signing, o electron-builder assina sozinho se estas variáveis existirem ao rodar `npm run release`:

```
CSC_LINK=caminho\do\certificado.pfx
CSC_KEY_PASSWORD=senha
```

Alternativa sem certificado próprio: Azure Trusted Signing (configurar `win.azureSignOptions` no `package.json`).

## Créditos

Os mapas da aba **Mapa** são o [iZurvive](https://www.izurvive.com/) (https://www.izurvive.com/) e o
[Nasdara Map](https://nasdaramap.com/) (https://nasdaramap.com/), carregados de lá dentro do app. Todo o mapa, os
dados e as marcações pertencem aos seus criadores; este projeto não é afiliado ao iZurvive, ao Nasdara Map nem ao
DayZ (Bohemia Interactive), e o crédito do mapa em uso aparece também na própria aba. O Nasdara Map se descreve como
projeto não oficial de fãs, gratuito, e não publica termos de uso (só uma política de privacidade).

**Aviso de marca.** DayZ Toolkit é um projeto de fã, independente, não afiliado nem autorizado pela Bohemia Interactive a.s.
DayZ, Badlands e BattlEye são marcas dos respectivos donos (DayZ e Badlands: Bohemia Interactive a.s.). Este projeto não injeta código nem lê a memória do jogo. Not affiliated with or authorized by Bohemia Interactive a.s.; DayZ is a trademark of Bohemia Interactive a.s.

## Idiomas

Português (Brasil), English, Español, Français, 简体中文 e हिन्दी. O app abre no idioma do Windows (se for um dos
acima; senão, em inglês) e a escolha feita no seletor de idioma, no canto inferior esquerdo, fica salva.

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
  updater.js     avisa de versão nova lendo a página de download
  settings.js    preferências salvas
  i18n.js        idiomas (carrega src/locales e traduz os avisos)
  toast.js       aviso flutuante no canto da tela
  overlay.js     relógio do jogo na tela
  mapview.js     mapas (iZurvive e Nasdara Map) presos à janela principal
  appaudio.js    captura o som de um programa só (o DayZ), via WASAPI por processo
  gameversion.js versão do DayZ instalado (para comparar com a do servidor)
src/shared/      lógica compartilhada: ciclo dia/noite, decodificador de morse do rádio, bunkers da Nasdara
src/preload.js   ponte segura com a interface
src/renderer/    interface (HTML/CSS/JS)
src/locales/     textos de cada idioma (um JSON por idioma)
```
