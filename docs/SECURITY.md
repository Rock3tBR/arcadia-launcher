# Segurança — modelo inicial

## Dados locais

- O SQLite usa chaves estrangeiras, consultas parametrizadas e um diretório de dados gerenciado pelo Tauri.
- Os perfis locais não são um limite de segurança contra outras pessoas que tenham acesso à mesma conta do sistema operacional. Quem controla o computador pode, em geral, ler ou modificar os arquivos locais.
- Não sincronize dados locais para um servidor sem autenticação e regras de autorização no backend.
- Faça cópias do banco com o aplicativo fechado até existir um fluxo de backup consistente.

## Inicialização de processos

- O usuário escolhe o executável do emulador e o arquivo do jogo.
- O caminho é canonicalizado e validado como arquivo existente.
- Os argumentos são divididos em uma lista e fornecidos diretamente a `std::process::Command`; não é invocado `sh`, `cmd.exe` ou outro shell.
- O marcador `{game}` é substituído pelo caminho canonicalizado do jogo.
- Os argumentos continuam sendo poderosos: flags de emuladores podem carregar scripts ou recursos adicionais. Configure somente emuladores confiáveis e use a documentação oficial para os argumentos.

## Limitações conhecidas

- Tempo e conquistas locais podem ser alterados por alguém que controla o computador ou o banco. Não os use como prova de competição sem um mecanismo de verificação.
- O tempo da sessão em andamento só é consolidado quando o processo termina. Se o Arcadia ou o sistema fechar inesperadamente, a sessão incompleta pode ser descartada na próxima inicialização.
- Esta versão não implementa backup pela interface, sincronização em nuvem, assinatura do instalador ou atualização automática.
- Não há upload de arquivos de jogo nem servidor online nesta fase.

## Antes de publicar

1. Executar `cargo fmt`, `cargo clippy` e testes Rust em um ambiente com toolchain instalado.
2. Executar `npm install` e `npm run build`.
3. Construir e testar instaladores em Windows, Linux e macOS reais/CI.
4. Revisar as permissões Tauri, a CSP e as dependências.
5. Assinar os artefatos e verificar a origem/integridade das releases.
6. Revisar licenças do Tauri, emuladores integrados e quaisquer fontes de metadados.
7. Não colocar senhas, chaves privadas ou credenciais administrativas em variáveis `VITE_*` nem no executável.
