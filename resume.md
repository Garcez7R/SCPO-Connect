# SCPO Connect — ponto de retomada

Atualizado em 05/11/2026. Repositório: `/home/rgarcez/SCPO-Connect`, branch `main`.

## Correção concluída — alinhamento visual do Almoxarifado

- O cadastro de itens, as abas operacionais, os formulários, as tabelas, a movimentação rápida, solicitações, histórico e estados vazios receberam classes próprias de layout responsivo.
- Campos, botões, cabeçalhos e tabelas agora usam grades e larguras controladas em computador, tablet e celular, evitando textos amontoados ou campos desalinhados.
- O Superadministrador permanece com acesso completo ao módulo, inclusive na navegação lateral e nas APIs.
- README e resume foram revisados; o frontend compilou com sucesso após a correção visual.

## Operação concluída — reforma operacional do cadastro da Farmácia

- O cadastro de lote foi refeito como assistente sequencial em três etapas: Identificar, Receber e Conferir lote.
- A etapa de identificação concentra código/GTIN, câmera, catálogo Anvisa, nome, princípio ativo, apresentação e categoria.
- A etapa de recebimento concentra quantidade, unidade de compra, unidade base, hierarquia de embalagens e saldo inicial calculado.
- A etapa final reúne lote, validade, fornecedor, armazenamento, resumo do cadastro e conferência responsável.
- Foram adicionadas validações de produto, embalagem, quantidade, lote, validade e confirmação antes do envio ao servidor.
- Os cards informativos verde/amarelo/vermelho não foram alterados em critérios ou propriedades.
- README e guia interno foram revisados; o frontend compilou com sucesso após esta reforma.

## Correção concluída — acesso completo do Superadministrador ao Almoxarifado

- O Superadministrador recebe todos os módulos diretamente no perfil da interface, independentemente da lista atribuída à conta.
- A navegação lateral e restauração da aba ativa permitem o Almoxarifado para o Superusuário.
- As APIs de itens, movimentações e solicitações do Almoxarifado aceitam o bypass explícito de superusuário.
- Almoxarifado permanece configurável na Administração e os módulos atribuíveis são apresentados em ordem alfabética.
- Nenhuma migração ou alteração em dados reais foi executada.

## Quadro de acompanhamento

### Forma de execução acordada

- Executar validações e testes estritamente um de cada vez: iniciar um único comando, aguardar sua conclusão e só então iniciar o próximo. Não executar pytest, TypeScript, ESLint, build ou outras verificações em paralelo; isso já travou o VS Code anteriormente.
- Ao concluir uma tarefa/fase, atualizar este resume, revisar README e as informações/ajuda dentro do app, informar que a fase terminou e qual será a próxima, então avançar automaticamente sem aguardar nova confirmação. Fazer commit e push ao final de cada fase; atualizar a documentação para refletir mudanças de uso e, quando não houver conteúdo pertinente a alterar, registrar que ela foi revisada sem inventar instruções. Não parar entre fases aguardando confirmação, salvo bloqueio, risco ou decisão necessária do usuário.
- **Checagem obrigatória de cada fase:** antes de encerrar ou commitar, validar que todo `revision` Alembic tem no máximo 32 caracteres, limite da coluna padrão `alembic_version.version_num` no PostgreSQL; executar o teste `test_revision_identifiers_fit_alembic_version_column` (ou verificação equivalente) sempre que houver mudança de migração. Esta checagem foi adicionada após a migração do Álbum falhar por exceder o limite; o identificador foi corrigido para `0062_therapy_album`.
- Preservar alterações locais preexistentes; antes de cada commit, conferir `git status` e revisar/stagear somente os arquivos da fase. Manter apenas este `resume.md`; a exclusão do `RESUME.md` legado foi solicitada pelo usuário e será publicada.
- E2E e deploy/atualização do servidor de testes permanecem pausados até orientação/autorização. Não executar migrações em dados reais.

### Situação resumida das fases

- **Almoxarifado — implementação iniciada nesta fase:** módulo próprio criado para catálogo de materiais, insumos, patrimônio/equipamentos controlados, localização, lotes, validade, número de série, estoque mínimo, entradas, saídas, ajustes, devoluções, perdas, solicitações de setores e vínculo opcional com ordens de serviço. O backend reutiliza o serviço de Manutenção no MVP, mantendo patrimônio separado dos consumíveis. Migração `0068_warehouse_module` adicionada sem aplicação em dados reais. A rota `/api/v1/admin/*` também foi restaurada no proxy para liberar Informativos na Administração; os campos de senha restantes receberam controles de mostrar/ocultar. Build frontend passou. Instalação/testes Python locais ficaram bloqueados pela ausência do ambiente virtual/dependências apt, não por falha de código.
- **Próxima prioridade acordada — reformulação operacional da Farmácia:** rever integralmente a aba de cadastro de itens com foco em prevenção de erro, fluxo rápido, validade de embalagens, lotes, conversões e consulta; não alterar as propriedades dos cards informativos. Esta reformulação será iniciada depois de concluir e publicar a fase atual do Almoxarifado.

- **Retomada atual — correções da Farmácia, participantes da Oficina Terapêutica e informativos:** informativos passam a ocupar a barra superior global, fora da Visão geral, e ficam como última aba de Administração e Superadministrador. Participantes da Oficina agora são validados antes do envio e apresentam orientação explícita quando um paciente não está mais disponível. A conversão interna da Farmácia usa o fator da unidade interna correta ao mostrar caixas internas; pendente validar visualmente esta apresentação.
- **Pré-condição operacional concluída em 05/11/2026:** relógio sincronizado, timezone de aplicação/servidor validado e MFA confirmado como operacional. A migração sintética foi revisada; os testes de esquema agora incluem as tabelas de informativos e estado automático da Anvisa/CMED adicionadas nas fases recentes.

- **Atualização controlada do aplicativo — implementada nesta fase:** o service worker deixou de ativar uma nova versão automaticamente. A aplicação verifica atualizações e mostra um toast persistente com o botão “Atualizar agora”; até a confirmação, o usuário continua na sessão atual. Ao confirmar, o novo worker é ativado, o cache antigo é removido e a página é recarregada uma vez. README, guia interno e informações da versão foram revisados nesta fase.

- **Cadastro simplificado de embalagens da Farmácia — implementado nesta fase:** o fluxo passou a apresentar opções amplas em lista: unidade avulsa, caixa externa com unidades e caixa externa com caixa interna. Cada opção inclui descrição prática e exemplo de cálculo; o formulário mostra apenas os números necessários e a conferência fica em tempo real. Os nomes e níveis adicionais permanecem disponíveis em Configuração avançada. Ajustes responsivos de alinhamento e documentação também foram revisados, preservando lotes, FEFO, metas, semáforo e propriedades dos cards informativos.
- **Informativos na Visão geral — implementados nesta fase:** a faixa compacta passou a ocupar o espaço ao lado da saudação e do nome. Um comunicado é mostrado por vez; com vários informativos, eles alternam a cada 10 segundos, e usuários com preferência de movimento reduzido permanecem com troca automática desativada. Link externo abre em nova guia, enquanto informativos em texto ficam no próprio cartão. README e ajuda interna foram atualizados. Commit publicado: `9b51c32`.

- **Informativos institucionais em texto próprio — implementado nesta retomada:** além de links externos ou internos, Administrador e Superadministrador podem criar avisos, informações e mudanças de procedimento diretamente no aplicativo. Cada comunicado pode ter título, resumo, texto completo, validade, estado publicado/inativo e link opcional. Informativos puramente textuais são exibidos sem botão externo. README e guia de ajuda foram atualizados. Typecheck, build frontend e compilação Python passaram; a migração `0067_app_announcement_content` foi confirmada em SQLite com URL anulável e campos `content`/`kind`. Commit e push desta retomada ainda serão registrados.

- **Cadastro visual de embalagens da Farmácia — implementado nesta fase:** o cadastro ganhou seleção direta para unidade avulsa, caixa externa e caixa externa com caixa interna, com cálculo automático da unidade base. O Inventário ganhou seletor visual para mostrar saldo em caixa externa, caixa interna ou unidade, preservando lote, validade, FEFO e semáforo de metas. README, ajuda e documentação do módulo foram atualizados nesta fase.

- **Validação operacional posterior ao commit eb9faa3:** relógio confirmado sincronizado via `timedatectl`, timezone `America/Sao_Paulo (-03)`, Docker Engine acessível e os 12 containers em execução. A validação funcional de login MFA continua exigindo interação real com o servidor/conta TOTP e ainda deve ser feita antes das migrações em dados reais. Nenhuma migração de dados reais foi aplicada nesta etapa.

- **Backups institucionais — implementados nesta fase:** `/backups` passou a ser o destino padrão do Compose, mantendo `SCPO_BACKUP_HOST_DIR` configurável pela TI. O backup automático ganhou modo por senha AES-GCM, mantendo GPG legado compatível, além de limite máximo em GB com remoção dos arquivos próprios mais antigos. Documentação, interface de configuração e testes foram atualizados.

- **Revisão do cadastro da Farmácia — implementada nesta fase:** o cadastro passou a usar padrões simples (`unidade` na compra e na unidade base) e mantém a hierarquia de embalagens em um ajuste opcional. O fluxo continua compatível com lotes, recebimentos, saldo, compras, movimentações, FEFO, prescrições e dispensação. A guia “Como funciona” foi reescrita em sequência semelhante à planilha, separando produto, entrada, lote, validade, embalagem, dispensação e dose clínica. README, ajuda e informações do aplicativo foram revisados nesta fase.

**A próxima operação recomendada continua sendo validar relógio e MFA antes da aplicação das migrações em dados reais.**

- **Feed institucional de informativos — implementado nesta retomada:** a visão geral mostra comunicados autenticados com título, resumo opcional, link, publicação e validade. Superadministrador e Administrador do aplicativo com permissão `administrar` gerenciam informativos nas respectivas abas, em endpoints separados com autorização comum. Não é RSS externo automático; links são revisados e cadastrados internamente. A migração `0066_app_announcements` possui ID de 24 caracteres, passou na checagem Alembic, backend compilou, typecheck passou e o banco sintético criou o esquema pela migração.
- **Atualização automática Anvisa/CMED da Farmácia — implementada nesta fase:** o worker diário ficou configurado às 00:00 em `America/Sao_Paulo` por padrão, com variável para ativar/desativar e ajustar horário/fuso. A atualização manual continua disponível. Sucesso substitui o catálogo em transação; falha preserva o catálogo anterior, registra erro e permite nova tentativa. A migração `0065_anvisa_auto_state` cria o estado persistente e passou a ser aplicada também em SQLite; a consulta de status não falha antes da migração. Os testes focados de parser, refresh manual, preservação de catálogo e limite de arquivo passaram com `uv run`; typecheck e compilação Python passaram. Falta apenas revisão do diff, commit, push e próximo passo operacional.
- **Armazenamento separado da Oficina Terapêutica — ajustado nesta fase:** o Compose passou a usar `/biblio` para a Biblioteca e `/album` para o Álbum como padrão, com variáveis independentes para futuro ajuste (`SCPO_THERAPY_LIBRARY_HOST_DIR`, `SCPO_THERAPY_ALBUM_HOST_DIR` e `SCPO_THERAPY_SEPARATE_STORAGE`). O diretório legado `SCPO_THERAPY_MATERIALS_HOST_DIR` continua disponível como fallback da Biblioteca, evitando migração automática de instalações existentes. O Superadministrador continua podendo configurar subpastas relativas dentro da Biblioteca; em armazenamento separado, o Álbum usa a subpasta `photo-album` correspondente ao disco `/album`, com ajuste planejado para mudanças futuras de caminho-base pela TI. Configuração, backup e documentação foram atualizados. A validação Compose/Python/diff passou; commit e push desta fase ainda serão registrados.
- **Retomada 04/11/2026:** relatórios operacionais da Farmácia publicados em `5261c96`; filtros e atribuição de classificação no Semáforo comportamental foram implementados e validados nesta retomada.
- **Concluído/publicado:** revisão visual dos quadros da Farmácia (`8b045db`); avaliação de escalas graduais sem inventar limites (`9bd9e2b`); revisão do README e do Sobre (`501aff4`).
- **Tentativa bloqueada/publicada:** inspeção da Lavanderia em viewport móvel chegou somente à tela de login porque a API local não estava disponível (`1a0cf38`); repetir após preparar autenticação local.
- **Dashboard concluído e publicado:** disponibilidade global por módulo, modo de manutenção, resumo/atalho de backup, switches on/off e recuperação de erro ao carregar configurações. Commit `47b2b30`; suíte backend, typecheck, lint e build passaram. A inspeção autenticada manual ficou pendente porque a API local de Acesso em `localhost:8002` não está em execução.
- **Biblioteca e Álbum da Oficina — implementados localmente nesta fase:** o Álbum fica entre Biblioteca de imagens e Materiais, com diretórios, pastas e registros próprios, visualização ampliada dentro da guia, upload com percentual real e exclusão com andamento indeterminado. O Superadministrador pode ativar/desativar cada recurso e definir cotas independentes; ambos começam sem limite, e reduções preservam arquivos e bloqueiam novos envios se excederem a cota, conforme preferência definida pelo usuário. A migração `0062_therapy_photo_album_and_media_settings.py` usa o revision ID curto `0062_therapy_album` (até 32 caracteres) e cria os modelos no banco Nursing; o backup automático já inclui o volume inteiro, enquanto o backup manual continua contendo somente os sete bancos. O componente compartilhado de confirmação agora mostra o ícone do app. Testes direcionados, Ruff, typecheck, lint e build passaram; não houve deploy, migração em servidor, E2E ou inspeção autenticada ao vivo.
- **Dashboard publicado** (`47b2b30`): revisão de erros, switches on/off, modo de manutenção, disponibilidade global e resumo/atalhos de backup.
- **Backups:** a correção de layout já publicada em `d3ad178` preserva grids, ordem e quebra responsiva existentes; remove o botão de backup manual duplicado e padroniza o seletor da chave pública. Nesta fase, a impressão digital hexadecimal foi separada visualmente, e o campo de confirmação ocupa uma linha inteira com fonte monoespaçada; typecheck, lint e build passaram. A inspeção autenticada continua pendente devido à API local indisponível.
- **Diagnóstico de sessão e controles globais — causa identificada, correção validada localmente:** os logs do servidor de testes mostram `/api/v1/auth/session` e `/api/v1/auth/status` com HTTP 200, mas chamadas internas a `/internal/v1/auth/introspect` e `GET /api/v1/system-admin/module-settings` com HTTP 503; não confirmam HTTP 404 para os endpoints vistos. A consulta somente de leitura confirmou a revisão `0061_system_module_settings` e a linha global `id=1`, mas seu JSON contém `oversight`, chave legada que o código não aceitava porque não é um controle global atual. Esse descompasso explica os 503 em Acesso e, junto com a tradução de qualquer resposta não-200 para “sessão inválida”, as mensagens enganosas nos módulos. O commit `19b60a7` já publicado corrige a tradução de erro; a compatibilidade com a chave legada agora é aceita sem expô-la como controle global. Testes focados (3) e Ruff passaram. Nenhuma alteração foi feita no banco do servidor.
- **Correção de HTTP 404 na Lavanderia/Rouparia — concluída e confirmada no servidor (03/11/2026):** o frontend chama `/api/v1/laundry/...`, e o serviço Maintenance implementa essas rotas, mas o Caddy de produção não tinha encaminhamento para esse prefixo. A correção adicionou o proxy para Maintenance em `Caddyfile` e `Caddyfile.local`; o proxy Vite já estava configurado. A tabela e a descrição de roteamento foram atualizadas em `docs/architecture.md`. Após o usuário atualizar o Caddy, confirmou que está tudo funcionando. Commit `4537048`; configuração Caddy e Compose validadas localmente.
- **Sessão e controles globais:** o usuário já reconstruiu os serviços de backend e depois `web`/`proxy`; nos logs enviados, autenticação e introspecção aparecem com HTTP 200. Os logs não registraram a chamada nem a falha HTTP 404 de configuração global descrita anteriormente. A causa então encontrada para os HTTP 503 foi a chave legada `oversight`, não aceita pela validação de configurações globais; essa compatibilidade foi corrigida e publicada em `17ab518`. Os erros de sessão foram corrigidos em `19b60a7`. A API de Acesso em `localhost:8002` continua indisponível para reprodução autenticada. Nenhuma alteração foi feita no banco do servidor.
- **Progresso de backup e restauração — implementado:** exportação e restauração usam notificação persistente fixa na tela com progresso; não dependem da rolagem. O usuário informou que o diálogo de restauração anterior ficava fora da área visível até rolar ao topo. A atualização visual será publicada nesta fase e ainda aguarda confirmação no `.216`. A API só entrega o arquivo após criá-lo, portanto a geração segue indeterminada, não numérica.
- **Pré-check do piloto paralelo (autorização recebida; teste de restauração isolada ainda pendente):** o servidor `.216` está no checkout `7a24b41` e `web`/`proxy` foram reconstruídos sem migrações; o usuário confirmou o toast no app instalado. A referência Git defeituosa foi movida para fora de `.git/refs`, preservando seu conteúdo. A janela foi indicada como agora e HTTPS está ativo. Existe backup recente, mas a restauração ainda não foi comprovada. Volumes separados não estão configurados; o usuário autorizou usar provisoriamente o mesmo disco para avaliações. A saída compartilhada mostrava serviços Compose saudáveis e partição raiz ext4 de 136 GiB, com 6,6 GiB usados e 122 GiB disponíveis. O SSH deste ambiente continua sem chave autorizada; nenhum serviço, arquivo, volume ou banco foi alterado por este agente. Antes de validar uma restauração, preservar os bancos ativos e os anexos em caminhos novos e isolados; não restaurar sobre os bancos em uso.
- **PWAs de Manutenção e Higienização concluídos nesta fase:** entradas e manifestos separados, ícones próprios, fila única por app, cache cifrado isolado por equipe/usuário e atualizações de situação limitadas às permissões existentes. A Higienização mantém liberação de leito somente após confirmação do servidor. README, guia de instalação, ajuda interna e roteiro de modernização revisados; validações de typecheck, lint, build e imagem Docker concluídas.
- **Enfermagem móvel concluída nesta fase:** eliminações urinária e intestinal agora ficam visíveis na tela principal da coleta de sinais vitais; os demais dados complementares continuam opcionais e recolhidos. README e ajuda interna revisados; typecheck, lint e build passaram.
- **Gestão Hospitalar / Relatórios concluído nesta fase:** cartões de resumo passaram a usar o padrão compartilhado de indicadores e tons neutros, sem alterar os valores ou o fluxo do relatório. Typecheck, lint e build passaram; inspeção autenticada permanece indisponível nesta máquina.
- **Quadros informativos — layout visual revisado:** corrigida a distribuição dos cinco cartões de Agendamentos e Dietas e alertas, que antes ficavam em uma grade genérica de três mais dois centralizados; agora alinham cinco colunas em telas amplas e refluem para três, duas ou uma coluna. Os seis indicadores de Manutenção ficam em três colunas em telas amplas e os cartões textuais da Visão geral da Gestão Hospitalar também usam três colunas. Valores e ordem preservados; Chromium confirmou layout em 1280, 960, 760 e 420 px. Commit `081c3f9` publicado; a confirmação autenticada no `.216` ainda depende de atualização.
- **Retomada de usabilidade (03/11/2026) — alterações locais em andamento:** conectividade técnica foi movida para o topo do Dashboard do Superusuário; Biblioteca e Álbum exibem miniaturas clicáveis para ampliar e notificam alterações concluídas com toasts; o formulário de restauração voltou a alinhar arquivo, senha, confirmação e ação em grade responsiva. README e ajuda interna atualizados. `npm run typecheck`, `npm run lint`, `npm run build`, `docker compose config --quiet` e `docker compose build nursing` passaram; testes de layout/CSS ainda pendentes nesta fase.
- **Falha de migração do Nursing — causa identificada e corrigida localmente:** o ID longo `0062_therapy_photo_album_and_media_settings` excedia os 32 caracteres permitidos em `alembic_version.version_num`. O teste `test_revision_identifiers_fit_alembic_version_column` reproduziu a falha. O ID foi encurtado para `0062_therapy_album`; `backend/tests/test_migrations.py` + `backend/tests/test_therapy_reports.py` passaram (38 testes) e Ruff passou. A imagem Docker Nursing foi reconstruída com sucesso. A migração ainda não foi aplicada no servidor.
- **Erro reportado no container `db-1` — sem causa confirmada:** o Compose usa `image: postgres:17-alpine` e não define build para `db`; a validação de Compose e a imagem do serviço Nursing passaram localmente. Solicitar o primeiro erro de `docker compose ps` e `docker compose logs --tail=100 db` (e de `nursing` após a correção) antes de prescrever ação no servidor.
- **Dashboard técnico — decisões de escopo acordadas, implementação pendente:** atividade recente significa interação autenticada nos últimos 5 minutos; dashboard não deve afirmar presença contínua. Coletar séries de recursos somente dos containers/volumes do SCPO, com retenção de 30 dias, evitando Docker socket e acesso global ao host; amostras e gráficos devem ser preenchidos automaticamente com dados reais. Aprimorar os eventos e a visualização de auditoria para Administração/Superusuário, sem logs brutos do host. Mostrar notificações de conclusão para todas as ações que gravam dados ou configurações, mantendo consultas sem toast de sucesso e progresso nas operações que oferecem medida real. Nenhum desses recursos de histórico/presença está implementado ainda.
- **Próximas fases:** concluir e validar esta retomada visual; obter logs exatos dos erros de `nursing`/`db-1`; implementar heartbeat/lista de atividade recente e instrumentação segura de métricas com armazenamento e gráficos/tabelas de 30 dias; aprimorar auditoria e toasts das mutações de forma consistente. A inspeção autenticada da Lavanderia foi confirmada pelo usuário no servidor. A investigação da falha no Chrome/Windows 11 permanece encerrada sem reprodução.

### Concluído e publicado

- O commit anterior já publicado inclui o PWA da Cozinha, o mapa desktop, a porta 7777 e o guia de deploy.
- A configuração `origin` usa SSH para `git@github.com:Garcez7R/SCPO-Connect.git`.
- Nesta revisão, a biblioteca da Oficina recebeu pastas simples, busca, renomeação e movimentação; a exclusão de imagens é confirmada e pastas não vazias não podem ser apagadas.
- O PWA da Enfermagem para sinais usa mg/dL, registra dor/algia como Sim/Não e oferece observações e os dados complementares do módulo de computador em uma seção recolhida até ser aberta. `painPresent` é validado no backend e aparece no histórico de Enfermagem; a fila offline cifrada preserva os novos valores.
- Os resumos da Lavanderia/Rouparia e da Cozinha usam as cores semânticas compartilhadas: andamento para itens em processamento, alerta para pendências clínicas reais, neutro para contagens informativas e positivo quando a pendência é zero.
- O PWA da Enfermagem agora inclui triagem online reutilizando a fila e o formulário existentes. Não salva fila ou rascunho clínico offline. Sinais vitais e verificações horárias mantêm o fluxo offline cifrado já existente.
- O PWA Médico ganhou atalhos móveis para fila e atendimento, busca mais direta e rolagem até a ficha selecionada. Mantém autenticação, APIs e permissões existentes.
- A Visão geral informa “Sem acesso · solicite ao administrador” em cor de alerta acessível para módulos não concedidos.
- Auditoria ganhou filtros por usuário/ação/registro, módulo e período, paginação e ação de verificar a cadeia de hashes.
- Relatórios mostram resumo, origem, horário de atualização e dados com/sem data. Ao filtrar por período, registros sem data deixam de ser incluídos.
- O painel de Gestão Hospitalar exibe a fonte dos indicadores e diferencia pacientes com localização cadastrada da ocupação real do mapa físico de leitos; ocupação percentual usa atribuições físicas e leitos operacionais.
- As seis seções da Enfermagem permanecem em botões/tablist também em telas estreitas, em vez de virar um seletor de lista.
- O formulário de alteração da própria senha tem controles independentes para mostrar/ocultar cada senha e volta ao estado oculto após a troca.
- O instalador Debian 13 cria/preenche automaticamente os segredos obrigatórios do Compose, repara variáveis vazias em `.env` preexistente sem trocar valores preenchidos e preserva token de bootstrap existente. Após inicializar serviços, consulta se bootstrap ainda está pendente e exibe o token no terminal somente nesse caso. README e guia de deploy explicam como guardar o token, evitam uso do `.env.example` vazio, diagnosticam `docker: command not found` e documentam o comando Compose correto (`docker compose up -d --build`).
- O README documenta comandos de build, teste e investigação de falhas. Somente um `resume.md` era rastreável no repositório; este é o ponto único de retomada.
- A auditoria agora registra leituras autenticadas e acompanha filas de outbox; retenção de 365 dias remove somente um prefixo contínuo verificável da cadeia, preservando checkpoint. A retenção não alcança dados clínicos/pacientes.
- Backups automáticos GPG diários usam chave pública confirmada por impressão digital, diretório dentro do volume-base e retenção de 30 dias apenas para arquivos próprios `.rgs`. Incluem bancos, `.env`, dados do Caddy e imagens da Oficina; a configuração física do destino/WORM continua dependendo da TI.
- A restauração isolada entende pacotes automáticos GPG e extrai anexos sem alterar bancos ativos. Para chaves geradas no Superadministrador, a chave privada fica cifrada por senha no volume do servidor e pode ser exportada também cifrada; restauração continua exigindo a senha e procedimento isolado.
- Farmácia: metas mínimas/médias foram movidas do lote para o produto; estoque disponível agrega apenas lotes não vencidos, filtros/alertas contam produtos e a configuração está no Estoque geral. Migração `0057` consolida metas legadas por produto sem somar metas entre lotes.
- Nutrição/Cozinha: guia “Mapa da cozinha” foi renomeada para “Dietas e alertas”; agora o cabeçalho sempre oferece “Abrir painel da cozinha”, inclusive na primeira guia. A lista operacional inicia uma nova avaliação já com o paciente selecionado, com ação exibida somente para quem tem permissão de criação. O PWA mostra resumo real de internados, alergias, dietas ausentes e jejuns, e a impressão inclui a data da avaliação; não armazena dados offline nem registra preparo/entrega.
- A tela de backup/restauração usa popup modal acessível; exportação agora mostra o progresso real do download. Foi criado teste de ida e volta entre o exportador manual e a restauração. Arquivos GPG automáticos são identificados com orientação para o fluxo isolado. Chaves externas continuam sendo importadas somente como públicas.
- Backup manual e agenda do backup automático estão implementados e documentados: exportação `.rgs` por senha; agenda diária, por intervalo, semanal ou mensal; limite de cópias e próxima execução. Mantém o limite máximo de idade de 30 dias e só remove arquivos de backup próprios.
- A restauração `.rgs` não apresentou erro ao usuário e parecia travar. A validação, descriptografia, snapshots e restaurações PostgreSQL agora rodam fora do ciclo HTTP; um endpoint autenticado publica etapas e percentuais para o popup. Teste sintético confirma que o progresso pode ser consultado enquanto uma restauração está bloqueada. Ainda falta o usuário retestar na instalação de `192.168.1.205`; nenhum banco real foi restaurado nesta tarefa e não houve deploy no `.216`.
- PWAs instaláveis em paralelo ao app completo: Enfermagem, Operações, Farmácia, Médico e Cozinha têm `id`, URL de início e escopo próprios. Cada um recebe ícones PNG com a marca SCPO e um símbolo do módulo, inclusive o ícone de início do iOS; os dez tamanhos 192/512 são gerados por `node scripts/generate-pwa-icons.mjs` com `pngjs`. O service worker inclui as imagens no precache. README e ajuda interna explicam instalação e limitações entre navegadores; a instalação simultânea ainda precisa ser confirmada nos dispositivos móveis institucionais.
- O instalador Debian 13 agora escreve `/etc/systemd/system/scpo-connect.service`, valida a configuração Compose, habilita o serviço e o inicia após a instalação. A unidade inicia o Compose no boot, reinicia em falha e usa `docker compose stop` ao encerrar sem apagar volumes. README e guia do servidor documentam verificação e controle com `systemctl`. A unidade foi validada estaticamente; a instalação permanece para execução autorizada em um servidor Debian 13.
- Lavanderia/Rouparia: módulo desktop e PWA instalável em `/laundry.html`, com identidade e ícone próprios. Inclui catálogo de itens, abertura de solicitações, etapas de coleta/lavagem/devolução, atribuição de responsável, saldos rastreados por movimentações e auditoria no serviço de Manutenção existente. Migração e testes de domínio passaram; typecheck, lint e build também passaram. A instalação precisa ser conferida em dispositivos de teste; não houve deploy.
- A Enfermagem (desktop e PWA) agora mantém o seletor em “Selecione um paciente” até a escolha explícita; ao atualizar, preserva a escolha ainda válida e limpa a referência se ela não estiver mais disponível. O menu lateral põe Visão geral primeiro, os demais itens em ordem alfabética, Administração ao final e Superusuário por último somente para a conta superadministradora. Os cartões da Visão geral seguem a mesma ordem, com Administração por último e borda esquerda azul no padrão dos cartões operacionais.
- O build Docker frontend agora copia também `laundry.html` para o estágio Vite; o build local e `docker build -f Dockerfile.frontend ...` foram concluídos com sucesso, incluindo `dist/laundry.html`.
- A saudação da barra superior agora tem maior destaque visual (13 px, negrito e cor de texto principal); mantém o comportamento responsivo anterior, sem ocupar espaço da barra em telas estreitas.
- Recepção: os resumos de Agendamentos e Admissões/Leitos agora seguem os cartões de status usados nos demais módulos, com borda lateral e layout responsivo. Incluem contagens reais do período consultado e do cadastro; o indicador de leitos livres vem do mapa e mostra indisponibilidade/estado de carregamento sem converter falha em zero.
- Backup manual: a exportação `.rgs` por senha já existia, mas estava abaixo da configuração automática. Agora há um atalho no cabeçalho e uma seção de exportação imediata que exige somente a senha e oferece o download. O guia, README e documentação de backup descrevem o caminho e os limites; o teste sintético de ida e volta no backend já valida exportação e restauração.
- A configuração flexível do backup automático está publicada e tem testes para retenção, execução diária, intervalos, semanas, meses e atualização da agenda.
- Lavanderia/Rouparia: o PWA foi adaptado para uso mobile-first, prioriza a fila com formulário de nova solicitação recolhível, mantém navegação horizontal e adapta cartões, campos e ações para toque/telas estreitas. README e guia do app foram atualizados. Typecheck, lint e build passaram; a inspeção visual autenticada ficou pendente porque os serviços de API locais responderam 502 e não foi possível sair da tela de login.
- Ações de acesso móvel: os botões de Enfermagem, Higienização, Manutenção, Médico e Farmácia identificam o módulo no celular pelo nome, sem usar o termo técnico “PWA”. Títulos e ajuda visíveis também usam linguagem direta; a sigla permanece somente nos termos internos de busca. Typecheck, lint e build passaram.
- Cartões de resumo: os resumos de Enfermagem, triagem, Recepção, sala de espera, agendamentos, exames e Oficina Terapêutica agora usam borda lateral e tons semânticos compartilhados. Estados em andamento usam progresso; pendências usam atenção; ausência de pendências usa sucesso; totais sem juízo ficam neutros. Typecheck, lint e build passaram. A revisão do restante das abas continua pendente.
- Nutrição/Cozinha: o ícone de Nutrição foi movido para o lado esquerdo do cabeçalho, antes da identificação e do nome do módulo, seguindo o padrão dos demais módulos; o atalho para o painel da cozinha permanece à direita.
- Oficina Terapêutica: reorganizadas as guias para Atividades e calendário, Lista de presença, Biblioteca de imagens, Materiais e Relatórios. A biblioteca e o controle de estoque agora aparecem em guias distintas, sem misturar suas telas.
- Oficina Terapêutica: atividades e participantes agora carregam independentemente e exibem o erro por origem sem descartar a consulta bem-sucedida. Materiais e imagens consultam somente o serviço da guia ativa; a biblioteca também mostra estado explícito de carregamento em vez de parecer vazia durante a requisição.
- Cópias de segurança: o seletor de arquivo de restauração mantém o estilo de botão secundário do app, agora com ícone de envio e rótulo acessível para leitores de tela.
- Usuários e permissões: o título do cabeçalho agora identifica o módulo Administração, em vez de repetir o nome da guia ativa; a descrição continua contextualizada.
- Sobre e conformidade: o quadro do logotipo agora tem dimensões quadradas explícitas e responsivas, e os cartões de “Como o sistema funciona” deixaram de herdar a altura mínima dos cartões legais, aproximando-se dos itens compactos de dúvidas.
- Central de Exames: terceira guia renomeada para “Exames laboratoriais”; cabeçalho, fila vazia e guia de ajuda distinguem Raio X, Eletrocardiograma e laboratório. As consultas de pacientes e solicitações agora falham independentemente, com erro explícito e sem representar indisponibilidade da fila como ausência de exames.
- Serviço Social: adicionados cartões de visão rápida com total de encaminhamentos, abertos, em acompanhamento e prioritários ativos; os valores vêm da fila carregada e mostram estado de carregamento/indisponibilidade, sem converter falha em zero.
- Psicologia/Psiquiatria: a fila de acolhimento exibe totais aguardando triagem, em atendimento e prioritários ativos, separados pela área selecionada. A contagem foi removida do rótulo da guia para evitar duplicação; falha ao carregar não aparece como fila vazia.
- Médico: a fila de triagens exibe totais aguardando avaliação, chamados, em atendimento e prioritários. Os cartões usam estados reais da fila, adotam quatro colunas no desktop e duas em telas estreitas; uma falha de atualização não exibe zeros nem uma fila vazia enganosa.
- Auditoria dos resumos operacionais: revisadas as filas de Serviço Social, Psicologia/Psiquiatria e Médico, e conferidos os resumos já existentes em Enfermagem, Farmácia, Recepção, Central de Exames, Oficina Terapêutica, Manutenção/Higienização, Lavanderia/Rouparia e Cozinha. Cada indicador novo usa dados da fila correspondente; telas sem fila ou fonte adicional útil não receberam cartões redundantes.
- Painel de chamadas: a Recepção pode chamar o responsável cadastrado ou informar o acompanhante presente. A escolha fica vinculada à chegada/agendamento e só é divulgada no painel público como “Acompanhante: primeiro nome · Paciente: primeiro nome”; a fila pública não recebe nomes completos nem outros dados pessoais.
- Indicadores executivos e agenda: contagens e percentuais informativos usam tom neutro; estados de sucesso/andamento aparecem somente quando existem registros correspondentes e a consulta está disponível. Disponibilidade zero de leitos sinaliza atenção. Typecheck, ESLint e build passaram, executados sequencialmente.
- Recepção/Exames/Psicologia-Psiquiatria: conferidos os tons dos resumos; status de fila, alerta e andamento correspondem aos registros reais. No pronto atendimento, “Concluídos” só recebe tom positivo quando a contagem é maior que zero. As demais regras revisadas permaneceram sem mudanças. Typecheck, ESLint e build passaram, executados sequencialmente.
- Revisão de cartões/indicadores: concluída a conferência dos resumos do app. Contagens/status vazios não recebem sinal positivo ou de alerta por padrão; estados positivos e de atenção dependem dos dados. Na Farmácia, alertas sem produtos ficam neutros; na Cozinha, zero alergias conhecidas não implica confirmação clínica e jejuns programados sinalizam atenção; contagens informativas da Oficina, Gestão e Recepção ficam neutras. Typecheck, ESLint e build passaram, executados um por vez.
- Tema e diálogos: no tema escuro, o estado vazio usa a superfície do tema; login e diálogos/popups mantêm cores claras, inclusive campos internos e confirmações. Os diálogos de beta e progresso de backup agora aplicam o papel acessível ao painel, não ao overlay de tela inteira. Typecheck, ESLint e build passaram, executados um por vez; E2E e deploy não foram executados.
- Superadministrador: agora gera um par GPG RSA 3072 para o backup automático. A chave privada é protegida pela senha escolhida e armazenada no volume do servidor; a senha não é salva. A interface baixa uma cópia privada ASCII-armored ainda cifrada, exige confirmação da impressão digital antes de substituir uma chave pública existente e audita geração/exportação sem registrar a senha. Testes sintéticos validam geração, proteção, autorização, exportação e rejeição de senha incorreta. O volume de chave protegida no mesmo servidor não substitui custódia independente.
- Backup: o botão do cabeçalho agora leva diretamente à senha de exportação manual, com rolagem e foco explícitos; os campos da agenda automática alinham pelo topo para que opções condicionais não desloquem os demais controles.
- Conexão dos módulos: o cabeçalho da aplicação indica verificação, serviço conectado ou indisponibilidade da API associada ao módulo ativo. Rotas de saúde separadas nos proxies Caddy consultam apenas a resposta mínima de cada backend, sem ler dados clínicos ou gerar eventos de auditoria. Enfermagem e Operações móveis já tinham verificação de serviço; Cozinha agora usa a mesma verificação e Farmácia, Médico e Lavanderia/Rouparia também a exibem.
- Acesso por perfil: cartões de módulos sem permissão agora são acionáveis e abrem uma tela explicativa com o nome da área, orientação para solicitar acesso e confirmação de que nenhum dado do módulo foi carregado. A navegação e as autorizações de dados continuam bloqueadas.
- Enfermagem: no celular, os atalhos do cabeçalho permanecem em uma única faixa rolável e aparecem antes do campo de busca do paciente, sem quebrar a navegação em várias linhas.
- Recepção: linhas de chamada ficaram mais espaçosas, com nome, situação e ações ampliados para facilitar a leitura e o toque. O botão de cadastrar paciente na Ficha ambulatorial mantém alinhamento com o campo no desktop e ocupa a largura disponível no celular.
- Credenciais temporárias: toda conta comum recém-criada recebe a senha padrão `0000`, conforme orientação institucional; os resets individual e global também usam `0000`. A troca de senha continua obrigatória no primeiro login, e o MFA previamente cadastrado é mantido. O bootstrap do superadministrador permite escolher a senha pessoal e já tem controles independentes para revelar/ocultar senha e confirmação; isso foi confirmado e documentado. Teste direcionado cobre senha inicial e troca obrigatória.
- Armazenamento: na Administração do Sistema, o Superadministrador pode escolher uma subpasta dentro do volume montado para backup e outra para a Biblioteca de imagens da Oficina Terapêutica. A mudança da biblioteca move as imagens já cadastradas e mantém os registros. Caminhos são relativos e confinados ao volume configurado; a TI ainda monta os volumes locais/rede no host, concede permissões e reinicia os serviços quando necessário. O app não monta dispositivos nem compartilhamentos. Backups automáticos continuam incluindo os arquivos da biblioteca.
- A busca no repositório encontrou somente um `resume.md`; este arquivo é o ponto único atualizado.

### Publicado nesta retomada

- Commit `98fc041` (`feat: add shared patient history and technical dashboard`) já foi enviado para `origin/main`.

- Prontuário compartilhado: cadastro provisório iniciado na Recepção, vínculo ao cadastro definitivo sem reescrever históricos e evolução clínica append-only; o endpoint médico agora exige permissão de criação. Testes focados passaram na execução anterior desta fase.
- Enfermagem/glicemia: unidade de entrada padronizada em mg/dL; a escolha de unidade foi removida da triagem e os registros históricos em mmol/L são convertidos na exibição de tabelas, gráficos, histórico e fila médica, além de compatibilizar fila offline antiga ao sincronizar. A API preserva o suporte legado sem reescrever dados.
- Superusuário: o dashboard técnico é a primeira guia e mostra versão do app, número de contas comuns, atalhos e estado de nove endpoints de saúde. O estado conectado só comprova resposta HTTP/API, não a disponibilidade dos bancos ou dos dados. Os formulários/status do backup foram reorganizados para usar melhor a largura disponível.
- Credenciais: Administração informa a senha inicial institucional `0000`; a ajuda interna e o resumo mantêm essa orientação e não mencionam geração aleatória.
- Oficina Terapêutica: falhas de carregamento já expunham a mensagem da API; agora a tela oferece retentativa explícita para falhas de carregamento. Nenhum erro concreto de execução foi fornecido nesta retomada, portanto não foram feitas correções especulativas no domínio. Se os erros persistirem, registrar a mensagem completa e o fluxo que a reproduz para corrigir a causa.
- Validação do commit acima, um comando por vez: `npm run typecheck`, `npm run lint`, `npm run build`, `uv run --group dev pytest backend/tests/test_nursing.py backend/tests/test_therapy_reports.py` (67 passaram) e `uv run --group dev pytest backend/tests/test_migrations.py` (25 passaram). O build mantém o aviso conhecido de chunk principal maior que 500 kB. `git diff --check` passou.

### Concluído nesta retomada — uniformização visual dos quadros da Farmácia

- O resumo do estoque mantém os mesmos indicadores e semântica, ganhou nome acessível de grupo e estado de carregamento (`aria-busy`); os cartões acompanham o movimento/hover dos níveis de estoque e a apresentação usada em Gestão Hospitalar. As regras responsivas existentes para desktop e telas estreitas foram revisadas.
- README e ajuda interna (`HelpGuide`) foram revisados; como a fase é somente visual e não altera o uso, não houve conteúdo de instrução pertinente a acrescentar.
- `npm run typecheck`, `npm run lint` e `npm run build` passaram, executados um por vez. O build mantém o aviso conhecido do Vite sobre o chunk principal maior que 500 kB. A inspeção foi de código/CSS responsivo; não foi feito teste visual autenticado nem E2E, que permanecem pausados.
- Arquivos da fase: `src/pages/PharmacyPage.tsx` e `src/app.css`; fase publicada em `8b045db` (`fix: polish pharmacy inventory summaries`).

### Avaliação concluída — escalas graduais vermelho-verde

- Não foi aplicada escala contínua. Percentual de ocupação usa leitos físicos operacionais, mas não há faixas de avaliação aprovadas; os demais indicadores executivos são contagens ou estados operacionais, não medidas com limites graduais validados.
- Os níveis da Farmácia já usam estados crítico/atenção/adequado baseados no mínimo e na meta média configuráveis por produto. A API e o formulário aceitam esses limites sem validar que o mínimo seja menor ou igual à meta média; usá-los como extremos de um gradiente poderia produzir sinal inconsistente. Não criar cores contínuas antes de definir e validar essa regra.
- README e ajuda interna foram revisados; não há instrução nova enquanto nenhuma escala for aprovada ou implementada.
- Nenhum código mudou nesta avaliação; a conclusão e o próximo passo ficam registrados neste resume.

### Revisão móvel da Lavanderia — bloqueada por indisponibilidade da API local

- Após a publicação, a página local `/laundry.html` respondeu; a simulação de viewport móvel foi ajustada para 390×844. A tela ficou na autenticação porque `/api/v1/auth/session` e `/api/v1/auth/status` retornaram 502 (`ECONNREFUSED` em `127.0.0.1:8002`).
- Não foi possível revisar a interface autenticada. Nenhum E2E ou acesso ao servidor de testes foi realizado; a instância temporária de Vite foi encerrada sem alterar a instância HTTPS existente.
- README e ajuda interna foram revisados; as instruções atuais de acesso e uso móvel continuam corretas, sem atualização necessária.
- Retomar a inspeção visual autenticada quando a API local de autenticação e uma sessão de teste estiverem disponíveis.

### Concluído nesta retomada — revisão do README, Sobre e Conformidade

- README atualizado para incluir Lavanderia/Rouparia na lista de PWAs e áreas de trabalho, esclarecer que seus fluxos usam o backend de Manutenção e evitar conflito entre Vite e Caddy na porta padrão `7777` (com alternativa local `7778`).
- “Como o sistema funciona” agora cita Lavanderia/Rouparia. A ajuda interna específica do módulo já correspondia ao uso atual; as referências legais permanecem informativas e sem alegação de conformidade institucional.
- `npm run typecheck`, `npm run lint` e `npm run build` passaram, executados um por vez. O build mantém o aviso conhecido do Vite sobre o chunk principal maior que 500 kB.
- Arquivos alterados: `README.md` e `src/App.tsx`; o resumo registra a revisão documental. Não foram alteradas referências legais.

### Concluído nesta retomada — ciclo de sessão e remoção de referências a Zentyal

- O refresh da sessão já renova a validade de 12 horas enquanto o app está visível e conectado; falhas são exibidas e tentadas novamente, e 401/403 encerram a sessão. O teste direcionado `uv run --group dev pytest backend/tests/test_domain_services.py -k session_refresh_renews_expiration` passou.
- A mensagem de expiração agora contempla prazo atingido ou sessão revogada. Typecheck, lint e build passaram, executados sequencialmente.
- O guia de integração adiada com Zentyal foi removido; consumidores dos documentos foram atualizados para descrever a autenticação local atual. A busca não encontrou referências restantes no código nem na documentação ativa; as menções neste resume apenas registram a remoção.
- Não foi possível reproduzir tela branca/instabilidade no Chrome/Windows 11 neste ambiente Linux; não foi fornecida mensagem de erro nem sequência de reprodução. A investigação específica fica condicionada a evidência reproduzível, sem correção especulativa.
- README, guia de permissões e ajuda interna foram revisados; a ajuda sobre sessão informa que a renovação requer app visível e conectado.
- Esta fase reuniu os ajustes de sessão/documentação com este `resume.md` e excluiu o `RESUME.md` legado conforme solicitado.

### Concluído nesta retomada — atividade recente no Dashboard técnico

- Adicionado registro de atividade somente após interação autenticada explícita, limitado a no máximo um registro por minuto. Não se registram rotas, endereços IP nem conteúdo clínico; não há heartbeat em segundo plano que prolongue artificialmente a atividade.
- O Superadministrador consulta, com auditoria, as contas ativas na janela móvel de cinco minutos. A nova tabela usa a migração `0063_user_activity`, posterior a `0062_therapy_album`, com índice para a consulta; nenhuma migração foi executada em servidor ou dados reais.
- README e ajuda interna foram revisados. Validações sequenciais passaram: `backend/tests/test_domain_services.py` (72), `backend/tests/test_migrations.py` (25), `backend/tests/test_therapy_reports.py` (13), Ruff, `npm run typecheck`, `npm run lint`, `npm run build` e `git diff --check`.
- Fase publicada em `b8199d6` (`feat: track recent authenticated activity`) e enviada para `origin/main`.

### Concluído nesta retomada — indicadores do Superusuário e Oficina Terapêutica

- Os três indicadores do Dashboard técnico agora usam os cartões neutros compartilhados com Gestão Hospitalar, com cor, entrada e hover do padrão do app. Os cinco indicadores da Oficina Terapêutica seguem o mesmo visual semântico e continuam em linhas responsivas (três mais dois em telas largas; colunas menores em telas estreitas).
- O controle de modo de manutenção agora alterna somente pelo switch; clicar no texto ou no restante do cartão não altera o modo.
- Toasts comuns de sucesso/informação fecham automaticamente; erros ficam abertos até ação explícita e o texto pode ser selecionado/copíado. Progresso persistente continua sem timeout.
- README e ajuda interna foram revisados. Typecheck, lint e build passaram; a inspeção visual autenticada continua indisponível neste ambiente.
- Fase publicada em `bc27834` (`fix: align technical and therapy summary cards`); checkpoint em `687892e`.

### Verificação da próxima tarefa — sinais vitais no PWA da Enfermagem

- “Eliminação urinária” e “Eliminação intestinal” já aparecem na tela principal, fora da seção recolhida, e permanecem opcionais. A conferência confirmou que `additionalVitals` entra em `values` no mesmo payload online e na fila offline cifrada; os demais campos adicionais continuam no formulário.
- O teste direcionado `backend/tests/test_nursing.py -k vital_elimination_and_venous_access_choices_are_restricted` passou. Nenhuma alteração de código foi necessária.
- README e ajuda interna foram revisados. A tarefa está concluída.

### Verificação da próxima tarefa — PWAs de Manutenção e Higienização

- A separação já está implementada: `/maintenance.html` e `/hygiene.html` têm entradas, manifestos e ícones próprios; cada PWA recebe um `serviceScope` exclusivo e consulta somente sua própria fila.
- O cache offline é cifrado e particionado por serviço/usuário (`operations:<serviceScope>:<user.id>`), com validade de até 24 horas. A interface desativa atualizações sem conexão e limita consultas/alterações pelas permissões existentes; Higienização aguarda confirmação do servidor para liberar leitos.
- As rotas dedicadas do backend validam perfis e permissões; a criação de ordens de serviço não foi duplicada. Esta tarefa já havia sido concluída/documentada em fase anterior; a entrada duplicada na lista pendente foi removida.
- Testes direcionados dos fluxos existentes passaram: `backend/tests/test_domain_services.py -k 'hygiene_requests_have_a_dedicated_assignable_queue or hygiene_bed_turnover_blocks_until_completed or hygiene_is_not_created_as_a_maintenance_order'` (4 passaram).

### Verificação da política offline de módulos

- Enfermagem consulta a disponibilidade global ao reconectar; quando o módulo está desligado, apaga os snapshots de leitura e conserva somente ações ainda não sincronizadas, cifradas e dentro do prazo de 24 horas. A sincronização automática pausa durante a manutenção ou indisponibilidade do módulo.
- Manutenção e Higienização mantêm vaults independentes por serviço/usuário, sem fila de escrita offline; desativar um módulo remove os registros de leitura correspondentes e bloqueia a tela. Atualizações de situação exigem servidor disponível.
- Comportamentos existentes conferidos diretamente em `NursingMobilePage.tsx` e `OperationsMobilePage.tsx`; nenhuma alteração adicional foi necessária.

### Avaliação da próxima tarefa — métricas históricas do Dashboard

- Busca no código confirmou que ainda não existem coletor nem retenção de séries. Os health checks só mantêm estado atual em memória; o serviço de Backup expõe o último resultado e uso do volume de backup, não histórico geral.
- O Compose não concede Docker socket a nenhum serviço. Também não há montagem do volume PostgreSQL para um coletor nem uma fonte atual de CPU/memória por container. Não exibir valores estimados nem afirmar que métricas de uma única aplicação representam o container inteiro.
- Tamanhos de banco podem ser consultados no PostgreSQL e capacidade/uso de volumes controlados pelo app pode ser medido em caminhos conhecidos; CPU/memória por container exige escolher e validar uma fonte isolada (por exemplo, cgroup v2 de cada container) antes da implementação.
- Nenhuma alteração foi feita para não introduzir acesso amplo ao host ou métricas sem fonte confiável. A implementação aguarda decisão sobre o escopo/fonte de CPU e memória.

### Concluído nesta retomada — controles e contraste no modo escuro

- Controles de disponibilidade dos módulos agora alteram o estado somente pelo switch; clicar no texto/restante do cartão não aciona a mudança. O modo de manutenção mantém o mesmo comportamento.
- Ajustado o contraste dos switches e do cartão de manutenção no tema escuro, assim como dos botões móveis para abrir/fechar o menu lateral.
- Ícones dos toasts agora mantêm fundo branco também no tema escuro, no mesmo padrão dos demais ícones do app.
- README atualizado com a forma de acionar os controles. A ajuda interna não possui uma seção específica de Administração do Sistema; a ajuda da Oficina já descreve toasts e foi revisada.
- Typecheck, lint e build passaram para os controles e para o fundo branco dos ícones de toast.
- Implementação publicada em `cf496b8` (controles), `02c7e48` (ícones de toast) e `28eb531` (checkpoint).

### Concluído nesta retomada — configurações de armazenamento da Oficina Terapêutica

- A configuração permanece no Dashboard técnico, junto dos controles de ativação e cotas, e agora permite escolher subpastas independentes para Biblioteca e Álbum. Cada alteração exige confirmação e move somente os arquivos cadastrados do acervo selecionado; os destinos iguais são rejeitados. A API ainda aceita a propriedade antiga `directory` e mantém chaves de resposta legadas para compatibilidade.
- O caminho-base continua sob responsabilidade da TI por `SCPO_THERAPY_MATERIALS_HOST_DIR`; a aplicação aceita somente subpastas relativas ao volume montado. A variável no `.env` local (ignorado pelo Git) foi ajustada a pedido do usuário para `/biblio`. O diretório não existe neste host; nenhuma montagem, criação de pasta ou alteração de servidor foi realizada. Antes de usar localmente ou em produção, a TI deve preparar e montar o volume no host correspondente.
- README, ajuda interna e guia de backup foram atualizados. `uv run --group dev pytest backend/tests/test_therapy_reports.py` (13 testes), Ruff direcionado, `npm run typecheck`, `npm run lint` e `npm run build` passaram; o build mantém o aviso conhecido do chunk principal grande. Nenhuma migração de banco foi necessária.
- A necessidade transversal de filtros e relatórios foi solicitada para as telas que comportarem esse tipo de consulta, incluindo Pacientes; a implementação incremental começa na seção seguinte.

### Concluído nesta retomada — filtros e relatório da guia Pacientes

- Pesquisa e filtros de situação, internação/sem internação, quarto, leito, perfil de tratamento, sexo e faixa de nascimento agora aparecem tanto na lista como na guia Relatórios; ambos usam os mesmos parâmetros do servidor. A lista mantém paginação, ordenação e agrupamento por quarto.
- O relatório inclui cadastro, nascimento, sexo, acomodação, situação e informações autorizadas; permite intervalo de datas, busca, seleção e impressão total/parcial pelo painel compartilhado. Filtros de sexo e nascimento são bloqueados pela API sem acesso aos dados cadastrais completos.
- README e ajuda interna foram atualizados. `uv run --group dev pytest backend/tests/test_nursing.py` (58 testes), Ruff direcionado, `npm run typecheck`, `npm run lint`, `npm run build` e `git diff --check` passaram.
- Próxima fase: mapear os módulos com relatórios/filtros existentes e avançar pelo próximo fluxo operacional que se beneficie de filtros e relatório, preservando permissões e sem incluir dados clínicos sem necessidade.

### Concluído nesta retomada — filtros e relatório do Serviço Social

- Encaminhamentos agora podem ser filtrados por busca, situação, prioridade, categoria, responsável e faixa de prazo de retorno; o mesmo conjunto de filtros fica disponível na fila e na nova guia Relatórios.
- O relatório permite refinamento adicional por período/busca, seleção e impressão usando `PrintSelectionPanel`. Inclui apenas metadados do encaminhamento e próxima ação; a ajuda orienta manter esse texto sem conteúdo clínico. Erros de carregamento não aparecem como relatório vazio bem-sucedido.
- README e ajuda interna foram atualizados. `npm run typecheck`, `npm run lint` e `npm run build` passaram; build mantém o aviso já conhecido de chunk maior que 500 kB. Não houve mudança de backend, migração ou acesso a dados reais; E2E segue pausado.
- A preferência de navegação foi refinada: relatório e filtros avançados devem ficar em uma guia própria para evitar excesso de controles nas telas de operação; manter somente filtros rápidos onde ajudam no trabalho diário. Aplicada nesta fase à Central de Exames; avaliar a mesma organização para Pacientes e Serviço Social nas fases seguintes.
- Próxima fase sugerida: avaliar os fluxos da Farmácia e adicionar filtros/relatórios operacionais sem ampliar a exposição de dados clínicos.

### Concluído nesta retomada — guia de relatórios da Central de Exames

- Mantidas as guias por modalidade (Raio X, Eletrocardiograma e Laboratório) e adicionada navegação separada entre Fila e Relatórios. A Fila conserva somente os filtros rápidos de situação/busca; situação, presença de resultado, período, pesquisa e seleção/impressão detalhada ficam na área Relatórios.
- A impressão inclui situação e se há resultado registrado, sem incluir o texto clínico do resultado. Falhas ao carregar solicitações ou pacientes bloqueiam a geração do relatório em vez de mostrar sucesso vazio.
- README e ajuda interna foram revisados. `npm run typecheck`, `npm run lint`, `npm run build` e `git diff --check` passaram; build mantém o aviso conhecido do chunk principal maior que 500 kB. Nenhuma API, migração ou dado real foi alterado; E2E segue pausado.
- Próxima fase: avaliar filtros e relatórios de estoque/movimentações da Farmácia, aproveitando seus dados já existentes e mantendo o fluxo operacional enxuto.

### Concluído nesta retomada — filtros e relatórios operacionais da Farmácia (04/11/2026)

- Adicionada uma guia Relatórios no computador, separada do fluxo operacional, com filtros de estoque por busca, categoria, situação e validade; a impressão de lotes usa os resultados filtrados.
- O histórico de movimentações agora permite filtrar por período local de São Paulo, lote e tipo de operação. A API valida intervalo de datas, mantém paginação, limite máximo de 100 registros e auditoria existente; a impressão identifica claramente que abrange somente a página exibida. Nenhum dado de paciente ou prescrição é incluído.
- README e ajuda interna foram revisados. `backend/tests/test_domain_services.py` (72 testes), Ruff direcionado, teste de limite de identificador Alembic, `npm run typecheck`, `npm run lint`, `npm run build` e `git diff --check` passaram; testes e build foram executados sequencialmente. Nenhuma migração ou alteração de dados reais foi necessária; E2E e deploy permanecem pausados.
- A demanda seguinte do Semáforo comportamental foi tratada na fase documentada abaixo.

### Concluído nesta retomada — filtros e classificação no Semáforo comportamental (04/11/2026)

- Gestão Hospitalar localiza todos os cadastros não excluídos, incluindo internados, pacientes com cadastro inativo/alta e atendimentos sem acomodação. Os registros consolidados por mesclagem não são duplicados. Filtros combináveis incluem nome/quarto/leito, cadastro ativo/inativo, presença de acomodação e classificação; sem classificação aparece explicitamente como “Sem sinalização”.
- Por autorização do usuário, Gestão também pode atribuir uma cor no próprio quadro. A API grava autoria e auditoria e registra somente a classificação administrativa; não retorna nem habilita consulta a observações comportamentais ou outros dados clínicos. Não foi necessária migração.
- README e ajuda interna foram atualizados. O teste direcionado de Enfermagem (1), Ruff direcionado, `npm run typecheck`, `npm run lint` e `npm run build` passaram em sequência. Não houve E2E, deploy ou acesso a dados reais.

### Concluído nesta retomada — operação e relatórios de Pacientes/Serviço Social

- Em Pacientes, a Lista mantém sua busca e filtros rápidos de situação, internação e quarto/leito. Perfil de tratamento, sexo e faixa de nascimento ficam em Relatórios; a busca da Lista e a busca do relatório são independentes, e critérios avançados não são enviados à consulta operacional.
- Em Serviço Social, a fila operacional mantém busca, situação e prioridade. Categoria, responsável e prazo de retorno ficam restritos à guia Relatórios; critérios avançados ocultos não filtram mais a fila.
- README e ajuda interna atualizados. Typecheck, lint, build e `git diff --check` passaram em sequência. Nenhuma API, migração ou dado real foi alterado; E2E e deploy permanecem pausados.
- Próxima fase sugerida: mapear outras áreas que se beneficiem de filtros/relatórios separados, validando utilidade, permissões e ausência de exposição clínica desnecessária antes de implementar.

### Concluído nesta retomada — ciclo de internação e movimentação do paciente

- A revisão identificou que o cadastro central com leito físico selecionado atualizava quarto/leito, mas não criava a ocupação do leito nem o evento de admissão. Agora a atribuição do leito, evento de fluxo e auditoria são registrados junto ao cadastro; conflito de concorrência na ocupação retorna HTTP 409.
- Na Gestão Hospitalar, transferência e alta não são oferecidas para pacientes ativos sem quarto/leito. A Recepção continua criando cadastros ambulatoriais sem internação e internações pelo fluxo que seleciona leito físico.
- README e ajuda interna atualizados. Testes direcionados de cadastro/admissão, transferência/alta passaram; Ruff, typecheck, lint, build e `git diff --check` também passaram em sequência. Não houve migração, E2E ou acesso a dados reais.

### Concluído nesta retomada — guias da Farmácia com botões visíveis

- A Farmácia passa a manter as guias como botões mesmo quando há mais de cinco áreas ou em telas estreitas; no celular, a faixa pode ser deslizada horizontalmente. As permissões e a persistência da guia selecionada permanecem inalteradas.
- README e ajuda interna atualizados. Typecheck, lint, build e `git diff --check` passaram em sequência; build mantém o aviso já conhecido de chunk maior que 500 kB. Não houve alterações de API, migração ou dados.

### Concluído nesta retomada — leitura de QR Code na Farmácia

- A leitura pela câmera aceita QR Code nos navegadores com suporte nativo; quando não há suporte nativo a QR ou à API `BarcodeDetector`, usa o leitor multi-formato ZXing já instalado. Permanecem disponíveis os códigos de barras existentes.
- A consulta continua limitada a identificadores GTIN/GS1 reconhecidos pelo cadastro. Conteúdo QR arbitrário não identifica medicamento nem movimenta estoque automaticamente; a conferência e o registro da operação continuam manuais.
- README e ajuda interna atualizados. Typecheck, lint, build, testes existentes de GS1 (5 passaram) e `git diff --check` passaram; build mantém o aviso já conhecido de chunk maior que 500 kB. Não houve alteração de backend, API, migração ou dados.

### Concluído nesta retomada — quadros e níveis de estoque da Farmácia

- Os quadros informativos usam o padrão compartilhado dos módulos, com resumo separado para lotes/validade e níveis por produto: Normal (verde), Atenção (amarelo), Crítico (vermelho) e Metas pendentes (neutro).
- A classificação mantém as metas configuráveis: acima da meta média é Normal; acima do mínimo e até a meta média é Atenção; no mínimo ou abaixo é Crítico. Produto sem meta média válida deixa de ser classificado incorretamente como crítico apenas por ter mínimo padrão zero; lotes vencidos não compõem o saldo acompanhado.
- README e ajuda interna atualizados. Teste direcionado de níveis de estoque passou; Ruff, typecheck, lint, build e `git diff --check` passaram em sequência. A edição das metas agora exige meta média maior que o mínimo tanto na interface quanto na API; testes cobrem limites iguais/invertidos. O build mantém o aviso já conhecido de chunk maior que 500 kB. Sem alteração de migração ou dados.

### Concluído nesta retomada — impressão e navegação de imagens na Oficina Terapêutica

- Biblioteca e Álbum permitem imprimir a coleção filtrada pela pasta e busca atuais; a impressão mostra somente imagens e títulos, sem controles da aplicação. A visualização ampliada inclui anterior/próxima, posição na coleção e atalhos pelas setas do teclado; os limites desabilitam a navegação além do primeiro/último item.
- README e ajuda interna atualizados. Typecheck, lint e build passaram; a inspeção foi de código/CSS responsivo, sem E2E ou teste visual autenticado. O build mantém o aviso conhecido de chunk maior que 500 kB.

### Revisão concluída — fluxo de medicamentos em Médico, Farmácia e Enfermagem

- Médico registra dose, via, frequência, duração, quantidade e unidade em campos de texto; os horários definidos pelo prescritor são opcionais e não são calculados automaticamente a partir da frequência. Esse comportamento é explicitado na interface e deve ser preservado até validação clínica de qualquer regra diferente.
- Farmácia pré-preenche quantidade e reúne dose/via/frequência/duração nas instruções da dispensação. Sugestão de produto por nome e lote é somente uma correspondência exata para auxiliar; a escolha do lote permanece manual e com conferência de alergias.
- Enfermagem seleciona uma dispensação e registra uma quantidade numérica na unidade do lote, limitando a soma de administrações efetivas ao total dispensado. A tela agora mostra junto ao registro a prescrição vinculada — dose, via, frequência, duração, horários, prescritor e orientações — para conferência contextual, sem calcular ou alterar a dose. Se os dados da prescrição não forem carregados, a ausência fica explícita.
- O backend também contém APIs/modelo para registrar resultados por horário prescrito, com validação e proteção contra duplicidade, mas nenhuma tela frontend os utiliza. Esses registros agendados não estão vinculados aos registros regulares de administração/dose nem à dispensação; integrar ou retirar essa via exige decisão de fluxo e migração/compatibilidade cuidadosas, não é seguro fazê-lo por inferência.
- Testes direcionados existentes dos fluxos de prescrição, dispensação idempotente, dose parcial e registro agendado passaram (4). A melhoria visual não altera comportamento clínico nem estrutura de dados. Para unificar a administração por horário/dose, ainda é necessária validação do responsável clínico sobre relação entre dose prescrita e unidade dispensada, horários explícitos e tratamento de recusa/suspensão.

### Concluído nesta retomada — etiquetas de medicamentos na Farmácia

- Cada lote do estoque permite preparar etiquetas com medicamento, princípio ativo/apresentação quando cadastrados, lote e validade. Largura e altura são ajustáveis (10–200 mm); quantidade rápida de 1, 5 ou 10, ou valor personalizado até 500.
- A impressão usa a janela de impressão do navegador e o usuário seleciona a Zebra ZD220 e o papel correspondente. Não há integração direta nem envio ZPL. Não altera estoque ou rastreabilidade.
- README e ajuda interna atualizados. A impressão física, o alinhamento e a legibilidade ainda precisam ser conferidos com o rolo e o computador institucionais antes de uso operacional.

### Concluído nesta retomada — máscara de pressão na Enfermagem

- O campo de pressão formata automaticamente dígitos em sequência: `12080` → `120/80`. Para sistólica abaixo de 100, pode-se usar zero à esquerda, por exemplo `08570` → `085/70`. A barra digitada manualmente também é aceita.
- O comportamento foi aplicado à coleta assistencial, à triagem e à tela móvel. A máscara apenas apresenta o valor digitado; não interpreta nem modifica a medida.
- README e ajuda interna atualizados; typecheck, lint e build passaram.

### Concluído nesta retomada — movimento dos cartões da Visão geral

- Corrigida a sobreposição de `transform` pela animação de entrada com preenchimento permanente, que impedia a elevação no hover. A animação de entrada agora usa a propriedade independente `translate`, preservando o movimento interativo.
- Dispositivos configurados para reduzir movimento mantêm os cartões estáticos no hover.
- README e ajuda interna atualizados; typecheck, lint e build passaram. A verificação visual autenticada aguarda a disponibilidade do servidor novo.

### Concluído nesta retomada — tema escuro nos PWAs

- Incluído botão de alternância claro/escuro nos cabeçalhos dos PWAs de Enfermagem, Manutenção, Higienização, Farmácia, Médico, Cozinha e Lavanderia/Rouparia, inclusive nas telas de acesso negado ou módulo desativado.
- Reutiliza a preferência `scpo-theme` do aplicativo; alterações entre abas da mesma origem sincronizam via evento `storage`, e a cor do navegador acompanha o tema.
- README e ajuda interna atualizados; validação visual autenticada permanece para quando o servidor novo estiver disponível.

### Concluído nesta retomada — hierarquia de embalagens e guia da Farmácia

- Cadastro de estoque e compras agora aceitam até quatro níveis internos configuráveis até a unidade base. A prévia mostra a multiplicação com os nomes das unidades antes de salvar; a API valida os níveis e calcula o saldo em decimal.
- Hierarquia e unidade de compra padrão ficam no produto; cada pedido e lote preserva sua própria fotografia da conversão. Recebimentos parciais usam e exibem a conta aprovada no pedido. A migração `0064_pharmacy_packaging` converte os fatores históricos e usa revision ID dentro do limite Alembic.
- Criada a guia **Como funciona**, explicando as unidades da embalagem e separando cálculo de estoque da dose prescrita. Médico continua definindo dose, via, frequência e horários; Enfermagem vê a dose prescrita e registra o quantitativo na unidade do lote sem conversão clínica automática. Na Farmácia, a quantidade da prescrição só é pré-preenchida se a unidade coincidir exatamente com a unidade do lote; se divergir, permanece vazia e a interface exige conferência. Atualizados README e ajuda interna.
- GTIN/QR e texto de catálogo não preenchem quantidades. O GTIN `7891317431358` fornecido durante a retomada teve apenas o dígito verificador confirmado; não foi usado para inferir produto ou embalagem.
- Testes direcionados de domínio (76) e migração (25) passaram; Ruff, typecheck, lint e build passaram. Nenhuma migração foi executada no servidor; a validação de dados/implantação fica para o ambiente isolado.

### Implementação iniciada — confirmação responsável e movimento dos quadros

- Cadastro da Farmácia exige confirmação explícita da pessoa responsável antes de aplicar sugestões ou registrar o lote; o usuário autenticado fica associado à ação na auditoria.
- GTIN, GS1, QR, catálogo Anvisa/CMED e dados locais permanecem fontes assistivas. O catálogo baixado pode ser consultado offline após atualização, mas não substitui conferência nem registro ativo.
- Adicionado controle persistente nos acessos rápidos para ativar ou desativar o movimento dos quadros informativos da Visão geral e da Farmácia. Dispositivos com redução de movimento continuam com os quadros estáticos.

## Briefing da retomada — 04/11/2026

### Ajustado nesta rodada
- Consulta assistida por GTIN/GS1, QR, cadastro local e catálogo público Anvisa/CMED.
- Dados encontrados são sugestões; o responsável pela Farmácia confere produto, princípio ativo, apresentação, unidade, lote, validade, embalagem e quantidade antes do cadastro.
- O cadastro exige confirmação explícita na interface e no backend. A origem manual/Anvisa é registrada sem presumir registros ativos ou equivalências clínicas.
- Movimento dos quadros informativos da Visão geral e da Farmácia agora pode ser ativado ou desativado por um controle persistente nos acessos rápidos.
- A preferência é sincronizada entre abas da mesma origem. Em dispositivos configurados para reduzir movimento, os cartões continuam estáticos.
- README, ajuda interna e `resume.md` foram atualizados; o commit publicado é `851514d`.

### Validações da rodada
- Frontend: typecheck passou.
- Frontend: lint passou.
- Backend: 17 testes de Farmácia selecionados passaram em uma única execução focada.
- Migração de Farmácia: testes direcionados passaram.
- Produção: build passou.
- `git diff --check` passou antes da publicação.
- Esses comandos foram mantidos como etapas separadas; não devem ser iniciados em paralelo na VM, pois o VSCode pode travar.

### Pendentes operacionais
- Validar o cadastro assistido com lote real e catálogo atualizado em ambiente autorizado; não usar dados reais fora do processo institucional aprovado.
- Confirmar fisicamente a impressão da Zebra ZD220, incluindo material, adesão, leitura e alinhamento.
- Validar visualmente e autenticadamente a preferência de movimento no servidor/piloto.
- Executar migração `0064_pharmacy_packaging` somente em banco autorizado, com backup verificável.
- Validar conversões clínicas, etiquetas de copos, horários e estados de recusa/suspensão somente com equipe clínica e protocolo aprovado.

### Próxima rodada
- Priorizar serviços isolados do VSCode: uma validação por vez, começando pelo typecheck, depois lint, build e cada seleção de testes separadamente.
- Concluir a restauração isolada e os testes sintéticos no `.216` antes de tocar bancos ativos.
- Investigar HTTP 500 nos uploads da Biblioteca/Álbum usando mensagem completa da API e logs da Oficina Terapêutica; verificar armazenamento e implantação antes de alterar código.
- Retomar a revisão visual autenticada dos backups, dashboards, módulos móveis e preferências no servidor/piloto.
- Revisar migração e dados históricos da hierarquia somente após autorização e backup. Não executar E2E ou deploy sem aprovação explícita.

### Pendente — ordem sugerida

- **Relação entre prescrição e administração — abordagem aprovada em 04/11/2026; separação clínica mantida:** manter distintas a unidade de estoque/dispensação, a apresentação/concentração e a dose clínica. Médico registra dose, via, frequência e horários conforme decisão do prescritor; Farmácia registra produto, lote e quantidade dispensada; Enfermagem confere a prescrição e registra o que efetivamente foi administrado na unidade apresentada. Conversões clínicas, e o tratamento de dose parcial, recusa ou suspensão, só podem ser automatizados com apresentação exata e protocolo institucional validado; nunca deduzir dose pela embalagem, preencher horários ou alterar prescrição. A guia explicativa apresenta essa separação; a integração/alteração clínica continua condicionada à validação do responsável clínico e a uma especificação de estados e compatibilidade histórica.
- **Unificação do fluxo de administração de medicamentos — após validação clínica:** decidir o papel da API/tabela de administrações agendadas e integrá-la com os registros de doses efetivamente administradas, ou descontinuá-la com compatibilidade histórica segura. Definir explicitamente relação entre dose prescrita e unidade dispensada, horários não definidos e tratamento de recusa/suspensão. Não calcular esquemas, sugerir doses ou alterar condutas clínicas automaticamente.
- **Nova solicitação — etiquetas para copos de medicação na Enfermagem (04/11/2026, após validação clínica):** avaliar uma extensão independente para identificar copos durante a preparação/dispensação por horário, eventualmente com dados impressos e campos para preenchimento manual. A linha Zebra ZD2 comporta impressão térmica de etiquetas e conexão USB, mas isso não define um modelo clínico universal nem valida o fluxo assistencial. Antes de implementar, validar com a equipe clínica o fluxo por paciente/horário, os campos permitidos, o que será impresso ou manuscrito, o momento de afixar e as conferências de identificação para prevenir troca de copos. Não tratar a etiqueta como registro de administração nem imprimir lotes de etiquetas clínicas sem fluxo aprovado. Testar legibilidade, adesão e alinhamento no material real.
- **Reinicialização de dados pelo Superusuário — escopo definido, implementação aguardando novo servidor:** limpar os sete bancos operacionais, preservar somente a conta do Superusuário no banco de Acesso e repor as configurações de instalação original; preservar os arquivos enviados (Oficina e protetor de tela), backups e chaves; limpar a auditoria anterior e deixar um evento mínimo da reinicialização. Exigir backup verificável, confirmação reforçada, prevenção de execução acidental, auditoria e recuperação consistente entre os bancos. A fila offline cifrada não pode ser limpa remotamente e pode permanecer nos aparelhos até expirar (24 horas); documentar esse limite. Não executar em produção nem em dados reais. O usuário está preparando o novo servidor; aguardar sua disponibilidade para validar comportamento em ambiente isolado.
- Retomar a revisão da Lavanderia/Rouparia em viewport móvel quando a API local de autenticação e uma sessão de teste estiverem disponíveis.
- **Dashboard do Superadministrador — implementado nesta fase:** disponibilidade global por módulo aplicada nas APIs e na navegação; modo de manutenção bloqueia gravações de contas comuns e preserva consultas, login/recuperação e exportação manual; auditoria das alterações; resumo do backup automático e atalho para exportação; controles visuais on/off com contraste para tema escuro e botão para tentar carregar as configurações novamente após falha. A migração é executada no startup do serviço `access` pelo Compose. Não executar migrações em dados reais sem autorização. A revisão automatizada passou, mas a inspeção autenticada ao vivo ficou bloqueada pela API local indisponível; se o problema persistir após iniciar/reconstruir o serviço, coletar a mensagem exibida e o log do serviço de Acesso antes de alterar o fluxo.
- **Backups e restauração — apresentação:** o markup/CSS atual distribui arquivo, senha e confirmação em duas colunas, com a ação na largura total e quebra para uma coluna em telas estreitas. A conferência visual autenticada permanece bloqueada: nesta retomada, `127.0.0.1:7778` (frontend) e `127.0.0.1:8002` (Acesso) não estavam em execução. Repetir quando a API local e uma sessão de teste estiverem disponíveis.
- **Gráficos — avaliação do Superusuário concluída; demais módulos pendentes:** incluir apenas visualizações que apoiem decisão ou acompanhamento operacional real; não adicionar gráficos só por estética ou para preencher uma aba. No Superusuário, não há ainda série histórica confiável: `ModuleConnectionStatus` guarda apenas o estado atual do health check em memória e o endpoint de backup entrega o último resultado, não um histórico. Portanto, não adicionar gráficos de disponibilidade nem de backups até existir retenção temporal confiável e uma ação operacional associada; não transformar o dashboard em painel clínico. Em módulos clínicos/assistenciais, priorizar gráficos de tendência de sinais vitais já registrados e, onde os dados forem completos e contextualizados, ocupação real de leitos. Em Farmácia, considerar evolução de estoque/alertas por produto somente se ajudar reposição e respeitar lote/validade. Evitar gráficos redundantes de contagens atuais, dados sem série temporal, comparações entre profissionais/unidades sem contexto ou qualquer visualização que exponha informação clínica fora das permissões. Se não houver benefício demonstrável, descartar a proposta.
- **Preferência de navegação para Gráficos (03/11/2026):** quando a aba for implementada, posicioná-la imediatamente após “Dashboard técnico” e antes de “Usuários e permissões” no Superusuário. A posição está definida; o conteúdo continua condicionado a fontes históricas confiáveis e métricas aprovadas.
- **Uploads da Biblioteca e do Álbum — HTTP 500 reportado (03/11/2026):** ao tentar enviar imagens para ambos os recursos, o usuário recebe HTTP 500 Internal Server Error. Investigar a causa com a mensagem completa da resposta e os logs do serviço da Oficina Terapêutica no momento da tentativa; verificar implantação/migração e acesso ao armazenamento antes de alterar o fluxo. Não executar migrações em dados reais sem autorização.
- **Ícones de toast no tema escuro (03/11/2026):** manter o fundo branco do ícone, como nos demais ícones do app. Corrigido localmente; validar e publicar.
- **Dashboard — métricas automáticas (30 dias):** coletar séries a cada 5 minutos (cadência inicial) somente de containers/volumes do SCPO; apresentar gráficos de CPU/memória dos serviços instrumentados, disponibilidade/latência das verificações, tamanho dos bancos e uso/capacidade de volumes que o próprio app controla, além de tabelas com valor atual, pico/limite e horário da amostra. Exibir estados de “coletando dados”, “indisponível” e lacunas sem fabricar valores. Sem acesso ao Docker socket, ao host inteiro ou métricas de infraestrutura fora do escopo de confiança do app. A implementação aguarda a escolha de uma fonte confiável de CPU/memória por container; consultas de banco e armazenamento conhecido, por si sós, não atendem ao escopo completo.
- **Auditoria e notificações de mutação:** aprimorar o resumo/visualização dos eventos administrativos para perfis Administrador e Superusuário, com filtros, autoria, ação, módulo, destino e data/hora legíveis, sem logs brutos de serviços. Emitir toast com o ícone do app para cada mutação concluída; operações em andamento usam progresso apenas quando houver percentual real e estado persistente quando a duração for indeterminada.
- **Filtros e relatórios avançados (solicitado em 03/11/2026):** em andamento por fases. Central de Exames, Farmácia e Pacientes separam filtros operacionais dos relatórios avançados; Serviço Social mantém apenas busca, situação e prioridade na fila, com categoria, responsável e prazo na guia Relatórios. O Semáforo comportamental de Gestão Hospitalar permite localizar cadastros sem revelar observações clínicas. Mapear outras áreas, permissões e benefícios antes de implementar; não expor dados clínicos fora das permissões.
- **Administração do host:** não incorporar terminal web com comandos livres, pois isso exporia execução arbitrária no servidor e aumentaria o risco de comprometimento. Como alternativa futura, avaliar um console operacional restrito e auditado (por exemplo, healthchecks, logs limitados e ações predefinidas de serviço), com autorização institucional e privilégio mínimo. Manter SSH para administração geral do sistema operacional.
- **Funções específicas:** catalogar funções e suas rotas autorizadas antes de criar interruptores granulares; validar o bloqueio no backend, além de ocultar controles na interface. Não confundir esses interruptores com permissões individuais.
- **Chrome/Windows 11 — observação encerrada sem reprodução:** o usuário relata que não houve novas falhas e suspeita de problema momentâneo do PC ao executar uma VM de desenvolvimento em paralelo. Não foi possível confirmar a causa; reabrir a investigação apenas se o problema voltar, registrando versão do navegador/SO, etapa, frequência, mensagem/console e passos seguros para reproduzir.

### Marco posterior — atualização do servidor de testes e piloto paralelo

- **Atualização do `.216` concluída pelo usuário:** o checkout de código `7a24b41` está no servidor e `web`/`proxy` foram reconstruídos sem reiniciar APIs; a Rouparia já havia sido confirmada, e o toast de progresso foi validado. Não houve migração.
- **Próxima etapa do piloto:** validar a restauração do backup em bancos com prefixo novo e diretórios de trabalho/anexos novos, sem substituir os bancos ativos. O usuário autorizou usar o mesmo disco provisoriamente para avaliações, mas dados reais não devem ser usados. E2E ainda exige autorização explícita.
- **Ajuste de usabilidade da restauração:** o usuário reportou que o diálogo de progresso ficava fora da área visível até rolar ao topo. O progresso da exportação e da restauração agora usa a notificação persistente fixa na tela; o alerta de risco e a confirmação destrutiva permanecem no formulário. Aguardando atualização e validação visual no `.216`.
- **Retomada visual (03/11/2026) — fase anterior publicada:** padronizados os cartões da Recepção/Agendamentos, Nutrição/Dietas e alertas, Manutenção e Gestão Hospitalar/Visão geral; alinhadas as ações dos formulários de backup; movido o perfil médico para junto do fluxo de prontuário, removendo um painel inicial redundante; aplicado o ícone do app aos toasts. README e ajuda interna atualizados. `./data/backup-staging` e `./data/therapy-materials` são os caminhos padrão no Compose e são ignorados pelo Git; documentados como locais somente para testes sintéticos no mesmo disco, nunca como cópia externa ou destino de produção. Typecheck, lint e build passaram; aguardando validação visual no `.216`.
- **Relatos novos desta retomada (03/11/2026):** upload de imagem na Biblioteca e no Álbum retorna HTTP 500; diagnóstico fica pendente de mensagem completa e logs da Oficina Terapêutica. O usuário prefere que uma futura aba “Gráficos” fique entre “Dashboard técnico” e “Usuários e permissões”. Também foi solicitado que toasts não relacionados a erros fechem automaticamente, enquanto erros permaneçam abertos para cópia em chamados; ver tarefas correspondentes acima.
- **HTTP 404 após Ctrl+Shift+R — causa encontrada e corrigida localmente:** a mensagem literal identifica a consulta de `/api/v1/app/module-settings`; a rota existe no serviço Acesso, mas faltava encaminhamento para Acesso nos proxies Caddy de produção/local e no proxy Vite. O 404 aparecia no carregamento e não impedia testar os módulos depois de fechar o aviso. Os três proxies agora encaminham `/api/v1/app/*` ao serviço Acesso. Caddy de produção/local, Compose, typecheck, lint e build passaram; aguarda atualização e confirmação do usuário no `.216`. Nenhuma alteração remota foi feita.
- Depois da restauração isolada, validar serviços/healthchecks, persistência após reboot, HTTPS e os fluxos aprovados; registrar necessidades identificadas e ajustes neste resume antes de qualquer decisão de substituir o sistema atual.

## Validações conhecidas

- **Dashboard do Superadministrador (02/11/2026):** `npm run typecheck`, `npm run lint`, `npm run build`, Ruff, `backend/tests/test_migrations.py` (25 testes) e a suíte backend completa (192 testes) passaram. O teste de Psicologia que falhava por mock incompleto foi corrigido para fornecer o formato `references` esperado. A conferência manual autenticada não foi possível: o frontend HTTPS local respondeu, mas a API de Acesso em `localhost:8002` recusou conexão; o certificado HTTPS interno também não é confiável pelo navegador integrado.
- Credenciais: `backend/tests/test_domain_services.py` cobre criação e redefinição individual/global com a senha inicial `0000`, além da troca exigida no primeiro acesso.
- Backend: suíte completa `uv run --group dev pytest` passou (171 testes) após a entrega da Lavanderia/Rouparia; os testes direcionados de backup/RGS passaram com ida e volta e polling. Migração de metas verifica consolidação das metas legadas.
- Backup/RGS: `uv run --group dev pytest backend/tests/test_backup_restore.py backend/tests/test_rgs_format.py` passou com ida e volta do exportador manual e consulta concorrente do progresso durante a restauração, sempre usando dumps sintéticos.
- Frontend: `npm run typecheck`, `npm run lint` e `npm run build` passaram. O build ainda apresenta o aviso do Vite sobre o chunk principal maior que 500 kB.
- Ruff passou nos demais arquivos backend alterados. `nursing.py` ainda tem um aviso preexistente (`UP012`) em linha não modificada; o lint global também aponta um import não usado em `demo_reception.py`, fora do escopo.
- Docker CLI 29.9.2 e Compose v5.6.1 estão disponíveis neste ambiente; `docker compose config --quiet` passou. O build da imagem frontend foi validado em 31/10/2026 após incluir `laundry.html`; não houve deploy/execução de containers do sistema.
- A suíte E2E permanece pausada conforme orientação do usuário.
- O teste direcionado de renovação de sessão passou nesta retomada: `uv run --group dev pytest backend/tests/test_domain_services.py -k session_refresh_renews_expiration` (1 passou).
- O workflow GitHub disponível até o último commit publicado concluiu com sucesso; alterações locais precisam de novo push para que o CI as valide.

## Comandos locais

```bash
cd /home/rgarcez/SCPO-Connect
export PATH="$HOME/.local/bin:$PATH"
npm run typecheck
npm run lint
npm run build
uv run --group dev pytest
```

Execute estes comandos separadamente, um por vez. Não inicie suites ou builds em paralelo na VM, pois o VSCode pode travar. Para backend, execute primeiro seleções pequenas de testes e só amplie a cobertura quando não houver carga concorrente.

Para build de imagens e inspeção dos serviços, em um ambiente com Docker instalado:

```bash
docker compose build
docker compose ps
docker compose logs --tail=100 <serviço>
```

Não execute E2E, deploy no servidor de testes nem migrações em dados reais sem autorização explícita. Não inclua `.env`, tokens, bancos, logs ou dados clínicos no Git.
