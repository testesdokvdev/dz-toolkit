# DZ Toolkit

Ferramentas para DZ em um app só: **Auto Run**, **Cliques Automáticos** e **Monitor de Servidor**.
Feito em Electron; teclado, mouse e janelas usam a API do Windows direto (via `koffi`).
Código aberto sob a licença [MIT](LICENSE).

## O que o app faz (e o que não faz)

| Ferramenta | O que faz |
|---|---|
| Auto Run | Segura Shift + W enquanto ativo e o DZ estiver em foco |
| Cliques Automáticos | Segura o botão direito do mouse e dá cerca de 5 cliques por segundo com o esquerdo, só com o DZ em foco. É exatamente isso e mais nada: não mira, não detecta nada na tela e não lê o jogo |
| Monitor de Servidor | Quando o servidor cai, você não precisa ficar atualizando o DayZ Launcher: o app consulta o servidor (Steam A2S, UDP) e avisa com som e alerta na tela quando ele voltar. O "Status ao vivo" mostra a hora do jogo, a fila, os jogadores, o ping e se a versão do seu jogo bate com a do servidor |
| Relógio na tela | Mostra a hora do jogo, exatamente como o servidor informa, num canto da tela, por cima do DZ em janela ou janela sem bordas. Não pega clique nem foco |
| Rádio Nasdara | Só para o mapa Nasdara (Badlands): escuta só o som do DZ, decodifica o morse do rádio dos bunkers (80.0 MHz, de noite) e mostra a grade do mapa e o código da porta de cada bunker. Mostra ao vivo os bipes que está ouvindo e os dígitos que decifrou, avisa na tela quando um bunker é confirmado e abre a posição dele no iZurvive com um clique (sempre o iZurvive, que é de onde vêm as coordenadas, mesmo que a aba Mapa esteja no Nasdara Map) |
| Mapa | Mapas interativos dentro do app, com as marcações do próprio mapa: [iZurvive](https://www.izurvive.com/) ou [Nasdara Map](https://nasdaramap.com/), à sua escolha (um seletor na própria aba; a escolha fica salva) |

- **Não grava o que você digita.** Os atalhos são atalhos globais do Windows (`RegisterHotKey`): o app só é avisado
  das teclas que você escolheu, e só os registra com o DZ em foco e a chave da ferramenta ligada. Não existe hook
  de teclado nem de mouse e nada é registrado ou guardado.
- **Não lê nem mexe na memória do jogo e não injeta código.** Só envia teclas e cliques como se fossem seus
  (`SendInput`) e lista as janelas abertas para achar a do DZ.
- **Sem telemetria e sem conta.** A única rede usada é: a consulta UDP ao servidor que você configurar (e o DNS dele)
  e a checagem de atualização, que a cada 2 horas consulta o `github.com/testesdokvdev/dz-toolkit` (o feed de
  Releases, a página da última Release e o arquivo `latest.yml` dela; nada de API com login) só para saber a versão
  publicada. A aba Mapa só acessa a rede quando você
  a abre, e carrega apenas o site do mapa escolhido, o iZurvive ou o Nasdara Map (qualquer outro link abre no
  navegador). As preferências (inclusive qual mapa você escolheu) ficam num `settings.json` local.
- **A atualização só é baixada quando você clica em Atualizar.** Ao achar versão nova o app apenas avisa. Se você clicar,
  ele baixa o instalador da Release (conferindo o hash SHA-512 do `latest.yml`), fecha, instala em silêncio e
  abre de novo. Nunca baixa nem reinicia por conta própria. Sem internet, com o GitHub fora ou se o download falhar,
  o app segue funcionando: mostra o motivo, deixa tentar de novo ou baixar o instalador na página da Release.
  O repositório se chamava `dayz-toolkit`: instalações antigas ainda consultam esse endereço, que o GitHub redireciona
  para `dz-toolkit`.
- **Os mapas são sites de terceiros e seguem as práticas deles.** Cada um roda com sessão própria (cookies e armazenamento
  separados do resto do app e do outro mapa), e o app nega todos os pedidos de permissão deles (câmera, microfone, localização, captura de tela). O
  iZurvive exibe anúncios e carrega rastreadores de publicidade. O Nasdara Map não tem conta, anúncio nem cookie de
  rastreamento, mas, enquanto um mapa está aberto, conta visitantes (um identificador aleatório e o mapa aberto) e, se você
  usar os grupos opcionais, guarda as marcações compartilhadas num servidor dele (ver a
  [política de privacidade](https://nasdaramap.com/privacy)). Cada mapa só é carregado quando você o escolhe na aba; depois
  disso ele fica aberto, escondido, até você fechar o app.
- **O Rádio Nasdara só escuta, localmente, e só o DZ.** Enquanto você está escutando, ele captura o som do
  processo do jogo (captura de áudio por processo do Windows 10/11, `ActivateAudioInterfaceAsync`), procura os
  bipes do morse e descarta o resto na hora. Nada do áudio é gravado nem enviado. Se o Windows não deixar isolar
  o jogo, o app avisa e cai para o som do PC todo (também só durante a escuta).
- **Escolha teclas que o DZ não usa.** Enquanto a chave da ferramenta está ligada, a tecla do atalho é do app e
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
3. Rode `npm run release -- --dry-run`: gera o instalador, confere se o `latest.yml` bate com ele (versão, nome,
   tamanho e hash) e mostra o SHA256, sem publicar.
4. Ao fim do build, o script pergunta se deve rodar o [VirusTotal](https://www.virustotal.com) agora. Com a chave
   grátis em `VT_API_KEY`, ele envia o instalador e gera o selo para o site em `dist/virustotal.html`. Também dá para
   rodar à parte com `npm run virustotal`. Confira o resultado antes de publicar.
5. Dê o `git push` dos commits (a tag da Release nasce do que já está no GitHub) e rode `npm run release` (usa o
   login do `gh`). Ele pede confirmação e publica a Release em `testesdokvdev/dz-toolkit` (o repositório de
   `build.publish`, no `package.json`) com **uma chamada só** do `gh`: instalador, `.blockmap`, `latest.yml` e
   `SHA256SUMS.txt` (os nomes são `DZ-Toolkit-Setup-X.Y.Z.exe`, iguais aos do `latest.yml`) e o **alias**
   `DZ-Toolkit-Setup.exe` (veja abaixo). É isso que os apps instalados leem para se atualizar sozinhos: não há mais
   Drive nem site a atualizar a cada versão. Os assets públicos são só os `DZ-Toolkit-*`. Ao final, o script confere
   que o link do site (`/releases/latest/download/DZ-Toolkit-Setup.exe`) responde e tem o tamanho do instalador.
6. Versões 2.5.0 e anteriores: **a cópia ponte para o Drive deixou de alcançá-las** (o endereço antigo do site saiu do ar;
   veja "Versões antigas" abaixo). Não há mais o que enviar ao Drive a cada versão.

Boas práticas: publique poucas versões e espaçadas, não envie várias seguidas.

### Link fixo de download (alias `DZ-Toolkit-Setup.exe`)

Para o site ter **um só** botão de download, independente da versão, toda Release leva, além do instalador versionado,
o asset `DZ-Toolkit-Setup.exe`: cópia byte a byte (mesmo SHA256, o `release.js` confere) com nome fixo. Assim o link
`https://github.com/testesdokvdev/dz-toolkit/releases/latest/download/DZ-Toolkit-Setup.exe` sempre entrega a última versão.
O `SHA256SUMS.txt` lista os dois nomes.

- **Rota do site (`https://dz-toolkit.netlify.app/download`):** no Netlify, crie `/download` com **302** (nunca 301, que o navegador guarda para sempre) para o link
  acima, por exemplo no `_redirects`:
  `/download  https://github.com/testesdokvdev/dz-toolkit/releases/latest/download/DZ-Toolkit-Setup.exe  302`.
  Os botões do site apontam para `/download`. O repositório precisa ser público.
- **O alias não é o que atualiza o app.** O `latest.yml` continua apontando só para o `DZ-Toolkit-Setup-X.Y.Z.exe`
  (o atualizador confere o sha512 dele); o alias é criado depois dessa conferência e nunca entra no `latest.yml`.
- **O site mudou de endereço:** o oficial agora é `https://dz-toolkit.netlify.app/` e quem vai baixar o app deve usar o
  `/download` dele. O endereço antigo (`dayz-toolkit.netlify.app`) está fora do ar e não será recriado (próxima seção).
- O instalador sem assinatura continua sujeito ao SmartScreen/antivírus a cada versão nova, com ou sem link fixo; a
  reputação é do arquivo (hash) e do certificado, não do link.

### Versões antigas (2.5.0 e anteriores)

Elas não têm o atualizador novo. Só olhavam a página `dayz-toolkit.netlify.app/baixar` (o **endereço antigo do site**), que
redirecionava (302) para um arquivo do Google Drive, e só reconheciam versão nova pelo **nome** desse arquivo
(`DayZ-Toolkit-Setup-X.Y.Z.exe`). Esse endereço antigo **saiu do ar (404 em tudo) e não será recriado**; o site oficial hoje é
`https://dz-toolkit.netlify.app/`. Como esses apps têm o endereço antigo gravado no código, **não conseguem mais ver nem
baixar versão nova**: a ponte via `/baixar` + Drive deixou de alcançá-las. Quem ainda está numa dessas versões precisa
baixar o instalador atual na mão, em `https://dz-toolkit.netlify.app/download` (ou na
[página de Releases](https://github.com/testesdokvdev/dz-toolkit/releases/latest)); o instalador novo substitui a
instalação antiga, sem deixar dois apps, e dali em diante a atualização é automática, pelo GitHub.

**Cópia ponte (`scripts/bridge.js`).** O `npm run dist` e o `npm run release` ainda geram `dist/DayZ-Toolkit-Setup-X.Y.Z.exe`,
cópia byte a byte (mesmo SHA256) do instalador com o nome que o regex antigo reconhecia. Hoje ela não tem para quem servir
(nunca sobe na Release do GitHub e o `/baixar` não existe mais). Para parar de gerá-la, ponha `BRIDGE_ENABLED = false` em
`scripts/bridge.js` (ou apague o arquivo e as chamadas no `release.js` e no script `dist` do `package.json`).

### Nome do app, pasta de dados e instalação

O app se chamava DayZ Toolkit e agora é **DZ Toolkit** (só o nome do produto; o `appId` continua o mesmo, por isso o
Windows trata o instalador novo como atualização do antigo e atualiza o item em Configurações > Aplicativos em vez de criar
outro). Testado com instaladores de teste de mesmo `appId`: a instalação nova cai na **mesma pasta** da antiga (que mantém o
nome antigo, ex.: `%LOCALAPPDATA%\Programs\DayZ Toolkit\DZ Toolkit.exe`), o `DayZ Toolkit.exe` e o desinstalador antigo somem, os
atalhos do Menu Iniciar e da Área de Trabalho são trocados pelos novos e o app aberto é fechado. **Atenção:** um ícone fixado na
barra de tarefas, ou um atalho feito à mão que aponte para o `DayZ Toolkit.exe`, deixa de funcionar (o executável mudou de nome)
e precisa ser fixado de novo. A pasta de dados do Electron vem do nome do produto, então sem cuidado ela mudaria e quem já usa
perderia as preferências e as marcações dos mapas: por isso `src/main/datadir.js` continua usando `%APPDATA%\DayZ Toolkit` quando
ela já existe (instalações novas usam `%APPDATA%\DZ Toolkit`). Nela ficam o `settings.json` e os perfis dos mapas
(`persist:izurvive` e `persist:nasdaramap`).

### Assinatura do instalador (recomendado)

Instalador sem assinatura costuma ser marcado por antivírus e pelo SmartScreen. Com um certificado de code
signing, o electron-builder assina sozinho se estas variáveis existirem ao rodar `npm run release`:

```
CSC_LINK=caminho\do\certificado.pfx
CSC_KEY_PASSWORD=senha
```

Alternativa sem certificado próprio: Azure Trusted Signing (configurar `win.azureSignOptions` no `package.json`).

**A atualização automática e a assinatura.** Hoje o instalador não é assinado (não há certificado nem segredo no repositório)
e o `package.json` **não** define `publisherName`. Sem ele, o atualizador não confere a assinatura do instalador baixado;
a integridade vem do HTTPS do GitHub e do hash SHA-512 do `latest.yml`, que o app confere antes de instalar.
Isso protege contra download corrompido, mas não contra quem controle a conta do GitHub. **No dia em que você assinar:**
com `CSC_LINK` o electron-builder grava sozinho o `publisherName` (o CN do certificado) no `app-update.yml`, e a partir
daí o app só aceita atualização cujo instalador tenha assinatura **válida** daquele publicador. Um certificado autoassinado
(que o Windows não reconhece) faria o app recusar todas as atualizações. Se for assinar, use um certificado de uma
autoridade reconhecida e mantenha o mesmo publicador em todas as versões seguintes.

## Créditos

Os mapas da aba **Mapa** são o [iZurvive](https://www.izurvive.com/) (https://www.izurvive.com/) e o
[Nasdara Map](https://nasdaramap.com/) (https://nasdaramap.com/), carregados de lá dentro do app. Todo o mapa, os
dados e as marcações pertencem aos seus criadores; este projeto não é afiliado ao iZurvive, ao Nasdara Map nem ao
DayZ (Bohemia Interactive), e o crédito do mapa em uso aparece também na própria aba. DayZ é marca da Bohemia
Interactive; o nome só aparece aqui para dizer com que jogo o app funciona (uso nominativo), e o DZ Toolkit é um projeto
independente e não oficial. O Nasdara Map se descreve como
projeto não oficial de fãs, gratuito, e não publica termos de uso (só uma política de privacidade).

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
