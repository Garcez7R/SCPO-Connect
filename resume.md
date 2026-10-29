# SCPO Connect — resumo para retomada

Atualizado em 28/10/2026. Este documento resume o que está implementado, as últimas validações e as próximas melhorias sugeridas.

## Contexto do projeto

O SCPO Connect reúne fluxos assistenciais e operacionais da Santa Casa de Pedro Osório: Pacientes, Recepção, Enfermagem, Médico, Farmácia, Gestão Hospitalar, Central de Exames, Oficina Terapêutica, Psicologia/Psiquiatria, Serviço Social, Nutrição, Manutenção, Higienização e Administração.

Preservar o isolamento por serviço, as permissões por perfil, os registros auditáveis e a separação entre dados de demonstração e dados reais. Não executar mudanças em produção ou alterar dados clínicos sem autorização explícita e validação institucional.

## O que está pronto

### Fluxos assistenciais e operacionais
- Recepção registra chegadas e encaminha atendimentos para a fila de Enfermagem.
- Enfermagem registra triagem da chegada — alergias conferidas/relatadas, condições e tratamentos informados e sinais vitais — em snapshots associados ao atendimento.
- O Médico consulta a fila de triagens separadamente dos pacientes cadastrados e internados; mantém prontuário, registros clínicos e prescrições integrados com Farmácia e Enfermagem.
- Pacientes podem ser cadastrados para atendimento ambulatorial ou internação. O cadastro central é compartilhado conforme as permissões.
- Há registros de acompanhamento do paciente com nível de atenção, situação do tratamento, observação, autoria e histórico.
- Gestão Hospitalar concentra indicadores, pendências, relatórios e operações de leitos; transferências, altas, riscos e histórico são registrados.
- Oficina Terapêutica contempla calendário/atividades, presença e relatórios.
- Farmácia oferece estoque por lote, validade e metas de saldo, catálogo alfabético, dispensação e integração com prescrições.
- A proteção de tela do painel de chamadas é configurada na Recepção, que permite gerenciar imagens.

### Navegação e apresentação
- Cabeçalhos exibem breadcrumbs para abas e subabas em módulos com navegação hierárquica.
- Opções de relatórios disponíveis no centro administrativo/gestão e títulos de relatórios terapêuticos são ordenados em pt-BR.
- Listas de pacientes Médico/Pacientes usam linhas expansíveis e identificam perfil de cuidado clínico, psiquiátrico, combinado ou não classificado.
- Nome do paciente no painel público de chamadas foi ampliado; uma nova chamada toca e fala uma vez e repete uma única vez após 3 segundos, com destaque visual breve. Não há repetição contínua.
- Tema claro/escuro, responsividade e preferências de acessibilidade são tratados nos estilos globais.
- Cartões de quantidade/status têm animação curta, sombra e elevação ao passar o ponteiro em resumos de Enfermagem, Recepção, Farmácia, Gestão, Terapia, Exames e Higienização; animações respeitam `prefers-reduced-motion`.

### Correções importantes publicadas
- `e43388d`: corrigiu a inicialização do serviço Nursing quando o banco possuía o identificador legado da revisão Alembic `0048_reception_announce`.
- `4b04c60`: refinou navegação e fluxos clínicos.
- `8db8f19`: completou indicadores visuais de perfil de cuidado e uniformizou resumos de Enfermagem/Higienização.

## Retomada de 27/10/2026

### Acompanhamento do paciente
- O botão **Acompanhamento** na lista agora abre uma página própria, iniciada no topo, sem abrir a ficha detalhada ao fundo.
- A tela contém o formulário de acompanhamento e o histórico individual; **Voltar à lista** retorna ao contexto anterior.
- O carregamento das observações ocorre ao abrir essa página, e o foco da experiência deixa de depender de rolagem até o fim da ficha.

### Cartões de quantidade e status
- O padrão de movimento/sombra foi estendido a indicadores do estoque por nível e aos cartões de visão geral que usam `.overview-stat`.
- Os dois resumos da Manutenção agora usam cartões individuais e o mesmo padrão visual dos demais resumos.
- Os resumos existentes da Farmácia, Recepção, Enfermagem, Gestão, Oficina Terapêutica, Exames e Higienização já compartilham o movimento/sombra padrão.
- As cores de alerta específicas da Farmácia continuam indicando situações de estoque e validade; a presente atualização não replica semânticas clínicas ou operacionais de forma automática em outros módulos.

### Validação desta retomada
- `npm run lint`: aprovado.
- `npm run build`: aprovado (TypeScript e build de produção). Continua aparecendo o aviso informativo conhecido de chunk JavaScript acima de 500 kB; o build termina com sucesso.
- `npm run test:e2e`: aprovado; 1 cenário Recepção → Enfermagem → Médico.
- O E2E e o build locais não substituem homologação visual/autorizada em dispositivos e ambientes institucionais. As mudanças desta retomada não foram implantadas em produção.

## Cores semânticas — implementação inicial concluída

É recomendável adotar a linguagem de cores da Farmácia **somente onde o valor é um estado operacional inequívoco**. Um cartão colorido torna os alertas prioritários mais fáceis de localizar, mas o código de cor precisa ter o mesmo significado em todas as telas, permanecer legível nos temas claro/escuro e sempre vir acompanhado de texto/valor — nunca depender apenas da cor.

### Escopo indicado para a próxima etapa
1. Fazer um inventário de cartões que exibem estados de processo e que ainda estão neutros: disponibilidade de leitos, fila de solicitações de Manutenção/Higienização, etapas da Central de Exames e estados de atendimento da Recepção.
2. Definir uma paleta semântica comum, documentada no CSS/tokens: neutro para informação, azul para andamento, âmbar para atenção/pendência, verde para concluído/liberado e vermelho para bloqueio/criticidade.
3. Aplicar cores por estado real retornado pelo sistema; não atribuir vermelho/âmbar a categorias clínicas, risco ou prioridade sem protocolo institucional aprovado.
4. Não aplicar o padrão a cartões meramente numéricos sem uma condição de alerta explícita. Evitar competir visualmente com alertas clínicos, fila prioritária e perfis de cuidado.
5. Validar contraste, daltonismo (texto/ícone além da cor), modo escuro, telas pequenas e `prefers-reduced-motion`; adicionar testes de renderização/estados quando houver cobertura adequada.

**Sugestão de ordem:** começar por Manutenção/Higienização e disponibilidade de leitos, onde pendente/em andamento/concluído ou disponível/ocupado/bloqueado são estados discretos. Em seguida avaliar Central de Exames e Recepção. Enfermagem deve ficar fora da primeira aplicação colorida até que a semântica esteja alinhada a protocolo assistencial aprovado.

### Implementação inicial — 27/10/2026
- Tokens semânticos comuns foram definidos para informação/neutro, andamento, atenção/pendência, concluído/liberado e bloqueio, com variantes de alto contraste para o tema escuro.
- Os resumos da Manutenção e Higienização distinguem somente estados operacionais; contagens gerais e métricas sem limiar aprovado permanecem neutras.
- O resumo de capacidade destaca leitos liberados; os estados no mapa distinguem ocupado (neutro), higienização (andamento), manutenção (atenção), disponível (liberado) e bloqueado (criticidade).
- Os indicadores de situação mantêm rótulos textuais além das cores. Central de Exames, Recepção e estados clínicos continuam fora deste escopo inicial.
- Validação desta etapa: `npm run lint`, `npm run build` e `npm run test:e2e` aprovados; o build mantém o aviso já conhecido sobre chunk acima de 500 kB. O contraste dos tokens semânticos supera 4,5:1 nos temas claro e escuro.
- A atualização permanece local e não foi implantada em produção.

## Histórico clínico, semáforo comportamental e proteção de tela

- O histórico assistencial do paciente reúne sinais vitais e, conforme as permissões, triagens, atendimentos ambulatoriais, atendimentos de Psicologia/Psiquiatria, movimentações de internação/transferência/alta e observações comportamentais. Os registros aparecem por categoria em ordem cronológica, com paginação de origem quando disponível e indicação explícita de falha por fonte.
- As observações comportamentais são descritivas, append-only e destinadas à equipe assistencial autorizada. Enfermagem pode registrar fatos, contexto e conduta. Somente Médico, Psicologia/Psiquiatria, Administração autorizada ou superusuário podem alterar o semáforo; o sistema não deduz cores automaticamente e não expira a classificação.
- Critérios aprovados: verde — bom comportamento; amarelo — requer mais atenção; vermelho — requer supervisão constante. As cores são acompanhadas de rótulos textuais.
- Gestão consulta uma lista de internados com apenas nome, localização, sinalização atual e data da última revisão. Não recebe observações, contexto, conduta ou autoria.
- A migração Nursing `0049_behavioral_observations` cria o histórico auditável e armazena as alterações de semáforo como novos registros.
- A Recepção agora consulta a lista pública de imagens e pode enviar/excluir arquivos com permissões próprias. São aceitos JPG, PNG, WebP e AVIF de até 8 MB.
- O serviço Nursing persiste as imagens em `/var/lib/scpo/reception-screensaver`, montado no volume nomeado Docker `reception_screensaver_data`; o diretório da imagem é preparado com permissões para o usuário sem privilégios do contêiner.
- A configuração e os volumes ainda precisam ser homologados no ambiente institucional. Confirmar também a inclusão do volume de imagens no procedimento de backup/restauração antes de uso operacional.

### Ajustes de interface — 27/10/2026

- A caixa de pendências traduz os tipos internos de solicitação de Higienização para rótulos em português.
- Os resumos coloridos de Manutenção e Higienização aparecem antes dos filtros, no início do painel operacional.
- Relatórios digitais ocupam a largura alinhada às demais telas de Administração; os painéis de criação/listagem de usuários recebem fundo de tema escuro.
- O texto “Acesso individual por perfil” foi removido da base do menu lateral; identificação e perfil do usuário permanecem visíveis.
- Resumos de estoque da Farmácia usam os tokens semânticos comuns, com alertas textuais e cores adequadas também ao tema escuro. Cartões-resumo têm entrada e elevação mais perceptíveis; gráficos de sinais vitais desenham as linhas e revelam os pontos ao abrir a visualização, respeitando `prefers-reduced-motion`.
- Validação local: `npm run lint`, `npm run build` e `npm run test:e2e` passaram. O E2E continua cobrindo somente um fluxo Recepção → Enfermagem → Médico; a homologação visual completa em telas/dispositivos institucionais permanece pendente. Nenhuma implantação foi feita nesta etapa.

## Outros itens de homologação ainda relevantes

- Homologar login/MFA, permissões e rotas com contas de teste autorizadas; não compartilhar credenciais.
- Percorrer os fluxos Recepção → Triagem → Médico → Farmácia/Enfermagem em ambiente segregado e com dados fictícios.
- Validar a ronda horária, relatórios/paginação, impressões e recuperação de falhas de integração.
- Testar layouts em computador, tablet e celular nos temas claro/escuro.
- Antes do uso com dados reais, validar backup/restauração, retenção, auditoria e governança com TI e responsáveis institucionais.

## Navegação e acessos — 28/10/2026

- Iniciado o padrão de navegação interna responsiva compartilhado entre Pacientes, Enfermagem, Farmácia, Central de Exames, Gestão Hospitalar e Administração: guias lado a lado no desktop quando são poucas e seletor em telas estreitas ou módulos com muitas opções. Gestão Hospitalar mantém botões de seleção mesmo com muitas áreas, conforme solicitado.
- Administração de contas foi restringida no backend e na interface a Administração do aplicativo e Superadministrador. Gestão Hospitalar não pode consultar, criar, editar, redefinir credenciais ou excluir contas; administradores do aplicativo podem administrar qualquer escopo, inclusive Gestão Hospitalar.
- Os cartões informativos usam o mesmo efeito de entrada com atraso em sequência, respeitando a redução de movimento configurada pelo usuário.
- A tela de indisponibilidade agora informa falta de conexão com o servidor, não com a internet.
- O mapa de comparação com o programa Visual Basic e a proposta segura para o PWA conectado estão em [docs/modernization-roadmap.md](docs/modernization-roadmap.md). O repositório não contém fontes ou banco do programa antigo; o levantamento funcional depende de material validado pela equipe. O PWA inicial não grava dados clínicos offline.

## Retomada — superadministrador e PWA Nursing — 28/10/2026

- **Superadministrador `rgarcez`: tarefa operacional ainda pendente.** A verificação anterior do banco ativo encontrou duas contas, nenhuma marcada como superadministradora, e não encontrou `rgarcez`. O reset não foi executado porque essa instância não foi confirmada como o ambiente pretendido. Antes de qualquer alteração, confirmar servidor, projeto/contêiner Docker e banco de dados corretos. O bootstrap cria `rgarcez` com senha inicial `0000` somente quando o banco de acesso está vazio e o token de bootstrap válido está configurado; em seguida, o login exige troca de senha e configuração do MFA. Se o banco já tiver contas, não tentar bootstrap nem alterar o banco manualmente: confirmar a instância e seguir um procedimento de recuperação autorizado e auditável. Nunca registrar senha ou token no repositório.
- **Gestão de usuários:** a aba foi incluída também em Administração do Sistema para o Superadministrador, reutilizando o fluxo de Administração do aplicativo para criar contas, alterar permissões, redefinir senhas temporárias e excluir contas. A conta superadministradora permanece protegida contra alteração por outras contas.
- **Pressão no PWA:** o campo aceita o formato sistólica/diastólica, incluindo `120/80` e `12/8`; o teclado móvel deve ser do tipo texto para disponibilizar `/`.
- **Erro de horário ao marcar “Não aferido”:** sinais sem valores aferidos não recebem horário de aferição e não são rejeitados por diferença no relógio do aparelho. Registros que contêm valores medidos continuam rejeitando horário futuro. Quando conectado, o PWA deixa o servidor registrar o horário; ações offline preservam o horário local para sincronização.
- **Verificação horária:** o botão está nomeado “Registrar verificação” quando conectado e envia imediatamente ao servidor. Sem comunicação, “Guardar verificação” salva a ação cifrada no dispositivo; ela fica pendente até sincronizar e ser confirmada. O botão de encerrar a ronda aparece depois que todos os pacientes forem tratados e exige confirmação online do servidor.
- O guia do Superadministrador e a documentação de permissões foram atualizados para refletir esses fluxos. Validar build, lint e os testes Nursing antes de considerar a retomada concluída.

### Estado registrado antes desta retomada — 28/10/2026

O usuário pediu para interromper o trabalho por enquanto e retomar em outra sessão/agente. As alterações abaixo estão **locais, não commitadas e ainda não concluídas**:

- `src/pages/NursingMobilePage.tsx`: teclado de texto para a pressão (permite `/`), horário do aparelho omitido nas submissões online, horário local preservado ao enfileirar offline; orientação e rótulos explícitos para registrar/guardar verificações horárias.
- `backend/scpo_services/nursing.py`: uma coleta composta apenas por sinais “não aferidos” não usa nem valida um horário de aferição; continua rejeitando horários futuros quando há valores medidos.
- `backend/tests/test_nursing.py`: testes de regressão para sinais não aferidos com relógio do aparelho adiantado e para a rejeição de horário futuro em medições reais.
- `src/App.tsx`: nova guia de Usuários e permissões no Superadministrador, reutilizando a interface de Administração do aplicativo; label de aba ajustado.
- `src/components/SystemAdminGuide.tsx`, `docs/permissions.md` e `docs/system-admin-guide.md`: documentação dos fluxos atualizada.

**Validação parcial:**
- `npm run lint`: concluiu sem erros; há um warning `react-hooks/exhaustive-deps` em `src/App.tsx` sobre `availableTabs` ser recriado a cada render.
- `npm run typecheck`: falhou em `src/App.tsx` por inferência estreita de tipos para `availableTabs` (`TS2345` nas chamadas `includes`/`setTab`, aproximadamente linhas 3060 e 3079). Corrigir anotando `availableTabs` como lista readonly de `typeof adminTabValues[number]` (ou solução equivalente estável) e rodar novamente.
- `git diff --check`: passou.
- Os testes backend não foram executados: a tentativa `python -m pytest backend/tests/test_nursing.py -q` falhou porque o comando `python` não existe. Já foi confirmado que estão disponíveis `/usr/bin/python3`, `/usr/bin/pytest` e `/home/rgarcez/.local/bin/uv`. Na retomada, usar `uv run pytest backend/tests/test_nursing.py -q` (ou `python3 -m pytest` se o ambiente já tiver dependências); não instalar dependências sem necessidade.
- Ainda não foram executados `npm run build` nem `npm run test:e2e`.
- O repositório está em `main`, com alterações não commitadas. Antes de continuar, inspecionar `git status` e preservar as alterações existentes.

**Conta superadministradora:** nenhuma alteração de banco, conta, senha ou MFA foi feita nesta retomada. A verificação anterior encontrou um banco ativo com duas contas e sem `rgarcez`/superadministrador, mas esse banco não foi confirmado como o destino correto. Antes de qualquer ação operacional, identificar com o usuário o servidor, o projeto/contêiner e o banco de destino. O bootstrap com `0000` só é válido numa instalação vazia, com token de bootstrap configurado; em base já inicializada, não executar bootstrap nem fazer edição direta do banco sem procedimento autorizado e auditável. A conta existente não deve ser resetada para uma senha compartilhada sem validar o ambiente.

### Retomada concluída — 28/10/2026

- `src/App.tsx`: `availableTabs` agora tem o tipo readonly esperado e identidade estável entre renderizações, corrigindo o erro de TypeScript e o aviso de dependências do hook.
- `backend/scpo_services/nursing.py`: registros sem valores aferidos preservam `measured_at: null` também na serialização; medições com valores continuam rejeitando horários futuros. Os testes cobrem os dois casos.
- `e2e/reception-triage-physician.spec.mjs`: o fluxo E2E seleciona a seção Triagem pelo seletor responsivo de Enfermagem.
- Validação concluída: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:e2e`, `uv run pytest backend/tests/test_nursing.py -q` e `git diff --check` aprovados. O build ainda exibe o aviso conhecido de chunk JavaScript acima de 500 kB.
- Nenhuma conta, senha, MFA, banco ou implantação foi alterada. A operação pendente do superadministrador continua condicionada à confirmação explícita da instância correta e a procedimento autorizado.

## Referências técnicas

- `src/App.tsx`: navegação global, cadastro/lista/ficha/acompanhamento de pacientes, Enfermagem, Gestão e Administração.
- `src/app.css`: tokens, layouts, modo escuro, cartões, motion e responsividade.
- `src/pages/PhysicianPage.tsx`: lista Médico, pacientes agrupados por internação e perfis de cuidado.
- `src/pages/PharmacyPage.tsx`: indicadores coloridos de estoque e lotes.
- `src/pages/OperationsPage.tsx`: filas de Manutenção e Higienização.
- `src/components/NursingTriagePanel.tsx`: triagem de Enfermagem.
- `backend/migrations/env.py` e `backend/tests/test_migrations.py`: compatibilidade de revisão legada Nursing.

## Comandos úteis

- `npm run lint`
- `npm run build`
- `npm run test:e2e`
- Testes Python direcionados, quando houver mudança de backend: `uv run pytest <caminho-do-teste> -q`
