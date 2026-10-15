# Autenticação e permissões

## Estado atual

O login local, troca obrigatória da senha inicial, MFA TOTP, sessão HttpOnly assinada e verificação de permissões no backend foram implementados. `X-Demo-Role` deixou de ser aceito. A integração com AD Zentyal está adiada. A implementação ainda precisa de revisão e validação antes de qualquer uso com dados reais. A trilha registra operações de administração de contas; acessos e alterações clínicas ainda não estão auditados.

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
