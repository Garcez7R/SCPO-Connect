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

## PWAs móveis

### Enfermagem

- Entrada instalável independente em `/nursing.html`, com manifesto próprio e acesso pelo botão **PWA móvel** na Enfermagem completa.
- Reutiliza autenticação, permissões, autoria e APIs existentes. A Enfermagem usa aparelhos institucionais.
- Coleta de sinais vitais e verificações de uma ronda já carregada podem ser protegidas em armazenamento local cifrado e enviadas quando a rede voltar. Iniciar e encerrar rondas continuam exigindo conexão.
- Cada ação offline tem identificador idempotente, horário do aparelho e validade de 24 horas. Reenvios repetidos são deduplicados pelo serviço; autoria é sempre a conta autenticada no servidor.
- O login offline não é permitido. Para recuperar pendências após fechar/recarregar o PWA sem rede, é necessário reconectar e autenticar no servidor. Registros só são considerados no histórico depois da confirmação do servidor.

### Manutenção e Higienização

- Entrada instalável independente em `/operations.html`, com manifesto próprio e acesso nas páginas completas das equipes.
- Celulares pessoais podem consultar, sem conexão, uma cópia cifrada e limitada a 24 horas das filas autorizadas. Os dados ficam separados por usuário e por aplicação; o service worker não armazena respostas de API.
- O PWA é somente leitura: criar, alterar e encerrar ordens exige conexão. A Higienização só libera o leito depois da confirmação do servidor.
- A autenticação offline não é permitida. O cache só pode ser consultado enquanto a sessão previamente autenticada permanecer aberta; após fechar ou recarregar sem rede, é necessário autenticar novamente quando o servidor estiver acessível. Sair apaga o cache operacional do aparelho.

### Limites e prontidão

O service worker pré-carrega a interface e os recursos estáticos dos três pontos de entrada, sem guardar `/api/`. O cache cifrado permite continuidade em sessão ativa, mas não é mecanismo de gerenciamento do aparelho nem autorização para uso de dados reais em celulares pessoais. Criptografia de armazenamento, bloqueio do aparelho, sessão, limpeza, retenção, privacidade e resposta a incidentes ainda precisam de validação institucional e teste nos dispositivos-alvo.

1. **Mapear:** equipes validam tarefas e telas correspondentes no programa antigo; documentar campos, autoria, periodicidade e exceções.
2. **Prototipar e testar:** validar navegação, cache e restauração de conexão com contas e dados fictícios nos aparelhos-alvo.
3. **Implementar:** interfaces móveis, armazenamento cifrado, idempotência clínica, políticas diferenciadas e acesso somente leitura nas equipes operacionais.
4. **Piloto controlado (pendente):** realizar testes observados em ambiente segregado, definir critérios de interrupção e obter aprovação de TI, segurança, encarregado de dados e equipes.

Nenhuma fase autoriza implantação ou uso de dados reais por si só. A prontidão descrita em [pilot-security-readiness.md](./pilot-security-readiness.md) continua obrigatória.

Nenhuma fase autoriza implantação ou uso de dados clínicos reais por si só. A prontidão descrita em [pilot-security-readiness.md](./pilot-security-readiness.md) continua obrigatória.
