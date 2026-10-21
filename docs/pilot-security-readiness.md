# Preparação para piloto com dados reais

## Situação atual

O app ainda não deve ser liberado para uso assistencial com dados reais. O login local usa contas individuais, MFA TOTP, sessões HttpOnly assinadas e autorização no backend. A API não aceita `X-Demo-Role`. As APIs agora enviam eventos mínimos de leitura e alteração para Auditoria, sem conteúdo clínico; essa entrega é best-effort e não bloqueia a operação quando o serviço de auditoria está indisponível. A trilha precisa de entrega durável, proteção contra alteração e política de retenção antes do piloto.

O cadastro compartilhado usa referências UUID reais. Os módulos de Enfermagem, Nutrição, Oficina Terapêutica, Serviço Social, Raio X e Ordens de Serviço validam ou persistem o vínculo com esse cadastro. O banco impede referências órfãs nos registros clínicos do banco de Enfermagem; os serviços em bancos separados validam a referência pela API interna.

As validações de sinais vitais cobrem presença, formato, consistência entre valor e “não aferido”, saturação entre 0 e 100 e preenchimento dos componentes de pressão. Limites clínicos para os demais indicadores e alertas não foram definidos: devem ser aprovados pelos responsáveis assistenciais antes da configuração. O app não interpreta os valores nem orienta condutas.

A prioridade das chegadas à emergência é atribuída manualmente e não implementa protocolo validado de triagem. Transferências, altas, contraindicações e indicadores de Gestão Hospitalar são registros operacionais; não fazem classificação ou recomendação clínica automatizada. Validar esses fluxos, terminologia, responsáveis e permissões com as equipes assistenciais antes de qualquer piloto.

## Decisões atuais e controles pendentes

1. O deploy interno usará `tls internal` do Caddy e sua CA privada. A raiz pública deve ser instalada como confiável nos aparelhos autorizados; valide a impressão digital por canal independente. O volume `caddy_data` deve ser persistente e ter backup protegido. Se o domínio/IP ou a CA mudar, os aparelhos precisam receber a atualização da confiança.
2. Validar a identidade no servidor. O navegador não pode escolher nome, função ou permissões por cabeçalho. Mapear grupos institucionais para permissões mínimas no backend e negar por padrão.
3. Gerar autoria com a identidade validada pelo servidor. Os eventos mínimos já registram horário, usuário, ação, módulo e referência do paciente/registro. Substituir o envio best-effort por outbox durável, proteger a trilha contra alteração e definir retenção/acesso antes do piloto.
4. O Active Directory do Zentyal está adiado, sem previsão por depender de orçamento. Foram escolhidas contas locais individuais do SCPO com senha e MFA; validar política de recuperação/redefinição, bloqueio, revogação e suporte. O certificado TLS interno não faz login de usuário.
5. Validar finalidade e base legal, controlador/operador, encarregado, retenção, direitos dos titulares, resposta a incidentes, backup/recuperação e fluxos clínicos com as áreas responsáveis.
6. Revisar e aprovar o piloto com TI, segurança, encarregado de dados, jurídico e responsáveis assistenciais; habilitar dados reais somente depois de identidade, autorização, autoria, auditoria e fluxos validados.

As áreas atualmente disponíveis na interface incluem cadastro de pacientes, Enfermagem, Médico (consulta, gráficos e prescrições), Farmácia (estoque e dispensações), Central de Exames, Serviço Social, Nutrição, Recepção, Oficina Terapêutica, Manutenção, Higienização, Psicologia/Psiquiatria e Gestão Hospitalar. Os fluxos da aplicação são demonstrativos e não substituem protocolos assistenciais; a disponibilidade da tela não equivale à aprovação institucional. As receitas impressas são simples, exigem assinatura manual e não se destinam a medicamentos controlados; prescrições internas aceitam qualquer medicamento, inclusive controlados. Validar legalmente os modelos, atribuições e fluxo de atendimento antes de qualquer uso real. Gestão Hospitalar tem acesso clínico amplo no protótipo; a liberação desse perfil depende de auditoria confiável e validação institucional. A proposta de campos e acesso por área está em [cadastro central e acesso aos dados](patient-access-model.md).

O perfil **Superadministrador do Sistema** é separado da Gestão Hospitalar. A migração reserva o login `rgarcez` como mantenedor; em uma instalação nova, o bootstrap precisa ser concluído com esse mesmo login (ou com `SCPO_SUPERADMIN_USERNAME` definido antes das migrações). Administradores comuns não recebem acesso a backup nem redefinição de credenciais e não podem alterar a conta superadministradora. A ação emergencial de redefinir todas as contas encerra sessões, remove o MFA cadastrado e gera senhas aleatórias de uso único; os códigos aparecem uma única vez na sessão do navegador e devem ser entregues por canal seguro. A trilha atual de auditoria ainda é best-effort, portanto esse controle não substitui processo institucional de dupla conferência, outbox durável nem monitoramento.

Gestão Hospitalar apresenta os indicadores operacionais agregados já disponibilizados pelos módulos. Ainda não é um ERP hospitalar completo: capacidade física de leitos, ocupação percentual, faturamento, custos, produção regulatória, contratos, dimensionamento de pessoal e integração com sistemas externos dependem de fontes de dados e requisitos institucionais que ainda não foram levantados. Não interpretar números ausentes como zero.

## Validação operacional antes do piloto

A caixa de tarefas reúne filas operacionais disponíveis ao perfil autenticado e exibe a prioridade já registrada pela equipe; não calcula risco clínico nem substitui a abertura do módulo de origem. Pendências de medicação significam apenas uma dispensação sem registro de administração correspondente. Não inferem horário, dose devida ou atraso.

Na Farmácia, a indicação FEFO é apenas uma ordenação informativa pelo vencimento mais próximo entre lotes válidos com saldo do mesmo produto; não seleciona lote nem substitui a conferência ou a política institucional.

No Docker Compose, cada API possui um healthcheck básico em `/health`, e o proxy aguarda as APIs ficarem saudáveis. Isso verifica que os processos respondem após a inicialização e as migrações, mas não é monitoramento externo, alerta de indisponibilidade, teste ponta a ponta nem evidência de que uma restauração foi validada. O ambiente hospitalar ainda precisa de verificação operacional e de monitoramento apropriado.

Não habilitar agenda de doses, reconciliação medicamentosa ou alertas de administração até que responsáveis assistenciais e farmacêuticos definam e aprovem formalmente protocolo, fonte da prescrição, horários, exceções, tratamento de recusas/suspensões, autoria, auditoria e responsabilidade pelas decisões. A interface atual não realiza essas funções.

Antes de ampliar o uso, conduzir sessões observadas com profissionais de cada perfil, usando ambiente e dados de teste. Percorrer admissão de paciente, registro de chegada, aferição de sinais vitais, dispensação e registro de administração, transferência e solicitação/execução de manutenção. Para cada fluxo, registrar tempo de conclusão, erros, campos omitidos, duplicidades, correções e pontos de hesitação; incluir uso em celular/tablet, teclado e leitor de tela quando aplicável. Revisar os resultados com as equipes, corrigir os bloqueios e repetir os testes antes de qualquer piloto com dados reais.

## Referências

- [Lei nº 13.709/2018 (LGPD), texto oficial compilado](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm): arts. 5º, II; 6º, VII e VIII; 11; 46 a 50.
- [Lei nº 13.787/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13787.htm): digitalização, uso de sistemas informatizados e guarda de prontuários.
- [ANPD, Guia de Segurança da Informação](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_seguranca_da_informacao_para_atpps___defeso_eleitoral.pdf).
- [ANPD, Regulamento de Comunicação de Incidente de Segurança, Resolução CD/ANPD nº 15/2024](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-aprova-regulamento-de-comunicacao-de-incidente-de-seguranca).

Este documento é uma lista técnica de preparação, não uma declaração de conformidade nem orientação jurídica. Os responsáveis institucionais devem confirmar a legislação e as políticas vigentes antes do piloto.
