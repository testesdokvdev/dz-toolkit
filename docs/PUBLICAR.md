# Publicar uma versão nova (para quem mantém o projeto)

Notas internas de manutenção: versionamento, Release no GitHub, VirusTotal, aviso ao site, link fixo de download, versões antigas, nome do app e assinatura do instalador.

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
4. Defina `VT_API_KEY` (chave grátis em virustotal.com > perfil > API key) **antes** de rodar o release: o scan do
   [VirusTotal](https://www.virustotal.com) agora é obrigatório (passo 6) e o `npm run release` nem começa sem a chave. Nunca
   escreva a chave no repositório nem em log. No `--dry-run` nada é enviado nem consultado no VirusTotal.
5. Dê o `git push` dos commits (a tag da Release nasce do que já está no GitHub) e rode `npm run release` (usa o
   login do `gh`). Ele pede confirmação e publica a Release em `testesdokvdev/dz-toolkit` (o repositório de
   `build.publish`, no `package.json`) com **uma chamada só** do `gh`: instalador, `.blockmap`, `latest.yml` e
   `SHA256SUMS.txt` (os nomes são `DZ-Toolkit-Setup-X.Y.Z.exe`, iguais aos do `latest.yml`) e o **alias**
   `DZ-Toolkit-Setup.exe` (veja abaixo). É isso que os apps instalados leem para se atualizar sozinhos: não há mais
   Drive nem site a atualizar a cada versão. Os assets públicos são só os `DZ-Toolkit-*`. Ao final, o script confere
   que o link do site (`/releases/latest/download/DZ-Toolkit-Setup.exe`) responde e tem o tamanho do instalador.
6. **VirusTotal (obrigatório, automático logo depois de publicar).** Depois do `gh release create` e da conferência do link
   do site, o `release.js` consulta o hash do instalador (o mesmo do alias) e **só envia o arquivo se o hash ainda não existir**
   no VirusTotal. Espera a análise (até 15 min), imprime um bloco com versão, SHA256, link, `Limpo: X de Y antivírus detectaram`
   (X = malicious + suspicious; Y = malicious + suspicious + undetected + harmless, o mesmo critério do selo), data do scan e o
   aviso **PRÓXIMO PASSO OBRIGATÓRIO**, e grava `dist/virustotal.json` (fora do git) para o handoff. Se o scan falhar ou
   expirar (código de saída 3) ou houver detecção (código 2), o release sai com erro: **não atualize o selo com "Limpo"**,
   investigue. Rodar de novo à parte: `npm run virustotal` (reaproveita o arquivo já enviado). Consulta só de leitura de um hash:
   `npm run virustotal -- --lookup <sha256>`.
7. **Avisar o site (Criador de Sites): automático.** Logo depois do bloco do VirusTotal, em **qualquer** status (`clean`,
   `flagged` ou `failed`), o `release.js` dispara `maestri ask "Criador de Sites" "<msg>"` (nome configurável em
   `SITE_AGENT_NAME`). A mensagem é curta e só ASCII: versão, status do scan, o caminho de `dist/virustotal.json` (com barras
   normais) e a instrução de seguir a seção "Fluxo de release" do `AGENTS.md` do site (`D:/workspace/dayz-toolkit-site`); com
   status diferente de `clean` ela manda **não alterar o selo nem fazer deploy** e avisar o Kevin. O release **não espera** o
   agente terminar (só confirma que o `maestri` não falhou em ~8 s) e uma falha do aviso **nunca** muda o código de saída: se o
   `maestri` não estiver no PATH, o agente não existir/não estiver conectado a este terminal ou o comando falhar, o script
   imprime um bloco `NAO consegui avisar o agente do site` com o **comando exato para rodar na mão**. O agente precisa estar
   conectado ao terminal do projeto no Maestri (`maestri list`). Por trás, o site (agente) usa os **números reais** do JSON
   (`status`, `version`, `sha256`, `link`, `flagged`, `total`, `label`, `scanDate`); sem scan real (`status` diferente de `clean`,
   ou JSON de outra versão) o selo é **removido**, nunca mantido nem inventado. No `--dry-run` nada é enviado: só aparecem o
   nome do agente e as mensagens que seriam enviadas.
8. Cópia ponte para versões 2.5.0 e anteriores: **desativada desde 03/11/2026** (o endereço antigo do site saiu do ar e elas
   não alcançam mais o Drive; veja "Versões antigas" abaixo). Não há mais nada a enviar ao Drive.

Boas práticas: publique poucas versões e espaçadas, não envie várias seguidas.

## Link fixo de download (alias `DZ-Toolkit-Setup.exe`)

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

## Versões antigas (2.5.0 e anteriores)

Elas não têm o atualizador novo. Só olhavam a página `dayz-toolkit.netlify.app/baixar` (o **endereço antigo do site**), que
redirecionava (302) para um arquivo do Google Drive, e só reconheciam versão nova pelo **nome** desse arquivo
(`DayZ-Toolkit-Setup-X.Y.Z.exe`). Esse endereço antigo **saiu do ar (404 em tudo) e não será recriado**; o site oficial hoje é
`https://dz-toolkit.netlify.app/`. Como esses apps têm o endereço antigo gravado no código, **não conseguem mais ver nem
baixar versão nova**: a ponte via `/baixar` + Drive deixou de alcançá-las. Quem ainda está numa dessas versões precisa
baixar o instalador atual na mão, em `https://dz-toolkit.netlify.app/download` (ou na
[página de Releases](https://github.com/testesdokvdev/dz-toolkit/releases/latest)); o instalador novo substitui a
instalação antiga, sem deixar dois apps, e dali em diante a atualização é automática, pelo GitHub.

**Cópia ponte (`scripts/bridge.js`): desativada desde 03/11/2026.** Ela gerava `dist/DayZ-Toolkit-Setup-X.Y.Z.exe`, cópia
byte a byte (mesmo SHA256) do instalador com o nome que o regex antigo reconhecia, para ir ao Drive que o `/baixar` do
endereço antigo apontava. Sem esse endereço ela não tinha para quem servir, então `BRIDGE_ENABLED = false`: o `npm run dist`
e o `npm run release` não geram mais a cópia, e o release segue igual (instalador versionado, `.blockmap`, `latest.yml`,
alias `DZ-Toolkit-Setup.exe` e `SHA256SUMS.txt`). O arquivo `scripts/bridge.js` foi mantido, só desligado; para apagar de
vez, remova-o e as chamadas no `release.js` e no script `dist` do `package.json`.

## Nome do app, pasta de dados e instalação

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

## Assinatura do instalador (recomendado)

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
