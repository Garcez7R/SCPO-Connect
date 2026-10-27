# Relatório de revisão do SCPO Connect

**Data:** 26/10/2026
**Branch revisada:** `main`

## Resumo

Foram corrigidos os três pontos reportados: a marca d'água do menu agora se repete em marcas menores e aparece nos temas claro e escuro; o superadministrador ganhou uma ação de exclusão de contas na tela de recuperação de acesso; e a tradução de erros de validação deixou de perder o nome do campo quando a localização do erro contém índices de listas.

A exclusão de contas já estava disponível na Administração do aplicativo. A alteração desta rodada acrescenta a mesma ação à interface do superadministrador. O backend mantém as proteções existentes contra autoexclusão, exclusão da conta superadministradora e remoção da última conta ativa de Gestão Hospitalar.

## Revisões e validações realizadas

- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm run build`: passou. O build ainda apresenta o aviso do Vite sobre o chunk principal acima de 500 kB (533,91 kB minificado; 146,70 kB gzip). É um aviso de desempenho potencial, não uma falha de compilação.
- Ruff nos arquivos backend alterados: passou.
- `uv run pytest backend/tests -q`: passou, incluindo testes de exclusão por Administração e superadministrador.
- Inventário estático de integração: 159 rotas declaradas no backend e 136 literais de rotas da API no frontend; nenhuma das 136 ficou sem uma rota backend correspondente.
- `git diff --check`: passou.

## Alterações desta rodada

### Marca d'água do menu lateral

O fundo anterior era uma única imagem grande posicionada na parte inferior. Agora o SVG é um motivo médico pequeno, repetido pelo fundo inteiro do menu. A opacidade foi aumentada para dar contraste sobre as superfícies claras e escuras, sem colocar a decoração acima do conteúdo interativo.

### Exclusão de usuários

A tela de Administração do aplicativo já permitia excluir contas comuns. A tela exclusiva do superadministrador agora também oferece essa opção na lista de contas elegíveis. A confirmação informa o usuário e deixa claro que a ação é permanente. A conta superadministradora não aparece como alvo e continua protegida pelo backend.

### Erro da Oficina Terapêutica

O formatador de erros usava o último item da localização de validação, mesmo quando era um índice numérico de lista, e nesse caso mostrava apenas “Campo”. Agora usa o último segmento textual, ignora os índices e inclui nomes como “Participantes” e “Presença” no mapeamento. A validação continua explícita: o ajuste não aceita dados inválidos nem transforma falhas em sucesso. Como não foi possível reproduzir a tentativa operacional original, a mensagem mais precisa deve ser confirmada no fluxo real da Oficina.

## Achados e recomendações

### P1 — Exclusão de perfil médico envolve dois serviços

Ao excluir uma conta com acesso médico, o serviço de Acesso solicita primeiro a remoção do perfil médico ao serviço Nursing e só depois remove a conta local. Como não há transação distribuída entre os bancos/serviços, uma falha no commit local após a remoção do perfil pode deixar a conta existente sem o perfil associado.

**Recomendação:** evoluir a exclusão para uma operação idempotente e recuperável, por exemplo desativar/revogar a conta primeiro e processar a limpeza do perfil por uma fila/outbox com retentativas e estado visível ao administrador. Validar com TI antes de mudar a semântica de retenção ou exclusão de contas.

### P2 — Validação de interface em runtime continua necessária

Build, lint, typecheck, testes backend e correspondência estática das rotas passaram, mas não exercitam navegação real, sessões, permissões implantadas, layouts em dispositivos nem respostas dos serviços em execução.

**Recomendação:** homologar com contas autorizadas e dados fictícios: alternar tema e conferir a marca d'água; excluir uma conta de teste tanto pela Administração quanto pelo superadministrador; confirmar que autoexclusão e exclusão do superadministrador são recusadas; e executar criação de atividade, presença e relatório na Oficina Terapêutica. Não usar dados clínicos reais para esse teste.

### P2 — Cobertura de integração do frontend

O projeto oferece `npm run test:e2e` com bancos SQLite temporários, e o fluxo Recepção → triagem da Enfermagem → fila Médica passou no navegador nesta verificação complementar. A cobertura automatizada ainda é parcial.

**Recomendação:** ampliar E2E para prescrição → Farmácia/Enfermagem, Oficina → presença/relatório e ações administrativas de conta. Manter dados e credenciais de teste isolados.

### P2 — Tamanho do chunk principal

O chunk principal permanece acima do limite informativo de 500 kB do Vite. O arquivo minificado mede aproximadamente 534 kB e transfere aproximadamente 147 kB comprimido com gzip. Não bloqueia o funcionamento atual, mas pode aumentar o tempo de carregamento inicial em equipamentos ou redes lentos.

**Recomendação:** acompanhar o tamanho em CI e investigar divisão adicional por rota ou dependência somente se houver impacto observado; evitar aumentar o limite de aviso sem medir o resultado.

## Limites desta revisão

Esta revisão encontrou problemas e verificou as superfícies automatizáveis disponíveis no repositório, mas não prova que todas as combinações de perfil, módulo, aba e estado operacional foram exercitadas. Nenhum serviço implantado foi acessado ou alterado. A homologação institucional, a checagem de permissões em runtime e a avaliação de retenção/auditoria continuam necessárias antes de uso com dados reais.

## Complemento: fila, pacientes e relatórios

Nesta rodada, a fila do pronto atendimento passou a abrir em **Em andamento**, mantendo a consulta **Todas** paginada e com filtro de período opcional. A API continua entregando páginas limitadas, e o filtro `active` inclui somente chegadas aguardando, chamadas ou em atendimento; assim, a tela não precisa carregar todo o histórico para exibir o trabalho atual.

No módulo Médico, os pacientes são consultados em páginas de 50, com separação entre registros com quarto e leito atribuídos e cadastros sem ambos. O filtro de perfil permite distinguir clínico, psiquiátrico e combinado, com identificação visual. A classificação de internação é baseada nos campos quarto/leito disponíveis no cadastro; deve ser conferida com a operação de leitos antes de ser tratada como censo hospitalar oficial.

A triagem da Enfermagem e os atendimentos ambulatoriais já estavam disponíveis no centro de relatórios da Administração e na área de relatórios da Gestão Hospitalar. Foi confirmado que a primeira usa `/api/v1/management/reports/triages` e a segunda `/api/v1/reception/encounters`, com acesso ao histórico salvo; o item ambulatorial agora está identificado como **Ambulatório · consultas e atendimentos**. Os relatórios abrangem registros persistidos nesses fluxos, não constituem confirmação de que todo atendimento realizado fora deles esteja integrado.

Na Oficina Terapêutica, o formulário valida localmente nome, modalidade, local e data/hora; a API também rejeita nome e local vazios após remover espaços. Quando o servidor retorna apenas “Dados da solicitação”, a interface orienta a revisar os campos principais em vez de repetir a mensagem genérica.

Validações desta rodada: lint, typecheck e build do frontend; Ruff nos arquivos backend alterados; 48 testes direcionados de Enfermagem e relatórios da Oficina Terapêutica; e `git diff --check`. O build continua exibindo aviso de chunk principal acima de 500 kB (539,02 kB minificado; 148,49 kB gzip), sem falha de compilação.

Continuam pendentes os itens já apontados acima: operação recuperável para exclusão distribuída de perfil médico, homologação institucional das permissões e fluxos, ampliação da cobertura E2E e validação operacional da classificação por quarto/leito antes de tratá-la como ocupação oficial.

## Verificação complementar — 26/10/2026

A execução da E2E isolada encontrou um bloqueio real de inicialização: a checagem de versão dos serviços ainda esperava `0047_nursing_triage`, embora a migração mais recente já fosse a de chamadas públicas. A migração `0048` também tinha um identificador acima do limite de 32 caracteres do campo padrão `alembic_version` no PostgreSQL. O ID foi encurtado para `0048_reception_announce`, com normalização do ID anterior para preservar bancos SQLite que já o tenham gravado. A validação de inicialização e os testes de migração foram alinhados à revisão curta. O teste da fila pública também passou a verificar o campo `announcement_version` já usado pelo painel.

Validações complementares: `npm run test:e2e` passou (1 fluxo Recepção → Enfermagem → Médico); `uv run pytest backend/tests -q` passou; Ruff nos arquivos backend alterados passou; `npm run lint`, `npm run typecheck` e `npm run build` passaram; `git diff --check` passou. O build mantém o aviso informativo do chunk principal acima de 500 kB. Os testes E2E usaram apenas bancos temporários locais; nenhum serviço implantado ou dado real foi acessado.

A homologação com usuários institucionais autorizados e dados fictícios permanece necessária, assim como os cenários E2E adicionais e a operação recuperável para exclusão distribuída de perfil médico descrita acima.
