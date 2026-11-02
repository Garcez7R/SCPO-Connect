# SCPO Connect — ponto de retomada

Atualizado em 02/11/2026. Repositório: `/home/rgarcez/SCPO-Connect`, branch `main`.

## Quadro de acompanhamento

### Forma de execução acordada

- Executar validações e testes estritamente um de cada vez: iniciar um único comando, aguardar sua conclusão e só então iniciar o próximo. Não executar pytest, TypeScript, ESLint, build ou outras verificações em paralelo; isso já travou o VS Code anteriormente.
- Ao concluir uma tarefa/fase, atualizar este resume, revisar README e as informações/ajuda dentro do app, informar que a fase terminou e qual será a próxima, então avançar automaticamente sem aguardar nova confirmação. Fazer commit e push ao final de cada fase; atualizar a documentação para refletir mudanças de uso e, quando não houver conteúdo pertinente a alterar, registrar que ela foi revisada sem inventar instruções.
- Preservar alterações locais preexistentes; antes de cada commit, conferir `git status` e revisar/stagear somente os arquivos da fase. Manter apenas este `resume.md`; a exclusão do `RESUME.md` legado foi solicitada pelo usuário e será publicada.
- E2E e deploy/atualização do servidor de testes permanecem pausados até orientação/autorização. Não executar migrações em dados reais.

### Situação resumida das fases

- **Concluído/publicado:** revisão visual dos quadros da Farmácia (`8b045db`); avaliação de escalas graduais sem inventar limites (`9bd9e2b`); revisão do README e do Sobre (`501aff4`).
- **Tentativa bloqueada/publicada:** inspeção da Lavanderia em viewport móvel chegou somente à tela de login porque a API local não estava disponível (`1a0cf38`); repetir após preparar autenticação local.
- **Em andamento/próxima fase:** ampliar o dashboard do Superadministrador com controles funcionais e seguros de gerenciamento, além dos indicadores de status.
- **Próximas fases:** repetir a inspeção móvel autenticada da Lavanderia quando a API local estiver disponível; obter reprodução/logs para investigar tela branca e instabilidade no Chrome/Windows 11; por último, realizar o piloto/atualização do servidor somente com as autorizações e pré-requisitos registrados.

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

### Pendente — ordem sugerida

- Retomar a revisão da Lavanderia/Rouparia em viewport móvel quando a API local de autenticação e uma sessão de teste estiverem disponíveis.
- **Próxima fase — dashboard do Superadministrador:** ampliar o dashboard para ações de gerenciamento, além da versão/conectividade atual. Inventariar os controles existentes e propor painel funcional com ativação/desativação não destrutiva de módulos/funções, preservando dados e registrando autoria/auditoria; garantir aplicação das regras no backend e na interface. Antes de implementar, confirmar escopo e comportamento de desativação, sem confundir disponibilidade global com permissões individuais.
- Investigar tela branca/instabilidade no Chrome/Windows 11 quando houver relato reproduzível, incluindo versão do navegador/SO, etapa, frequência, mensagem/console e passos seguros para reproduzir.

### Marco posterior — atualização do servidor de testes e piloto paralelo

- Depois de concluir as pendências do resume e obter as autorizações necessárias, atualizar o servidor Debian 13 minimal já preparado pelo usuário com a versão publicada.
- Executar o SCPO Connect em paralelo ao sistema atualmente usado para validar fluxos e necessidades, sem substituir o sistema vigente. Antes da atualização, confirmar janela, backup/restauração, volumes e compartilhamentos montados, DNS/HTTPS e acesso aprovado. Não usar dados reais nem executar E2E sem autorização explícita.
- Validar serviços/healthchecks, persistência após reboot, HTTPS, backup/restauração isolada e os fluxos aprovados; registrar necessidades identificadas e ajustes neste resume antes de qualquer decisão de substituir o sistema atual.

## Validações conhecidas

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

Para build de imagens e inspeção dos serviços, em um ambiente com Docker instalado:

```bash
docker compose build
docker compose ps
docker compose logs --tail=100 <serviço>
```

Não execute E2E, deploy no servidor de testes nem migrações em dados reais sem autorização explícita. Não inclua `.env`, tokens, bancos, logs ou dados clínicos no Git.
