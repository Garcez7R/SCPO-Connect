# Preparação para piloto com dados reais

## Situação atual

O app ainda não está habilitado para dados reais. Foi implementado login local individual com scrypt, MFA TOTP, sessões HttpOnly assinadas e autorização no backend; `X-Demo-Role` não é mais aceito. O fluxo ainda precisa de revisão/validação, segurança de recuperação e auditoria clínica. A trilha existente cobre operações de administração de contas, não consultas ou alterações clínicas.

O cadastro de paciente e os registros de sinais vitais também usam referências `DEMO-*`. Preserve esse isolamento até que a identidade institucional esteja integrada e revisada. A interface mantém os avisos de dados de teste enquanto esse bloqueio estiver vigente.

## Decisões atuais e controles pendentes

1. O deploy interno usará `tls internal` do Caddy e sua CA privada. A raiz pública deve ser instalada como confiável nos aparelhos autorizados; valide a impressão digital por canal independente. O volume `caddy_data` deve ser persistente e ter backup protegido. Se o domínio/IP ou a CA mudar, os aparelhos precisam receber a atualização da confiança.
2. Validar a identidade no servidor. O navegador não pode escolher nome, função ou permissões por cabeçalho. Mapear grupos institucionais para permissões mínimas no backend e negar por padrão.
3. Gerar autoria com a identidade validada pelo servidor. Registrar consultas e alterações relevantes, com horário, usuário, ação, módulo e identificador do registro; evitar copiar conteúdo clínico para os logs. Proteger a trilha contra alteração e definir retenção/acesso.
4. O Active Directory do Zentyal está adiado, sem previsão por depender de orçamento. Foram escolhidas contas locais individuais do SCPO com senha e MFA; validar política de recuperação/redefinição, bloqueio, revogação e suporte. O certificado TLS interno não faz login de usuário.
5. Validar finalidade e base legal, controlador/operador, encarregado, retenção, direitos dos titulares, resposta a incidentes, backup/recuperação e fluxos clínicos com as áreas responsáveis.
6. Revisar e aprovar o piloto com TI, segurança, encarregado de dados, jurídico e responsáveis assistenciais; habilitar dados reais somente depois de identidade, autorização, autoria, auditoria e fluxos validados.

O escopo funcional agora inclui Enfermagem, Farmácia, Raio X, Serviço Social, Nutrição, Higienização, Recepção, Oficina Terapêutica e Gestão Hospitalar. Gestão Hospitalar foi solicitada como perfil com acesso clínico total; esse privilégio exige auditoria de leituras e alterações antes de qualquer liberação. A proposta de campos e acesso por área está em [cadastro central e acesso aos dados](patient-access-model.md).

## Referências

- [Lei nº 13.709/2018 (LGPD), texto oficial compilado](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm): arts. 5º, II; 6º, VII e VIII; 11; 46 a 50.
- [Lei nº 13.787/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13787.htm): digitalização, uso de sistemas informatizados e guarda de prontuários.
- [ANPD, Guia de Segurança da Informação](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_seguranca_da_informacao_para_atpps___defeso_eleitoral.pdf).
- [ANPD, Regulamento de Comunicação de Incidente de Segurança, Resolução CD/ANPD nº 15/2024](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-aprova-regulamento-de-comunicacao-de-incidente-de-seguranca).

Este documento é uma lista técnica de preparação, não uma declaração de conformidade nem orientação jurídica. Os responsáveis institucionais devem confirmar a legislação e as políticas vigentes antes do piloto.
