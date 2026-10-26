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

O projeto não declara um comando de testes de interface no `package.json`; a checagem do frontend nesta rodada cobriu lint, TypeScript e build, não uma execução automatizada de navegador.

**Recomendação:** adicionar testes E2E focados nos fluxos intermodulares de maior risco: chegada da Recepção → triagem da Enfermagem → fila médica; prescrição → Farmácia/Enfermagem; Oficina → presença/relatório; e ações administrativas de conta. Usar dados e credenciais de teste isolados.

### P2 — Tamanho do chunk principal

O chunk principal permanece acima do limite informativo de 500 kB do Vite. O arquivo minificado mede aproximadamente 534 kB e transfere aproximadamente 147 kB comprimido com gzip. Não bloqueia o funcionamento atual, mas pode aumentar o tempo de carregamento inicial em equipamentos ou redes lentos.

**Recomendação:** acompanhar o tamanho em CI e investigar divisão adicional por rota ou dependência somente se houver impacto observado; evitar aumentar o limite de aviso sem medir o resultado.

## Limites desta revisão

Esta revisão encontrou problemas e verificou as superfícies automatizáveis disponíveis no repositório, mas não prova que todas as combinações de perfil, módulo, aba e estado operacional foram exercitadas. Nenhum serviço implantado foi acessado ou alterado. A homologação institucional, a checagem de permissões em runtime e a avaliação de retenção/auditoria continuam necessárias antes de uso com dados reais.
