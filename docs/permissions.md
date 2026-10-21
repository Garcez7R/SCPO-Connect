# Autenticação e permissões

## Estado atual

O login local, troca obrigatória da senha inicial, MFA TOTP, sessão HttpOnly assinada e verificação de permissões no backend foram implementados. `X-Demo-Role` deixou de ser aceito. A integração com AD Zentyal está adiada. A implementação ainda precisa de revisão e validação antes de qualquer uso com dados reais. A trilha registra operações de administração de contas; acessos e alterações clínicas ainda não estão auditados.

O perfil **Superadministrador do Sistema** é um privilégio independente dos módulos de Gestão Hospitalar e Administração. O login definido por `SCPO_SUPERADMIN_USERNAME` (padrão `rgarcez`) é marcado na migração ou no bootstrap. A conta não pode ser alterada pelos administradores comuns; redefinição de credenciais, encerramento de sessões, MFA e backup são operações exclusivas do superadministrador. As senhas temporárias são aleatórias, exibidas uma única vez e exigem troca e novo cadastro de MFA. O serviço não oferece um fluxo alternativo para promover outra conta.

A Administração comum apresenta guias separadas para usuários/permissões e logs de auditoria. A Gestão Hospitalar é uma visão de indicadores operacionais agregados já disponíveis; não é um sistema financeiro/ERP hospitalar completo. Os logs e a recuperação de acesso continuam dependendo de validação operacional da instituição e da melhoria de durabilidade e resistência à alteração da trilha.

## Matriz efetiva no código

O sistema não possui cargos operacionais fixos: os módulos e ações são atribuídos por conta. A tabela abaixo descreve o comportamento atual da API e da tela de Administração, não uma matriz aprovada pela Santa Casa.

| Acesso atribuído | Consultar | Criar | Alterar | Excluir/arquivar | Administrar contas |
| --- | --- | --- | --- | --- | --- |
| Módulo operacional individual | Sim, se selecionado | Sim, padrão | Sim, padrão | Opcional somente para Pacientes, Enfermagem, Nutrição e Recepção | Não |
| Gestão Hospitalar | Todos os módulos | Todos os módulos | Todos os módulos | Todos os módulos | Sim |
| Administração sem Gestão Hospitalar | Não pode ser atribuída isoladamente | — | — | — | — |
| Superadministrador | Todos os módulos | Todos os módulos | Todos os módulos | Todos os módulos | Operações de sistema restritas |

Uma conta que recebe Gestão Hospitalar é ampliada pelo backend para todos os módulos e todas as ações; não é uma seleção de painel somente leitura. Por isso, a interface mostra um aviso de privilégio amplo ao conceder esse acesso. O superadministrador é um privilégio independente e reservado, não um cargo que outros administradores possam atribuir.

As ações gerais correspondem a `consultar`, `criar`, `alterar`, `excluir` e `administrar`. A autorização é checada no backend; esconder ou desabilitar um controle na interface não substitui essa checagem. A opção de arquivamento na interface existe somente para Pacientes, Enfermagem, Nutrição e Recepção.

Antes de uso real, os responsáveis de cada área devem aprovar uma matriz nominal com módulo, ação, dados/campos acessíveis, justificativa, aprovador, validade e revisão. O comportamento amplo de Gestão Hospitalar deve ser validado; não conceda esse módulo para representar um gestor de painel com escopo reduzido.

| Controle | Estado | Para dados reais |
| --- | --- | --- |
| Identidade de usuário | Contas locais com senha e MFA TOTP | Revisar requisitos, recuperação, rotação de segredos e procedimento de suporte |
| Permissões por módulo | Persistidas por conta e conferidas nas rotas | Validar matriz institucional por usuário, módulo, ação e campo |
| Autoria | ID estável da conta autenticada no registro de sinais vitais | Auditar todos os acessos e alterações clínicas e revisar retenção |
| Auditoria clínica | Consultas e mudanças clínicas ainda não cobertas | Registrar eventos clínicos sem payload sensível e proteger/reter a trilha |
| AD Zentyal | Adiado por orçamento | Integrar futuramente, se aprovado, mantendo identidade e acesso individual |

Não use dados pessoais ou clínicos reais até concluir os controles acima e a validação institucional descrita em [Preparação para piloto com dados reais](pilot-security-readiness.md).

## Requisitos do desenho final

- Identidade individual, MFA conforme política da Santa Casa e procedimento seguro de recuperação de conta.
- Autorização no backend em cada endpoint; a interface serve apenas para navegação.
- Privilégio mínimo, revisão periódica de acessos e revogação imediata no desligamento.
- Auditoria de leituras e mudanças com identificador institucional, horário confiável, ação, recurso e resultado; não registrar sinais vitais, nomes de pacientes ou outros dados clínicos no log.
- Proteção contra alteração indevida, acesso restrito e política de retenção para a trilha.
- Sessão e transporte protegidos por HTTPS com certificado confiável nos dispositivos.

Os grupos, regras de acesso e prazos de retenção devem ser aprovados pela instituição. Este documento não declara conformidade legal.
