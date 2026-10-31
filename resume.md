# SCPO Connect — ponto de retomada

Atualizado em 31/10/2026. Repositório: `/home/rgarcez/SCPO-Connect`, branch `main`.

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
- O instalador Debian 13 cria/preenche automaticamente os segredos obrigatórios do Compose, repara variáveis vazias em `.env` preexistente sem trocar valores preenchidos e preserva token de bootstrap existente. Após inicializar serviços, consulta se bootstrap ainda está pendente e exibe o token no terminal somente nesse caso. README e guia de deploy explicam como guardar o token, evitam uso do `.env.example` vazio, diagnosticam `docker: command not found` e documentam o comando Compose correto (`docker compose up -d --build`).
- O README documenta comandos de build, teste e investigação de falhas. Somente um `resume.md` era rastreável no repositório; este é o ponto único de retomada.
- A auditoria agora registra leituras autenticadas e acompanha filas de outbox; retenção de 365 dias remove somente um prefixo contínuo verificável da cadeia, preservando checkpoint. A retenção não alcança dados clínicos/pacientes.
- Backups automáticos GPG diários usam chave pública confirmada por impressão digital, diretório dentro do volume-base e retenção de 30 dias apenas para arquivos próprios `.rgs`. Incluem bancos, `.env`, dados do Caddy e imagens da Oficina; a configuração física do destino/WORM continua dependendo da TI.
- A restauração isolada entende pacotes automáticos GPG e extrai anexos sem alterar bancos ativos. Restaurar esses pacotes em produção continua exigindo chave privada custodiada e procedimento isolado.
- Farmácia: metas mínimas/médias foram movidas do lote para o produto; estoque disponível agrega apenas lotes não vencidos, filtros/alertas contam produtos e a configuração está no Estoque geral. Migração `0057` consolida metas legadas por produto sem somar metas entre lotes.

## Validações conhecidas

- Backend: suíte completa `uv run --group dev pytest` passou (166 testes); migração de metas por produto verifica consolidação das metas legadas.
- Frontend: `npm run typecheck`, `npm run lint` e `npm run build` passaram. O build ainda apresenta o aviso do Vite sobre o chunk principal maior que 500 kB.
- Ruff passou nos demais arquivos backend alterados. `nursing.py` ainda tem um aviso preexistente (`UP012`) em linha não modificada; o lint global também aponta um import não usado em `demo_reception.py`, fora do escopo.
- Docker CLI 29.9.2 e Compose v5.6.1 estão disponíveis neste ambiente; `docker compose config --quiet` passou. Não foram construídas nem iniciadas imagens/containers: o usuário atual não tem acesso ao socket Docker e o `sudo` exige autenticação interativa.
- A suíte E2E permanece pausada conforme orientação do usuário.
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

Para build de imagens e inspeção dos serviços, em um ambiente com Docker instalado:

```bash
docker compose build
docker compose ps
docker compose logs --tail=100 <serviço>
```

Não execute E2E, deploy no servidor de testes nem migrações em dados reais sem autorização explícita. Não inclua `.env`, tokens, bancos, logs ou dados clínicos no Git.
