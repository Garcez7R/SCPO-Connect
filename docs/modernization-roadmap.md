# Navegação, sistema legado e PWA de Enfermagem

## Direção de navegação

Manter o menu lateral como navegação entre módulos. As funções de cada módulo ficam na primeira área de conteúdo, organizadas em guias internas: botões lado a lado no desktop para conjuntos pequenos e um seletor expansível para conjuntos maiores ou telas estreitas. Breadcrumbs e a preferência de guia por sessão continuam ligados ao `PageNavigationContext`.

O componente compartilhado `ModuleTabNavigation` iniciou essa padronização em Pacientes, Enfermagem, Farmácia, Central de Exames, Gestão Hospitalar e Administração. Os demais módulos podem migrar gradualmente, preservando suas funções e os identificadores persistidos das guias. A migração deve evitar alterar simultaneamente navegação, permissões e regras operacionais.

## Levantamento do sistema antigo

O repositório atual não contém fontes Visual Basic, executáveis nem cópia do banco do sistema antigo. Portanto, este documento não presume quais funções ele possui. Antes de portar qualquer fluxo, registrar para cada função observada:

| Informação a levantar | Pergunta para a equipe |
| --- | --- |
| Nome e caminho da tela | Em qual menu e tela a função aparece? |
| Usuário responsável | Quais funções profissionais podem consultar, registrar, revisar ou corrigir? |
| Gatilho operacional | O que inicia a tarefa e com que frequência ela ocorre? |
| Dados de entrada | Quais campos são obrigatórios e quais são opcionais? |
| Resultado e destino | Que documento, fila, relatório ou decisão a tela produz? |
| Exceções | Como são tratados cancelamentos, correções, duplicidade e indisponibilidade? |
| Evidência | Captura de tela sem dados pessoais, manual, formulário em branco ou descrição validada pela área. |

### Mapa preliminar para comparação

Os itens abaixo são áreas já presentes no SCPO Connect para orientar a comparação. Eles não afirmam que o sistema legado possui as mesmas funções.

| Área conhecida no SCPO Connect | Possível contraparte a procurar no legado | Situação |
| --- | --- | --- |
| Cadastro compartilhado, Recepção e internação | Cadastro, admissão, transferência e alta | Comparar telas, responsáveis e campos antes de decidir |
| Enfermagem: sinais vitais, triagem e verificação horária | Folha de sinais, controles de turno e rondas | Validar frequência, autoria e forma de correção |
| Médico, prescrições, Farmácia e Enfermagem | Prescrição, dispensação e administração | Desenhar o fluxo completo; não copiar registros entre serviços |
| Central de Exames | Solicitação, coleta e resultado de exames | Identificar integrações, impressão e estados usados |
| Serviço Social, Psicologia/Psiquiatria e Nutrição | Atendimento e acompanhamento multiprofissional | Validar confidencialidade e limites de compartilhamento |
| Oficina Terapêutica | Agenda, participação e relatórios de atividades | Comparar listas, horários e relatórios efetivamente usados |
| Gestão Hospitalar, leitos, manutenção e higienização | Censo, ocupação, pendências e operação predial | Separar indicadores de ações que alteram registros |
| Administração e auditoria | Usuários, permissões, relatórios e trilha de alterações | Preservar privilégio mínimo e autoria individual |

Após o levantamento, cada função deve ser classificada como: já atendida; lacuna aprovada; duplicada/inativa; ou dependente de decisão institucional. Só lacunas validadas devem virar trabalho de produto.

## PWA focado de Enfermagem

### Escopo inicial

- Interface instalável e responsiva para sinais vitais e verificação horária.
- Mesmas APIs, cadastro de paciente, permissões, auditoria, identidade e bancos do SCPO Connect; não criar um segundo sistema clínico.
- Login e sessão existentes, com seleção explícita do paciente e confirmação de autoria e horário do registro.
- Validação pelo serviço central e retorno visível de sucesso ou falha. Reenvio deve evitar duplicar uma coleta.
- O sistema desktop continua sendo a interface completa; o PWA é um atalho de coleta, não um substituto das demais guias da Enfermagem.

### Limite de conectividade

O primeiro piloto deve exigir conexão com o servidor. Não guardar sinais vitais ou verificações horárias em armazenamento local para envio posterior. O service worker pode entregar a interface estática/offline, mas isso não significa que gravações clínicas estejam disponíveis offline. Qualquer modo offline exigirá decisão institucional separada sobre autenticação do dispositivo, criptografia e retenção local, identificação do paciente, timestamp confiável, autoria, idempotência, conflito e limpeza dos dados do aparelho.

### Fases e critérios de avanço

1. **Mapear:** equipes validam tarefas e telas correspondentes no programa antigo; documentar campos, autoria, periodicidade e exceções.
2. **Prototipar:** testar navegação mobile e a seleção de paciente com profissionais, sem persistir dados reais.
3. **Implementar conectado:** reaproveitar os endpoints existentes, verificar permissões no backend e cobrir falhas/reenvio com testes.
4. **Piloto controlado:** testar em ambiente segregado, com dados fictícios, aparelhos autorizados e critérios de interrupção.
5. **Avaliar:** considerar uso offline somente após revisão de segurança, infraestrutura e operação e aprovação institucional.

Nenhuma fase autoriza implantação ou uso de dados clínicos reais por si só. A prontidão descrita em [pilot-security-readiness.md](./pilot-security-readiness.md) continua obrigatória.
