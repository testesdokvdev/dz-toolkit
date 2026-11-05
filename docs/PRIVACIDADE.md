# Privacidade, segurança e detalhes de uso

Detalhes do que o DZ Toolkit faz (e não faz) com o seu computador. Resumo no [README](../README.md).

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

## Créditos dos mapas (detalhe)

O crédito do mapa em uso aparece também na própria aba Mapa. O Nasdara Map se descreve como projeto não oficial de fãs, gratuito, e não publica termos de uso (só uma política de privacidade). O DZ Toolkit é um projeto independente e não oficial.
