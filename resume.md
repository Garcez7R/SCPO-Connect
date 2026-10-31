# SCPO Connect — ponto de retomada

Atualizado em 30/10/2026. Repositório: `/home/rgarcez/SCPO-Connect`, branch `main`.

## Situação da retomada

- O commit anterior já publicado inclui o PWA da Cozinha, o mapa desktop, a porta 7777 e o guia de deploy.
- A configuração `origin` usa SSH para `git@github.com:Garcez7R/SCPO-Connect.git`.
- Nesta revisão, a biblioteca da Oficina recebeu pastas simples, busca, renomeação e movimentação; a exclusão de imagens é confirmada e pastas não vazias não podem ser apagadas.
- O PWA da Enfermagem agora inclui triagem online reutilizando a fila e o formulário existentes. Não salva fila ou rascunho clínico offline. Sinais vitais e verificações horárias mantêm o fluxo offline cifrado já existente.
- O PWA Médico ganhou atalhos móveis para fila e atendimento, busca mais direta e rolagem até a ficha selecionada. Mantém autenticação, APIs e permissões existentes.
- A Visão geral informa “Sem acesso · solicite ao administrador” em cor de alerta acessível para módulos não concedidos.
- Auditoria ganhou filtros por usuário/ação/registro, módulo e período, paginação e ação de verificar a cadeia de hashes.
- Relatórios mostram resumo, origem, horário de atualização e dados com/sem data. Ao filtrar por período, registros sem data deixam de ser incluídos.
- O painel de Gestão Hospitalar exibe a fonte dos indicadores e diferencia pacientes com localização cadastrada da ocupação real do mapa físico de leitos; ocupação percentual usa atribuições físicas e leitos operacionais.
- As seis seções da Enfermagem permanecem em botões/tablist também em telas estreitas, em vez de virar um seletor de lista.
- O formulário de alteração da própria senha tem controles independentes para mostrar/ocultar cada senha e volta ao estado oculto após a troca.
- O instalador Debian 13 cria/preenche automaticamente os segredos obrigatórios do Compose, também repara variáveis vazias em `.env` preexistente sem trocar valores preenchidos e preserva o token de bootstrap se já existir. README e guia de deploy deixam claro para não iniciar com o `.env.example` vazio, explicam `docker: command not found` e documentam o comando Compose correto (`docker compose up -d --build`).
- O README documenta comandos de build, teste e investigação de falhas. Somente um `resume.md` era rastreável no repositório; ele foi substituído por este ponto de retomada.

## Validações conhecidas

- Backend direcionado: `backend/tests/test_therapy_reports.py`, `backend/tests/test_audit.py` e `backend/tests/test_migrations.py` passaram (37 testes na última execução).
- Adicionar/rodar os testes direcionados de Gestão Hospitalar em `backend/tests/test_nursing.py`, que verificam ocupação real do mapa físico e localização legada sem atribuição.
- Frontend: `npm run typecheck`, `npm run lint` e `npm run build` passaram. O build ainda apresenta o aviso do Vite sobre o chunk principal maior que 500 kB.
- Pylance não reportou diagnósticos nos arquivos Python alterados.
- Docker CLI 29.9.2 e Compose v5.6.1 estão disponíveis neste ambiente; `docker compose config --quiet` passou usando um `.env` temporário com segredos descartáveis. Não foram construídas nem iniciadas imagens/containers: o usuário atual não tem acesso ao socket Docker e o `sudo` exige autenticação interativa.
- A suíte E2E permanece pausada conforme orientação do usuário.
- O workflow GitHub disponível até o último commit publicado concluiu com sucesso; alterações locais precisam de novo push para que o CI as valide.

## Comandos locais

```bash
cd /home/rgarcez/SCPO-Connect
export PATH="$HOME/.local/bin:$PATH"
npm run typecheck
npm run lint
npm run build
uv run pytest backend/tests/test_therapy_reports.py backend/tests/test_audit.py backend/tests/test_migrations.py
```

Para build de imagens e inspeção dos serviços, em um ambiente com Docker instalado:

```bash
docker compose build
docker compose ps
docker compose logs --tail=100 <serviço>
```

Não execute E2E, deploy no servidor de testes nem migrações em dados reais sem autorização explícita. Não inclua `.env`, tokens, bancos, logs ou dados clínicos no Git.
