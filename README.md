# DZ Toolkit

Ferramentas para DZ em um app só: **Auto Run**, **Cliques Automáticos**, **Monitor de Servidor**, relógio do jogo na tela, **Rádio Nasdara** e **Mapa**.
Feito em Electron; teclado, mouse e janelas usam a API do Windows direto (via `koffi`).
Projeto independente e não oficial, de código aberto sob a licença [MIT](LICENSE).

## Recursos

| Ferramenta | O que faz |
|---|---|
| Auto Run | Segura Shift + W enquanto ativo e o DZ estiver em foco |
| Cliques Automáticos | Segura o botão direito do mouse e dá cerca de 5 cliques por segundo com o esquerdo, só com o DZ em foco. Não mira, não detecta nada na tela e não lê o jogo |
| Monitor de Servidor | Consulta o servidor (Steam A2S, UDP) e avisa com som e alerta na tela quando ele voltar, sem precisar ficar atualizando o DayZ Launcher. O "Status ao vivo" mostra hora do jogo, fila, jogadores, ping e se a versão do seu jogo bate com a do servidor |
| Relógio na tela | Mostra a hora do jogo, como o servidor informa, num canto da tela, por cima do DZ em janela ou janela sem bordas. Não pega clique nem foco |
| Rádio Nasdara | Só para o mapa Nasdara (Badlands): escuta o som do DZ, decodifica o morse do rádio dos bunkers (80.0 MHz, de noite) e mostra a grade do mapa e o código da porta de cada bunker, com abertura da posição no iZurvive |
| Mapa | Mapas interativos dentro do app: [iZurvive](https://www.izurvive.com/) ou [Nasdara Map](https://nasdaramap.com/), à sua escolha |

Interface em Português (Brasil), English, Español, Français, 简体中文 e हिन्दी: o app abre no idioma do Windows e a escolha fica salva.

## Requisitos

- Windows 10 ou 11 (64 bits). O Rádio Nasdara usa a captura de áudio por processo do Windows 10/11.
- DayZ para PC.

## Instalação e uso

1. Baixe o instalador em **<https://dz-toolkit.netlify.app/download>** ou na [página de Releases](https://github.com/testesdokvdev/dz-toolkit/releases/latest) (`DZ-Toolkit-Setup.exe`).
2. Instale e abra o DZ Toolkit. O instalador não é assinado, então o SmartScreen ou o antivírus podem mostrar um aviso.
3. Ligue a chave da ferramenta que quiser. Os atalhos padrão são **F7** (Auto Run) e **F8** (Cliques Automáticos) e só valem com o DZ em foco.
4. O app avisa quando houver versão nova e só atualiza se você clicar em **Atualizar**.

> **Escolha teclas que o DZ não usa.** Com a chave da ferramenta ligada, a tecla do atalho é do app e **o jogo não a recebe**
> (o C, por exemplo, deixaria de agachar). Prefira F5 a F12 ou uma combinação com Ctrl ou Alt. Duas ferramentas não podem usar a mesma tecla.

> Muitos servidores proíbem macros e qualquer automação de jogo, mesmo quando o BattlEye não bloqueia.
> Confira as regras do servidor antes de usar. O app mostra esse aviso toda vez que é aberto, e o uso é por sua conta e risco.

## Privacidade e segurança

- **Não grava o que você digita:** usa atalhos globais do Windows (`RegisterHotKey`), sem hook de teclado nem de mouse.
- **Não lê nem mexe na memória do jogo e não injeta código:** só envia teclas e cliques como se fossem seus (`SendInput`).
- **Sem telemetria e sem conta.** A rede usada é a consulta UDP ao servidor que você configurar e a checagem de atualização no GitHub (a cada 2 horas).
- **Rádio Nasdara:** escuta só o som do DZ, localmente; nada do áudio é gravado nem enviado.
- **Mapas de terceiros:** só carregam quando você os escolhe, com sessão separada e sem permissões (câmera, microfone, localização).

Detalhes completos em [docs/PRIVACIDADE.md](docs/PRIVACIDADE.md).

## Desenvolvimento

```bash
npm install
npm start          # abre o app
npm run dist       # gera o instalador em dist/
```

Estrutura do código, traduções e comandos extras: [docs/DESENVOLVIMENTO.md](docs/DESENVOLVIMENTO.md).
Como publicar uma versão (para quem mantém o projeto): [docs/PUBLICAR.md](docs/PUBLICAR.md).

## Créditos

Os mapas da aba **Mapa** são o [iZurvive](https://www.izurvive.com/) e o [Nasdara Map](https://nasdaramap.com/), carregados de lá
dentro do app. Todo o mapa, os dados e as marcações pertencem aos seus criadores. Este projeto não é afiliado ao iZurvive, ao
Nasdara Map nem ao DayZ (Bohemia Interactive). DayZ é marca da Bohemia Interactive, citada aqui só para dizer com que jogo o app
funciona (uso nominativo).
