# Arcadia Launcher

Launcher desktop multiplataforma para organizar jogos que o próprio usuário possui e iniciar emuladores instalados localmente. O projeto começa por uma base offline-first: biblioteca, perfis locais, sessões de jogo, tempo de uso e conquistas próprias.

> **Estado do projeto:** MVP técnico inicial. Login online, amizades, presença, sincronização em nuvem, catálogo remoto de capas/vídeos e conquistas verificadas de jogos ainda não estão implementados.

## O que já está implementado

- Aplicativo desktop com Tauri 2, React e TypeScript.
- Banco SQLite salvo na pasta de dados do aplicativo, com suporte a migrações idempotentes via `CREATE TABLE IF NOT EXISTS`.
- Biblioteca local com busca, filtro por sistema, seleção de arquivo e remoção de jogos.
- Perfis locais independentes para tempo e conquistas.
- Configuração de executáveis por sistema e modelo de argumentos com `{game}` como marcador para o arquivo escolhido.
- Inicialização do emulador sem chamar shell, por meio de argumentos separados do processo.
- Registro de sessão, tempo por jogo e tempo de uso do Arcadia.
- Conquistas locais iniciais com raridade e notificação.
- Interface em português, tema escuro e layout adaptável.
- Workflow de GitHub Actions para gerar pacotes nativos para Windows, Linux e macOS quando uma tag de versão for publicada.

## O que não está implementado nesta fase

- Cadastro/login online ou sincronização entre computadores.
- Amigos, presença online, mensagens ou notificações com o aplicativo fechado.
- Capas, vídeos, sinopses e recomendações carregadas de provedores externos.
- Detecção automática e validação de mods de coop.
- Conquistas verificadas de gameplay e platinas baseadas em integrações de terceiros.
- Verificação remota antifraude de tempo ou progresso.
- Instalador de emuladores, BIOS, firmware, ROMs ou mods. O Arcadia não distribui esses arquivos.

Consulte [`docs/ROADMAP.md`](docs/ROADMAP.md) para as etapas de evolução e [`docs/SECURITY.md`](docs/SECURITY.md) para as decisões de segurança.

---

## Tecnologias

- **Desktop:** Tauri 2 + Rust.
- **Interface:** React + TypeScript + Vite.
- **Persistência local:** SQLite via `rusqlite` com SQLite incorporado.
- **Integração nativa:** comandos Tauri para arquivos, processos e dados.
- **Build multiplataforma:** GitHub Actions + `tauri-action`.

## Pré-requisitos

### Todos os sistemas

1. Git.
2. Node.js LTS (recomendado Node 22 ou mais recente compatível com as dependências).
3. Rust stable e Cargo via [rustup](https://rustup.rs/).
4. Ferramentas nativas específicas do sistema operacional descritas abaixo.

Documentação oficial dos requisitos do Tauri: <https://v2.tauri.app/start/prerequisites/>.

### Windows

1. Instale o Node.js LTS: <https://nodejs.org/>.
2. Instale Rust stable: <https://rustup.rs/>.
3. Instale o **Microsoft C++ Build Tools**, incluindo a carga de trabalho *Desktop development with C++*: <https://visualstudio.microsoft.com/visual-cpp-build-tools/>.
4. Garanta que o Microsoft Edge WebView2 Runtime esteja instalado; ele já existe na maioria das instalações modernas do Windows.

Use PowerShell ou Windows Terminal para os comandos abaixo.

### macOS

1. Instale o Node.js LTS e Rust stable.
2. Instale as ferramentas de linha de comando do Xcode:

```bash
xcode-select --install
```

Para compilar artefatos Intel e Apple Silicon, o workflow utiliza targets separados. Em alguns pacotes, escolha o executável dentro de `Emulador.app/Contents/MacOS/` em vez de selecionar apenas a pasta `.app`. A assinatura e notarização da Apple não estão configuradas; em uma distribuição pública para macOS, esses passos podem ser necessários para uma instalação mais fluida.

### Linux (Debian/Ubuntu)

Instale as dependências nativas exigidas pelo Tauri:

```bash
sudo apt update
sudo apt install -y \
  build-essential curl wget file \
  libwebkit2gtk-4.1-dev \
  libxdo-dev libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev patchelf xdg-utils
```

Outras distribuições exigem pacotes equivalentes. Consulte a documentação oficial do Tauri antes de compilar.

---

## Como executar em modo de desenvolvimento

Na raiz do projeto:

```bash
npm install
npm run tauri:dev
```

O primeiro build nativo pode levar algum tempo porque o Cargo e o npm baixam e compilam dependências. O ambiente em que este pacote foi preparado não tinha acesso ao registro npm nem toolchain Rust, por isso o pacote passou por verificações estáticas, mas ainda precisa ser compilado e testado no seu ambiente antes de ser tratado como release. A janela do Arcadia será aberta quando a compilação terminar.

## Como gerar o instalador/artefato local

```bash
npm install
npm run tauri:build
```

Os artefatos são gerados em `src-tauri/target/release/bundle/`. O formato depende do sistema operacional e das ferramentas instaladas.

**Importante:** os instaladores são específicos do sistema/arquitetura. Para gerar builds confiáveis para Windows, macOS e Linux, execute o build em cada sistema ou use o workflow de CI incluído. Um instalador compilado no Windows não é um instalador macOS.

## Primeiro uso

1. Abra Arcadia; ele cria o perfil local `Jogador` e o banco SQLite na pasta de dados de aplicativo do sistema.
2. Clique em **Adicionar jogo** e selecione um arquivo de jogo que você já possui.
3. Escolha o sistema correspondente ao arquivo.
4. Abra **Emuladores**, selecione o executável de um emulador instalado por você e salve a configuração.
5. Configure os argumentos de inicialização conforme a documentação daquele emulador. O marcador `{game}` é substituído pelo caminho do arquivo. Exemplo genérico:

```text
--fullscreen "{game}"
```

6. Volte à biblioteca e clique no botão de iniciar.

A sintaxe e os argumentos variam entre emuladores. O exemplo acima não é universal. Emuladores que esperam um formato de argumento diferente devem ser configurados de acordo com a documentação oficial deles.

## Como os dados são salvos

O banco `arcadia.sqlite3` fica no diretório de dados de aplicativo resolvido pelo Tauri para cada sistema operacional. O caminho real varia por sistema e usuário. Não apague esse arquivo enquanto quiser preservar a biblioteca, os perfis e as estatísticas. Esta versão ainda não tem exportação/backup pela interface; faça cópias com o Arcadia fechado.

Os arquivos de jogo não são copiados nem movidos para a pasta do Arcadia. A biblioteca guarda o caminho local, por isso mover ou apagar um arquivo pode exigir cadastrá-lo novamente.

## Compilação automática pelo GitHub

O workflow em `.github/workflows/release.yml` pode gerar artefatos para Windows, Linux e macOS quando uma tag como `arcadia-v0.1.0` for enviada ao repositório. Para usar:

```bash
git tag arcadia-v0.1.0
git push origin arcadia-v0.1.0
```

O workflow cria uma release preliminar no GitHub com os arquivos produzidos. Antes de publicar uma versão para usuários, valide os artefatos e configure assinatura de código/notarização quando aplicável.

## Estrutura de pastas

```text
arcadia-launcher/
├── .github/workflows/
│   ├── ci.yml                     # formatação, build e testes por sistema
│   └── release.yml                # builds nativos no GitHub Actions
├── docs/
│   ├── ROADMAP.md                 # fases de desenvolvimento
│   └── SECURITY.md                # modelo de ameaças e práticas
├── src/
│   ├── lib/api.ts                 # chamadas seguras ao backend nativo
│   ├── App.tsx                    # páginas e fluxo principal da interface
│   ├── main.tsx                   # entrada React
│   ├── styles.css                 # tema e layout
│   └── types.ts                   # contratos TypeScript
└── src-tauri/
    ├── capabilities/default.json  # permissões mínimas da janela
    ├── icons/                     # ícones de build
    ├── src/lib.rs                 # comandos, SQLite e lançamento de processos
    ├── Cargo.toml                 # dependências Rust
    └── tauri.conf.json            # build e política de segurança
```

## Princípios de segurança desta base

- Nenhuma ROM, BIOS, firmware ou mod é embutido no projeto.
- O arquivo do jogo e o executável do emulador são validados como arquivos locais existentes.
- Os argumentos são analisados e passados diretamente ao processo, sem shell intermediário.
- O frontend não recebe acesso arbitrário ao banco SQLite; ele usa comandos nativos específicos.
- As permissões Tauri são mínimas para a janela principal e seletor de arquivos.
- Não há chaves de API, tokens online ou segredos embutidos no bundle.
- O SQLite ativa chaves estrangeiras, WAL e timeout de bloqueio.

Essa base reduz riscos, mas não substitui revisão de código, testes de segurança, assinatura dos executáveis ou validação antes de uma distribuição pública.
