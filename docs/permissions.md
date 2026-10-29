# Autenticação e permissões

## Estado atual

O login local, troca obrigatória da senha inicial, MFA TOTP, sessão HttpOnly assinada e verificação de permissões no backend foram implementados. `X-Demo-Role` deixou de ser aceito. A integração com AD Zentyal está adiada. A implementação ainda precisa de revisão e validação antes de qualquer uso com dados reais. Os eventos instrumentados são enfileirados na mesma transação do serviço de origem, enviados com retentativas e registrados em uma cadeia de hashes append-only, com endpoint de verificação de integridade. A cobertura clínica não é integral, e a trilha depende dos bancos e backups da implantação: não tratá-la como prontuário completo ou cópia imutável externa.

O perfil **Superadministrador do Sistema** é um privilégio independente dos módulos de Gestão Hospitalar e Administração. O login definido por `SCPO_SUPERADMIN_USERNAME` (padrão `rgarcez`) é marcado na migração ou no bootstrap. A conta não pode ser alterada pelos administradores comuns; redefinição de credenciais, encerramento de sessões, MFA e backup são operações exclusivas do superadministrador. A conta criada pelo bootstrap autorizado de uma instalação vazia recebe a senha inicial `0000`, que deve ser trocada no primeiro acesso; a migração que marca uma conta existente como superadministradora não altera sua senha. Não use o bootstrap para sobrescrever um banco já inicializado nem altere manualmente uma conta antes de confirmar o ambiente correto. Contas criadas depois pela Administração recebem senhas aleatórias, exibidas uma única vez, e exigem troca e novo cadastro de MFA. O serviço não oferece um fluxo alternativo para promover outra conta.

A Administração separa dois escopos: **Usuários e permissões** (contas, permissões e perfis profissionais) e **Relatórios e auditoria** (consulta aos relatórios digitais e aos eventos registrados). A gestão de contas está disponível no módulo Administração do aplicativo e também na guia Usuários e permissões da Administração do Sistema para o Superadministrador. Ambos podem consultar os relatórios digitais disponíveis; o escopo somente de relatórios não concede acesso de operação aos módulos, nem administração de contas. O administrador do aplicativo recebe acesso aos módulos operacionais e administrativos de dados, conforme solicitado pela instituição; não recebe as funções de backup/restauração, reservadas à conta superadministradora. A Gestão Hospitalar continua sendo uma visão operacional ampla, sem substituir um sistema financeiro/ERP hospitalar completo. Os logs e a recuperação de acesso continuam dependendo de validação operacional da instituição e da melhoria de durabilidade e resistência à alteração da trilha.

## Matriz efetiva no código

O sistema não possui cargos operacionais fixos: os módulos e ações são atribuídos por conta. A tabela abaixo descreve o comportamento atual da API e da tela de Administração, não uma matriz aprovada pela Santa Casa.

Psicologia e Psiquiatria permanecem reunidas no mesmo módulo, com áreas de trabalho separadas na interface e registros tipados. Para o profissional psiquiatra que também prescreve, atribua os módulos **Psicologia / Psiquiatria** e **Médico**. A prescrição deve ser criada no módulo Médico, que já alimenta os fluxos compartilhados de Farmácia e Enfermagem; não manter um segundo formulário de prescrição no módulo psicológico. O acesso ao módulo Médico deve ser concedido individualmente conforme função e aprovação institucional, não automaticamente a toda conta de Psicologia / Psiquiatria.

| Acesso atribuído | Consultar | Criar | Alterar | Excluir/arquivar | Administrar contas |
| --- | --- | --- | --- | --- | --- |
| Módulo operacional individual | Sim, se selecionado | Sim, padrão | Sim, padrão | Opcional somente para Pacientes, Enfermagem, Nutrição e Recepção | Não |
| Gestão Hospitalar | Todos os módulos | Todos os módulos | Todos os módulos | Todos os módulos | Não |
| Administração do aplicativo | Todos os módulos operacionais | Todos os módulos operacionais | Todos os módulos operacionais | Conforme módulo | Sim |
| Relatórios e auditoria | Todos os relatórios digitais disponíveis e eventos registrados | Não | Não | Não | Não |
| Superadministrador | Todos os módulos | Todos os módulos | Todos os módulos | Todos os módulos | Backup, restauração e recuperação de acesso |

Gestão Hospitalar e Administração do aplicativo são perfis amplos de módulos no backend, mas somente Administração do aplicativo e Superadministrador podem listar, criar, editar, redefinir credenciais ou excluir contas. Administração do aplicativo pode gerenciar contas com qualquer escopo, inclusive Gestão Hospitalar; conceder esse acesso amplo continua exigindo aprovação institucional. A Administração do aplicativo não concede acesso à API de backup/restauração: essas rotas verificam explicitamente o privilégio `is_superuser`. O superadministrador é independente e reservado; outros administradores não podem promovê-lo nem alterar sua conta.

As ações gerais correspondem a `consultar`, `criar`, `alterar`, `excluir` e `administrar`. A autorização é checada no backend; esconder ou desabilitar um controle na interface não substitui essa checagem. A opção de arquivamento na interface existe somente para Pacientes, Enfermagem, Nutrição e Recepção.

Antes de uso real, os responsáveis de cada área devem aprovar uma matriz nominal com módulo, ação, dados/campos acessíveis, justificativa, aprovador, validade e revisão. A concessão de Administração do aplicativo equivale a acesso operacional amplo e deve ser limitada às contas formalmente autorizadas.

| Controle | Estado | Para dados reais |
| --- | --- | --- |
| Identidade de usuário | Contas locais com senha e MFA TOTP | Revisar requisitos, recuperação, rotação de segredos e procedimento de suporte |
| Permissões por módulo | Persistidas por conta e conferidas nas rotas | Validar matriz institucional por usuário, módulo, ação e campo |
| Autoria | ID estável da conta autenticada no registro de sinais vitais | Auditar todos os acessos e alterações clínicas e revisar retenção |
| Auditoria | Outbox transacional por serviço, retentativas, cadeia SHA-256 append-only e verificação de integridade | Ampliar cobertura, monitorar pendências, definir retenção e manter cópia imutável externa |
| AD Zentyal | Adiado por orçamento | Integrar futuramente, se aprovado, mantendo identidade e acesso individual |

Não use dados pessoais ou clínicos reais até concluir os controles acima e a validação institucional descrita em [Preparação para piloto com dados reais](pilot-security-readiness.md).

## Requisitos do desenho final

- Identidade individual, MFA conforme política da Santa Casa e procedimento seguro de recuperação de conta.
- Autorização no backend em cada endpoint; a interface serve apenas para navegação.
- Privilégio mínimo, revisão periódica de acessos e revogação imediata no desligamento.
- Completar a auditoria de leituras e mudanças com identificador institucional, horário confiável, ação, recurso e resultado; não registrar sinais vitais, nomes de pacientes ou outros dados clínicos no log.
- Monitorar o backlog das outboxes, manter cópia externa imutável, restringir acesso e aprovar política de retenção para a trilha.
- Sessão e transporte protegidos por HTTPS com certificado confiável nos dispositivos.

Os grupos, regras de acesso e prazos de retenção devem ser aprovados pela instituição. Este documento não declara conformidade legal.
