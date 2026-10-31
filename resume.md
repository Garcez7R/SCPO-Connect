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
- Nutrição/Cozinha: guia “Mapa da cozinha” foi renomeada para “Dietas e alertas”; agora o cabeçalho sempre oferece “Abrir painel da cozinha”, inclusive na primeira guia. A lista operacional inicia uma nova avaliação já com o paciente selecionado, com ação exibida somente para quem tem permissão de criação. O PWA mostra resumo real de internados, alergias, dietas ausentes e jejuns, e a impressão inclui a data da avaliação; não armazena dados offline nem registra preparo/entrega.
- A tela de backup/restauração usa popup modal acessível; exportação agora mostra o progresso real do download. Foi criado teste de ida e volta entre o exportador manual e a restauração. Arquivos GPG automáticos são identificados com orientação para o fluxo isolado, sem enviar a chave privada ao app.
- A restauração `.rgs` não apresentou erro ao usuário e parecia travar. A validação, descriptografia, snapshots e restaurações PostgreSQL agora rodam fora do ciclo HTTP; um endpoint autenticado publica etapas e percentuais para o popup. Teste sintético confirma que o progresso pode ser consultado enquanto uma restauração está bloqueada. Ainda falta o usuário retestar na instalação de `192.168.1.205`; nenhum banco real foi restaurado nesta tarefa e não houve deploy no `.216`.
- PWAs instaláveis em paralelo ao app completo: Enfermagem, Operações, Farmácia, Médico e Cozinha têm `id`, URL de início e escopo próprios. Cada um recebe ícones PNG com a marca SCPO e um símbolo do módulo, inclusive o ícone de início do iOS; os dez tamanhos 192/512 são gerados por `node scripts/generate-pwa-icons.mjs` com `pngjs`. O service worker inclui as imagens no precache. README e ajuda interna explicam instalação e limitações entre navegadores; a instalação simultânea ainda precisa ser confirmada nos dispositivos móveis institucionais.
- O instalador Debian 13 agora escreve `/etc/systemd/system/scpo-connect.service`, valida a configuração Compose, habilita o serviço e o inicia após a instalação. A unidade inicia o Compose no boot, reinicia em falha e usa `docker compose stop` ao encerrar sem apagar volumes. README e guia do servidor documentam verificação e controle com `systemctl`. A unidade foi validada estaticamente; a instalação permanece para execução autorizada em um servidor Debian 13.
- A busca no repositório encontrou somente um `resume.md`; este arquivo é o ponto único atualizado.

## Próximas fases solicitadas

- Conferir o posicionamento do ícone nos módulos Manutenção e Higienização.
- Criar o módulo Lavanderia/Rouparia com PWA próprio.
- Aumentar e colocar em negrito a saudação do usuário na barra superior.
- Revisar README, Sobre e Conformidade após as mudanças aplicáveis.
- Revisar a senha provisória `0000` para contas comuns/administradores com troca obrigatória no primeiro login e o botão de revelar senha no bootstrap do superadministrador.
- Confirmar os botões da Enfermagem em linha antes da busca de paciente; revisar alinhamento do botão de novo paciente e ampliar os cartões do painel de chamada.
- Criar prontuário simples e completo compartilhado entre Médico e Enfermagem; permitir cadastro contingencial rápido na Recepção e acompanhar historicamente as fases do atendimento.
- Investigar expiração de sessão, tela branca e instabilidade no Chrome/Windows 11; remover integração Zentyal cancelada com validação dos consumidores.
- Criar controles seguros no Superadministrador para ativar/desativar funções sem remover dados.
- Em Cópias de segurança, padronizar o botão de escolha de arquivo com os botões do app.
- Em Usuários e permissões, remover o subtítulo redundante “Administração · Usuários e permissões” abaixo das abas.
- Em Sobre e conformidade, corrigir o logo alongado em todas as abas para proporção quadrada e reduzir os cards de “Como o sistema funciona” à altura visual dos itens de “Dúvidas e solução de problemas”.
- Em Central de exames, renomear a terceira aba “Exames de sangue” com um nome claro sobre sua função e avaliar melhorias operacionais, cobertura de estados reais e referências existentes.
- Auditar os módulos para adicionar, onde agregue valor, resumos rápidos no padrão da Visão geral da Gestão Hospitalar. Usar somente dados reais do módulo, sem sobrecarregar a tela e sem links/referências inexistentes.
- Substituir o rótulo “Abrir PWA móvel” por texto compreensível ao usuário; posicionar o acesso da Cozinha no topo direito também nas guias Avaliações e Visão da cozinha, revisando o nome “Mapa da cozinha”.
- Alinhar o botão “Cadastrar novo paciente” com os demais controles do campo na Ficha ambulatorial.

## Validações conhecidas

- Backend: suíte completa `uv run --group dev pytest` passou (169 testes) depois da instrumentação de progresso; os testes direcionados de backup/RGS passaram com ida e volta e polling. Migração de metas verifica consolidação das metas legadas.
- Backup/RGS: `uv run --group dev pytest backend/tests/test_backup_restore.py backend/tests/test_rgs_format.py` passou com ida e volta do exportador manual e consulta concorrente do progresso durante a restauração, sempre usando dumps sintéticos.
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
