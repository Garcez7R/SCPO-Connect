# SCPO Connect — ponto de retomada

Atualizado em 01/11/2026. Repositório: `/home/rgarcez/SCPO-Connect`, branch `main`.

## Quadro de acompanhamento

### Concluído e publicado

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
- Backlog registrado: chamada de acompanhante no painel público, com seleção e identificação sem revelar dados pessoais.
- Superadministrador: agora gera um par GPG RSA 3072 para o backup automático. A chave privada é protegida pela senha escolhida e armazenada no volume do servidor; a senha não é salva. A interface baixa uma cópia privada ASCII-armored ainda cifrada, exige confirmação da impressão digital antes de substituir uma chave pública existente e audita geração/exportação sem registrar a senha. Testes sintéticos validam geração, proteção, autorização, exportação e rejeição de senha incorreta. O volume de chave protegida no mesmo servidor não substitui custódia independente.
- A busca no repositório encontrou somente um `resume.md`; este arquivo é o ponto único atualizado.

### Em andamento

- Nenhuma tarefa de implementação em andamento.

### Pendente — ordem sugerida

- Superadministrador/armazenamento: avaliar criação e seleção de diretórios de destino para backup e biblioteca de imagens, aceitando caminhos locais e compartilhamentos de rede já montados. A interface deve pedir e validar o caminho, explicar permissões e deixar claro que montar/compartilhar volumes no host depende da TI; o app não deve tentar montar sistemas de arquivos por conta própria.
- Indicadores e cartões: continuar revisão visual das abas que ainda não seguem o padrão da Gestão Hospitalar e corrigir cores arbitrárias restantes usando somente dados reais. A auditoria dos resumos operacionais por fila foi concluída; ver o registro acima.
- Painel de chamadas: permitir chamar o acompanhante do paciente com indicação clara de que é um acompanhante, preservando a privacidade na tela pública; definir como selecionar o acompanhante e evitar expor dados pessoais antes de implementar.
- Revisar a Lavanderia/Rouparia em dispositivo móvel de teste após publicar.
- Revisar README, Sobre e Conformidade após as mudanças aplicáveis.
- Revisar a senha provisória `0000` para contas comuns/administradores com troca obrigatória no primeiro login e o botão de revelar senha no bootstrap do superadministrador.
- Confirmar os botões da Enfermagem em linha antes da busca de paciente; revisar alinhamento do botão de novo paciente e ampliar os cartões do painel de chamada.
- Criar prontuário simples e completo compartilhado entre Médico e Enfermagem; permitir cadastro contingencial rápido na Recepção e acompanhar historicamente as fases do atendimento.
- Investigar expiração de sessão, tela branca e instabilidade no Chrome/Windows 11; remover integração Zentyal cancelada com validação dos consumidores.
- Criar controles seguros no Superadministrador para ativar/desativar funções sem remover dados.
- Substituir o rótulo genérico “Abrir PWA móvel” por um texto que identifique o módulo aberto; o acesso da Cozinha já fica no cabeçalho nas guias Avaliações e Dietas e alertas.
- Alinhar o botão “Cadastrar novo paciente” com os demais controles do campo na Ficha ambulatorial.

### Marco posterior — servidor de testes Debian 13

- Depois de concluir as pendências de software e obter as autorizações necessárias, instalar no servidor Debian 13 minimal preparado pelo usuário.
- Antes da instalação, confirmar acesso aprovado ao host, endereço/credenciais por canal seguro, montagem dos volumes locais ou compartilhamentos de rede, DNS/HTTPS, backup e janela de manutenção. Não fazer deploy, migrações em dados reais ou testes E2E sem autorização explícita.
- Após instalar, validar serviços/healthchecks, persistência após reboot, HTTPS, backup e restauração isolada e fluxos aprovados; registrar resultados no README e neste resume.

## Validações conhecidas

- Backend: suíte completa `uv run --group dev pytest` passou (171 testes) após a entrega da Lavanderia/Rouparia; os testes direcionados de backup/RGS passaram com ida e volta e polling. Migração de metas verifica consolidação das metas legadas.
- Backup/RGS: `uv run --group dev pytest backend/tests/test_backup_restore.py backend/tests/test_rgs_format.py` passou com ida e volta do exportador manual e consulta concorrente do progresso durante a restauração, sempre usando dumps sintéticos.
- Frontend: `npm run typecheck`, `npm run lint` e `npm run build` passaram. O build ainda apresenta o aviso do Vite sobre o chunk principal maior que 500 kB.
- Ruff passou nos demais arquivos backend alterados. `nursing.py` ainda tem um aviso preexistente (`UP012`) em linha não modificada; o lint global também aponta um import não usado em `demo_reception.py`, fora do escopo.
- Docker CLI 29.9.2 e Compose v5.6.1 estão disponíveis neste ambiente; `docker compose config --quiet` passou. O build da imagem frontend foi validado em 31/10/2026 após incluir `laundry.html`; não houve deploy/execução de containers do sistema.
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
