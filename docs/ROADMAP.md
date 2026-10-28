# Roadmap de desenvolvimento

A regra é terminar e validar cada etapa antes de iniciar a seguinte. O objetivo é evitar que recursos online, metadados e integrações de console bloqueiem o núcleo do aplicativo.

## Etapa 1 — Launcher local (base entregue)

- [x] Projeto Tauri + React/TypeScript.
- [x] Banco SQLite e estrutura inicial de tabelas.
- [x] Biblioteca com cadastro manual de arquivos.
- [x] Filtros e busca por nome/plataforma.
- [x] Perfis locais.
- [x] Configuração por sistema para caminho do emulador e argumentos.
- [x] Inicialização de um processo sem shell.
- [x] Tempo de jogo e tempo de uso do aplicativo.
- [x] Conquistas locais iniciais e notificações.
- [ ] Teste de compilação em cada sistema operacional.
- [ ] Testes automatizados de comandos Rust e recuperação de sessão.
- [ ] Exportar/importar backup local.

**Critérios de aceite:** cadastrar jogo, configurar emulador, iniciar processo, acompanhar tempo, encerrar o aplicativo e confirmar que biblioteca/progresso continuam salvos.

## Etapa 2 — Biblioteca enriquecida

- [ ] Modelo de dados de metadados separado do caminho local do arquivo.
- [ ] IDs externos, edição/região, desenvolvedora, gênero, franquia e relações entre títulos.
- [ ] Integração com um provedor de metadados autorizado.
- [ ] Capas e vídeos com cache respeitando os termos de uso.
- [ ] Tela de detalhes do jogo e recomendações explicáveis.
- [ ] Deduplicação por identificador externo, plataforma e edição.

## Etapa 3 — Conquistas e compatibilidade

- [ ] Adaptador de integração com RetroAchievements, conforme suporte do emulador/jogo.
- [ ] Exibir origem e nível de verificação de cada conquista.
- [ ] Separar conquistas próprias, conquistas externas e conquistas verificadas.
- [ ] Definir regra de platina por conjunto de conquistas.
- [ ] Catálogo de compatibilidade por versão do emulador.
- [ ] Testes de desempenho e recuperação depois de crashes.

## Etapa 4 — Sincronização e conta online

- [ ] Definir backend e modelo de identidade.
- [ ] Implementar cadastro, login, recuperação e sessões seguras.
- [ ] Políticas de acesso no backend para toda tabela privada.
- [ ] Sincronização incremental e resolução explícita de conflitos.
- [ ] Exportação e exclusão de conta/dados.
- [ ] Revisão LGPD e política de privacidade antes de produção.

## Etapa 5 — Amigos e presença

- [ ] Pedidos de amizade, aceite e remoção.
- [ ] Bloqueio, privacidade e status invisível/não perturbe.
- [ ] Presença com heartbeat e expiração para conexões abandonadas.
- [ ] Notificações respeitando preferências do usuário.
- [ ] Limites anti-spam, denúncias e moderação básica.
- [ ] Serviço em segundo plano e notificações nativas quando o app estiver fechado.

## Etapa 6 — Mods e coop

- [ ] Catálogo de mods com URL, licença, jogo/plataforma e versão testada.
- [ ] Indicar coop local/online e requisitos, sem afirmar compatibilidade sem fonte.
- [ ] Começar com catálogo informativo; não executar downloads automaticamente.
- [ ] Fluxo explícito de download, validação de hash e confirmação do usuário, se for implementado.
- [ ] Testes por jogo, emulador, versão e sistema operacional.

## Etapa 7 — Distribuição pública

- [ ] Builds reprodutíveis e dependências monitoradas.
- [ ] Assinatura de código para Windows e macOS.
- [ ] Notarização macOS conforme necessário.
- [ ] Atualização segura com assinatura/verificação de integridade.
- [ ] Inventário de licenças de software e imagens.
- [ ] Política de privacidade, termos, canais de suporte e processo de resposta a vulnerabilidades.
