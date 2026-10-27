# SCPO Connect — resumo operacional para retomada por outro agente

## Contexto
Este projeto é o SCPO Connect, aplicação hospitalar/operacional para Santa Casa de Pedro Osório, com módulos de enfermagem, pacientes, médicos, gestão, exames, manutenção, oficina terapêutica, serviço social, nutrição, recepção, farmácia e administração.

A missão principal no momento foi continuar a evolução da plataforma para demonstração interna, validação clínica e uso operacional em paralelo com o ambiente real, sem quebrar ou sujar dados de produção.

## Estado atual e decisões importantes
- O app foi refinado para visualmente coerente e legível em modo escuro e claro.
- Foram ajustados módulos, navegação, rotas, relações entre tabulações e filtros.
- Os pacientes fictícios/demonstrativos foram preparados para uso em ambiente de desenvolvimento para apresentação sem mexer em dados reais.
- A lógica de perfil/permissão foi reforçada para evitar acessos indevidos e para preservar supervisão clínica.
- A ficha do paciente foi ajustada para abrir no topo e evitar problemas de layout.
- O módulo de enfermagem foi reorganizado com foco em coleta de sinais vitais, medicações e fila/segurança.
- Foi estruturada uma rotina de ronda horária de enfermagem, persistindo dados em backend e com intenção de uso operacional.
- O módulo de gestão hospitalar foi adaptado para refletir pendências a partir de filas e contextos reais do módulo, não de listas genéricas.
- Os gráficos de sinais vitais foram centralizados em componente compartilhado para melhorar consistência visual e legibilidade.
- O toast foi movido para canto inferior direito, e ajustes de UX em dark mode e layouts de página foram feitos.

## O que já está pronto/feito
- Ajuste de rotas e proxy para módulos interprofissionais e médicos.
- Base de dados demo e pacientes fictícios integrados ao script de desenvolvimento.
- Ajustes de filtros e agrupamento em cadastro de pacientes.
- Organização de exames e central de exames.
- Padronização de ícones, cores e navegação.
- Ajustes de dark mode e contraste.
- Persistência de subabas e breadcrumbs.
- Aprimoramento da tela de Oficina Terapêutica.
- Ajustes de módulo de manutenção e gestão.
- Ajustes de erro e retry no módulo médico.
- Reforço da explicação do campo de pressão arterial e gráfico.
- Fonte das pendências operacionalizadas e válidas para Gestão Hospitalar.
- Revisão visual dos gráficos em módulos principais.
- Ajuste do toast para inferior direito.
- Alinhamento de fichas ao topo.
- Estrutura inicial da ronda horária de enfermagem.
- Remoção do gráfico da tela de coleta de sinais vitais, mantendo apenas valores brutos.
- Acesso do app em ambiente de demonstração com dados fictícios configurados para uso interno.

## O que ainda está em andamento / pendente
- Homologação completa em ambiente com APIs de demonstração funcionando.
- Validação final dos fluxos do módulo de enfermagem em runtime.
- Ajustes finos e polish finais da nova aba de ronda após teste em runtime.
- Revisão adicional de layout e usabilidade nas páginas mais críticas.
- Confirmar contraste, espaçamento e clareza dos gráficos em módulos específicos.
- Verificar funcionamento operacional em ambiente real de apresentação (porta 8443 ou URL local, conforme ambiente do cliente).

## Arquivos/módulos mais relevantes
- src/App.tsx
  - Navegação principal, módulos, tabs e funcionalidades gerais.
- src/components/VitalTrendsDashboard.tsx
  - Componente compartilhado de gráficos de sinais vitais.
- src/app.css
  - Estilos globais, dark mode, toasts, layout, modais e identidade visual.
- backend/scpo_services/nursing.py
  - Lógica de enfermagem, dados, pacientes, rounds e filas.
- backend/migrations/versions/0042_nursing_hourly_rounds.py
  - Migração para persistência da ronda horária.
- backend/tests/test_nursing.py
  - Testes do backend de enfermagem.

## Regras e convenções importantes para continuar
- Manter dados demo em ambiente de desenvolvimento e separar de produção.
- Não mexer em cadastros reais em produção sem confirmação explícita.
- Preferir melhorias de UX sem quebrar fluxos existentes.
- Preservar acessos por perfil e permissões sem abrir superuser genérico.
- Manter a aparência consistente em modo claro/escuro.
- Os gráficos devem continuar sendo compartilhados entre módulos onde fizer sentido.
- O campo de pressão arterial continua sendo tratado como um único campo; o gráfico pode separar sistólica e diastólica para leitura diagnóstica.
- A ronda horária deve continuar sendo tratada como registro operacional, simples e auditável, sem poluir demais o fluxo.

## Comandos úteis para validação
- Frontend: npm run typecheck
- Build: npm run build
- Backend (quando necessário): pytest backend/tests/test_nursing.py

## Considerações para outro agente
- Priorizar correções de usabilidade, layout, dados demo e estabilidade antes de adicionar novas features.
- Revalidar exatamente pontos reportados pelo cliente: módulo médico, oficina terapêutica, enfermagem, gestão, gráficos, filtros, pacientes fictícios e navegação.
- Sempre verificar se alterações impactam permissões e visual do dark mode.
- Se for continuar uma nova rodada de desenvolvimento, use este resumo como ponto de partida e mantenha o que já foi padronizado.

## Resumo prático do próximo passo recomendado
1. Validar os fluxos da ronda horária em runtime com dados fictícios.
2. Confirmar 502/failed to fetch ou falhas reais em módulo médico e APIs de apresentação.
3. Revisar microdetalhes finais de dark mode, gráficos e telas mais críticas.
4. Fazer commit final e push com estado estável.

## Observação final
O estado atual está funcional e coerente para demonstração, mas ainda exige pequena validação de runtime e polish final antes de encerrar a fase de desenvolvimento/uso interno.

## Atualização da retomada — 2026-10-23

### Estado publicado
- Branch `main` sincronizada com `origin/main`, no commit `65402ff` (`Align access, report and nursing module fixes`).
- O único arquivo local não rastreado é este `resume.md`, que deve continuar fora do Git salvo pedido explícito.
- Nesta retomada não foram alterados arquivos rastreados nem dados clínicos.

### Validações recentes
- `npm run build`: passou, incluindo TypeScript, build Vite e geração do service worker.
- `npm run lint`: passou.
- `uv run pytest -q`: passou, 120 testes.
- Ruff nos arquivos tocados de enfermagem passou: `uv run ruff check backend/scpo_services/nursing.py backend/tests/test_nursing.py`.
- `uv run ruff check backend` não passou por erros I001 de ordenação de imports em migrações preexistentes, incluindo `backend/migrations/versions/0004_work_orders.py`; não foram corrigidos por serem fora do escopo.

### Checagem de runtime via Docker — somente leitura
- A listagem Compose mostrou `db`, `access`, `audit`, `backup`, `maintenance`, `nursing`, `pharmacy`, `social`, `therapy` e `xray` como saudáveis; `web` e `proxy` estavam em execução, sem healthcheck configurado.
- Com o hostname TLS configurado pelo proxy (não acessando por IP), a página respondeu `200` com HTML e `/api/v1/auth/status` respondeu `200` com `bootstrap_required: false`.
- GETs sem cookie para `/api/v1/nursing/hourly-rounds/current`, `/api/v1/physicians/prescriptions` e `/api/v1/therapy/activities` responderam `401` JSON. Isso confirma roteamento e exigência de autenticação; não valida login, autorização de um perfil real, leitura dos dados nem conclusão dos fluxos.
- A tentativa inicial via `127.0.0.1` sem o hostname/SNI correto retornava respostas vazias; com o hostname configurado, o proxy e as respostas passaram a ser válidos.
- O container `scpoconnect-psychology-1` corresponde sim ao serviço da aba Psicologia/Psiquiatria (confirmado pelas labels do Docker: projeto `scpoconnect`, serviço `psychology`). Na configuração Compose atual do repositório, porém, não há um serviço `psychology` separado: as rotas `/api/v1/psychology` e `/api/v1/interprofessional` são roteadas para o serviço `social`, que contém os endpoints de Psicologia em `backend/scpo_services/social.py`. O container pode pertencer a uma versão anterior/outra implantação e não deve ser considerado órfão sem comparar seu código/configuração. Nada foi parado ou removido.
- A confirmação da conta e senha de `rgarcez` não foi tentada. O estado `bootstrap_required: false` informa apenas que o bootstrap foi concluído. `0000` é senha de bootstrap de instalação nova; não redefine senha de uma conta já existente ou migrada. Não insistir em tentativas de senha, para evitar bloqueio; usar a credencial vigente ou o processo institucional autorizado de recuperação.
- Nenhum login foi feito e nenhum dado clínico foi lido, criado ou alterado. Ainda falta homologação humana com usuários autorizados.

### Pendências priorizadas para homologação

**P0 — antes de qualquer uso com dados reais**
1. Em coordenação com TI, confirmar a origem do container extra `scpoconnect-psychology-1` e alinhar a stack implantada com os serviços e imagens aprovados. Não usar `--remove-orphans` nem remover containers sem avaliação do responsável.
2. Validar, com contas de teste autorizadas e sem compartilhar credenciais, login/MFA e permissões mínimas de Enfermagem, Médico, Oficina Terapêutica, Farmácia e Administração; verificar também que usuários sem o módulo recebem acesso negado.
3. Revisar com os responsáveis institucionais trilha de auditoria clínica, retenção e proteção contra alteração. A documentação do projeto registra que a cobertura ainda não é integral e a emissão é best-effort.
4. Gerar backup e provar restauração em ambiente isolado; obter aprovação de TI, segurança, privacidade/jurídico e responsáveis assistenciais antes de liberar dados reais.

**P1 — fluxos integrados, somente com dados fictícios de homologação**
1. Enfermagem: registrar sinais vitais, verificar gráfico e horário/data, abrir e completar uma ronda horária; conferir autoria, histórico e comportamento em falha.
2. Médico → Farmácia → Enfermagem: criar prescrição de teste, conferir vínculo paciente-prescrição, dispensar lote de teste e registrar administração; repetir com falha controlada somente em ambiente isolado e verificar idempotência/inconsistências.
3. Oficina Terapêutica: criar atividade, visualizar o calendário em tema claro/escuro, marcar presença e consultar/imprimir relatório; observar especificamente se ainda ocorre mensagem `object: object`.
4. Internação → transferência → alta: conferir disponibilidade do paciente/leito em cada módulo, histórico e recuperação de erro; não confundir anotação administrativa com alta operacional.
5. Relatórios: comparar totais, paginação, filtros por data/hora e impressão com conjunto que ultrapasse os limites de uma página.

**P2 — usabilidade e compatibilidade**
1. Validar em computador, celular e tablet; teclado/leitor de tela quando aplicável; conferir contraste no modo escuro, ícones, títulos e retorno ao topo ao trocar de módulo.
2. Confirmar mensagens em português para falhas de API, sessão expirada e permissões insuficientes, sem exibir detalhes internos ou tratar falha como ausência de dados.
3. Registrar cada cenário com perfil usado, resultado esperado/observado, evidência sem dados pessoais, severidade, responsável e decisão de correção; repetir os cenários bloqueadores após ajustes.

### Próximo passo recomendado para quem retomar
1. Começar pela divergência do container extra e pela verificação do deploy com TI; não fazer limpeza ou reinício antes de aprovar impacto.
2. Depois conduzir a homologação P0/P1 em ambiente segregado, com dados fictícios e contas autorizadas.
3. Corrigir apenas problemas reproduzidos, acrescentar testes, repetir build/lint/testes e atualizar este handoff com resultado e evidência sanitizada.

## Retomada da task — 2026-10-25

### Estado confirmado antes do início
- Branch `main`, sincronizada até `6f2be4c` (`Add scheduled med administration support`).
- O único arquivo local não rastreado era este `resume.md`; ele foi atualizado por solicitação do usuário e deverá ser incluído no commit desta task.
- Ainda não foi feita investigação nem alteração rastreada para a nova task.

### Solicitações desta rodada
1. Investigar e corrigir a causa da falha de build do serviço Nursing.
2. Definir um fluxo coerente para solicitação médica de exames, separando solicitação clínica e operação da Central de Exames.
3. Remover a frase de acesso individual por perfil junto ao menu lateral.
4. Ajustar visualização da ficha do paciente: botão de impressão dentro/visível na ficha e layout do histórico.
5. Reanunciar chamadas com toque e locução repetidos após 3 segundos; realce breve de fundo ao iniciar a chamada.
6. Confirmar se as senhas da fila reiniciam à meia-noite e corrigir se necessário.
7. Revisar cartões de indicadores da Farmácia e Recepção, removendo redundâncias e uniformizando animação/sombra nas abas aplicáveis.
8. Atualizar a fase do easter egg de beta para pré-alfa.
9. Revisar como os tipos de tratamento clínico, psiquiátrico e combinado são diferenciados visualmente.
10. Corrigir o reanúncio na Recepção e avaliar/explicar as vozes TTS disponíveis.
11. No painel público, exibir “Atendimento” para comum e “Atendimento prioritário” para prioritário.
12. Avaliar e implementar geração de horários de prescrição a partir de intervalo, primeiro horário e duração, incluindo duração indefinida. Não inferir nem prescrever posologia automaticamente sem confirmação do prescritor; a regra deve apenas calcular horários explícitos confirmados.
13. Ao terminar as correções, fazer revisão QA funcional/UX tela por tela, atualizar README se necessário, validar, commitar e fazer push.

### Decisão de arquitetura de exames a investigar
- Preferência inicial: não duplicar módulos nem expor aos médicos a fila operacional completa da Central.
- Considerar um formulário de solicitação clínica acessível no módulo Médico, vinculado ao paciente e enviado a uma fila de pedidos para o setor de Exames; o setor permanece com sua tela operacional própria para triagem, agendamento, execução e resultado.
- Confirmar rotas, modelos existentes e permissões antes de escolher nomes ou implementação.

### Validações esperadas
- Reproduzir a falha de build do Nursing com o comando/script existente, identificar o log/etapa exata e corrigir a causa raiz.
- Executar typecheck, lint, build e testes targeted dos módulos afetados.
- Conferir as rotas de fila para provar o reset das senhas pela data local institucional (Brasília), incluindo fronteira de meia-noite.
- Conferir acessibilidade, `prefers-reduced-motion`, tema claro/escuro e tamanhos de tela para as alterações de layout/realce.
- Manter `resume.md` atualizado com resultado, commits e itens eventualmente não concluídos.

## Retomada complementar — 2026-10-25

### Ajustes concluídos nesta retomada
- O painel longitudinal de sinais vitais agora inicia sem período selecionado e só consulta a API após uma escolha explícita. O estado inicial não depende de `setState` dentro de um effect; o lint React e o build passaram.
- A chamada pública exibe “Atendimento” para a fila comum e mantém “Atendimento prioritário” para a fila prioritária; o nome é dimensionado para caber no cartão.
- Nova chamada no painel público produz um flash âmbar breve e inicia automaticamente toque + locução “Senha [código]. [nome]. Dirija-se ao atendimento.”; a sequência repete uma única vez após 3 segundos, sem sobrepor a locução anterior. O painel não anuncia novamente as chamadas já ativas ao abrir.
- O botão do operador foi simplificado para “Reanunciar aqui”, reproduzindo o mesmo toque/locução com uma repetição; removido o botão separado “Chamar com voz” para evitar duplicidade de áudio entre operador e painel.
- A atualização da fila de chamadas passou a ocorrer a cada 5 segundos, sem sobrepor requisições; o painel de Enfermagem também exibe a localização junto ao nome do paciente.
- Cartões de indicadores de Gestão, Oficina Terapêutica e outros resumos receberam estilo consistente e respeitam `prefers-reduced-motion`.
- Validações executadas: `npm run lint`, `npm run typecheck` e `npm run build` passaram. O build ainda reporta o aviso conhecido de chunk acima de 500 kB.

### Ainda pendente
- A homologação P0/P1/P2 descrita acima continua necessária com TI e usuários de teste autorizados; build e lint não substituem validação dos fluxos em runtime.
- Confirmar no ambiente de apresentação o comportamento de chamadas, layout responsivo/temas, permissões e fluxos clínicos integrados com dados fictícios.

## Implementação da triagem de Enfermagem

### Concluído nesta rodada
- Criada a aba “Triagem” da Enfermagem usando as chegadas ativas da fila da Recepção. A equipe registra o estado de alergias, alergias confirmadas/relatadas, condições ou tratamentos informados e sinais vitais aferidos.
- Cada gravação é um snapshot do atendimento, append-only, com autoria e horário. Não altera alergias do cadastro global, não cria diagnóstico e não classifica risco automaticamente.
- Criada a fila “Aguardando avaliação” no módulo Médico, separada da guia de pacientes cadastrados, exibindo o snapshot mais recente e permitindo abrir a ficha clínica quando a chegada estiver vinculada a um paciente.
- Escopo confirmado pelo usuário: somente chegadas ativas da fila da Recepção; agendamentos marcados como “chegou” não são incluídos nesta entrega.
- Adicionada a migração `0047_nursing_triage`; a migração `0048_reception_announcement_version` acrescenta a versão das chamadas públicas. A tabela de triagens é criada somente no banco Nursing.
- Adicionados testes de validação, revisões append-only, seleção do snapshot mais recente, fila médica, bloqueio de chegadas encerradas e isolamento da migração por serviço.

### Validação
- `npm run lint`, `npm run typecheck` e `npm run build` passaram. O build continua exibindo o aviso conhecido do chunk JavaScript acima de 500 kB.
- Ruff passou nos arquivos Python alterados.
- `uv run pytest backend/tests -q` passou na validação desta retomada; os testes agora também cobrem a revisão mais recente das migrações e a versão de anúncio retornada pela fila pública.
- A validação de runtime com usuários autorizados e dados fictícios continua pendente; as verificações locais não substituem homologação clínica.
- Commit e push das entregas anteriores já foram realizados.

## Retomada complementar — 2026-10-26

### Correção feita
- A inicialização dos serviços ainda exigia `0047_nursing_triage`, apesar de `0048_reception_announcement_version` já ser a migração mais recente. Isso impedia o startup de APIs locais e bloqueava a execução da E2E.
- O ID dessa migração excedia o limite de 32 caracteres do campo padrão `alembic_version` em PostgreSQL. Ele foi encurtado para `0048_reception_announce`, a validação passou a exigir esse head e o ID longo anterior é normalizado para preservar bancos SQLite já existentes.
- O teste da fila pública foi atualizado para verificar também o campo `announcement_version`, usado pelo painel de chamadas.

### Validação
- `npm run test:e2e`: passou no fluxo Recepção → triagem da Enfermagem → fila Médico, usando bancos SQLite temporários.
- `uv run pytest backend/tests -q`: passou.
- Ruff dos arquivos backend alterados, `npm run lint`, `npm run typecheck`, `npm run build` e `git diff --check`: passaram.
- O build continua emitindo apenas o aviso informativo de chunk principal acima de 500 kB. Nenhum serviço implantado ou dado clínico real foi acessado.

### Em aberto
- Homologar permissões e fluxos em ambiente autorizado com dados fictícios.
- Expandir E2E para prescrição → Farmácia/Enfermagem, Oficina Terapêutica e ações administrativas.
- Projetar uma exclusão recuperável/idempotente para o perfil médico distribuído entre serviços, após aprovação institucional.
