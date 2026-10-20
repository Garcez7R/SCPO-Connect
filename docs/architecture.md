# Arquitetura

O protótipo usa um monorepo para facilitar desenvolvimento, mas inicia cada domínio como um processo FastAPI independente. Os serviços compartilham utilitários de conexão e a identidade de demonstração. Os módulos que usam bancos separados validam referências de pacientes por API interna; Oficina Terapêutica compartilha o banco clínico de Enfermagem.

| Serviço | Aplicação | Banco próprio | API versionada |
| --- | --- | --- | --- |
| Identidade e acesso | `scpo_services.access` | `scpo_access` | `/api/v1/access`, `/api/v1/system-admin` |
| Auditoria | `scpo_services.audit` | `scpo_audit` | `/api/v1/audit` |
| Enfermagem | `scpo_services.nursing` | `scpo_nursing` | `/api/v1/nursing` |
| Recepção | `scpo_services.nursing` | `scpo_nursing` | `/api/v1/reception` |
| Farmácia | `scpo_services.pharmacy` | `scpo_pharmacy` | `/api/v1/pharmacy` |
| Serviço Social e Psicologia/Psiquiatria | `scpo_services.social` | `scpo_social` | `/api/v1/social`, `/api/v1/psychology` |
| Raio X | `scpo_services.xray` | `scpo_xray` | `/api/v1/xray` |
| Manutenção e Higienização | `scpo_services.maintenance` | `scpo_maintenance` | `/api/v1/maintenance`, `/api/v1/hygiene` |
| Oficina Terapêutica | `scpo_services.therapy` | `scpo_nursing` (compartilhado) | `/api/v1/therapy` |
| Backup | `scpo_services.backup` | Bancos dos serviços | `/api/v1/backup` |

A agenda da Recepção é persistida no banco Nursing e usa o cadastro central de pacientes. O endpoint valida conflitos de horário por paciente, profissional e local; alterações de situação seguem transições controladas e são auditadas sem registrar a finalidade do agendamento.

Solicitações de Higienização podem vincular um leito físico entre os bancos Maintenance e Nursing. O serviço Nursing mantém o leito bloqueado enquanto o pedido estiver ativo; somente após a conclusão registrada pela Higienização o serviço pode liberar o leito. Falhas na chamada entre serviços deixam a liberação pendente e permitem nova tentativa, sem liberar automaticamente um leito não confirmado como limpo.

O painel executivo consulta indicadores agregados no serviço Nursing e alertas de estoque no serviço Pharmacy, mantendo erros visíveis por origem. A agenda diária usa o fuso `America/Sao_Paulo`; incidentes abertos excluem os encerrados; contagens de validade documental incluem somente documentos aprovados, vencidos ou com vencimento nos próximos 30 dias. Higienização e manutenção contam leitos físicos ativos em cada situação.

Em desenvolvimento, cada API usa SQLite no diretório ignorado `data/local/`. No Compose, cada processo usa um banco PostgreSQL e uma credencial próprios; as APIs não recebem o usuário administrativo nem as senhas dos demais serviços. O token de serviço permanece restrito aos contêineres backend e autentica chamadas internas entre domínios; não é exposto ao navegador. A API de acesso registra alterações no serviço de auditoria por HTTP interno autenticado e não escreve diretamente no banco de auditoria. Ordens de serviço mantêm seu próprio histórico de abertura e alterações de status com a autoria do funcionário.

Cada app publica seu próprio OpenAPI em `/docs` e `/openapi.json`. Os scripts de inicialização aplicam a revisão Alembic do serviço escolhido antes de iniciar o processo. Faça e verifique backup antes de aplicar novas migrações em qualquer ambiente persistente.

## Separação futura

Para extrair um domínio, mantenha seu pacote, migrações e banco como unidade, publique sua imagem a partir de `Dockerfile.backend` e mova sua rota no proxy. Preserve o contrato `/api/v1/<domínio>` ou publique nova versão quando houver alteração incompatível. Substitua `X-Demo-Role` por identidade autenticada institucional, defina contas de serviço e política de rede, e revise o contrato de auditoria antes de qualquer implantação real.

## Limites

O cabeçalho `X-Demo-Role` é deliberadamente falsificável: demonstra autorização de rotas, não autentica pessoas. Serviços, critérios, retenção, HTTPS interno, backup, políticas de menor privilégio e requisitos legais necessitam de revisão técnica e institucional antes de uso real. A prioridade da emergência é registrada manualmente e não substitui protocolo institucional de triagem; os indicadores e registros de risco não fazem classificação, alerta ou recomendação clínica automatizada. Não há integração clínica.
