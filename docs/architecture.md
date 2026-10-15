# Arquitetura

O protótipo usa um monorepo para facilitar desenvolvimento, mas inicia cada domínio como um processo FastAPI independente. Os serviços compartilham somente utilitários de conexão e a identidade de demonstração; não importam modelos uns dos outros nem consultam tabelas alheias.

| Serviço | Aplicação | Banco próprio | API versionada |
| --- | --- | --- | --- |
| Identidade e acesso | `scpo_services.access` | `scpo_access` | `/api/v1/access` |
| Auditoria | `scpo_services.audit` | `scpo_audit` | `/api/v1/audit` |
| Enfermagem | `scpo_services.nursing` | `scpo_nursing` | `/api/v1/nursing` |
| Farmácia | `scpo_services.pharmacy` | `scpo_pharmacy` | `/api/v1/pharmacy` |
| Serviço Social | `scpo_services.social` | `scpo_social` | `/api/v1/social` |
| Raio X | `scpo_services.xray` | `scpo_xray` | `/api/v1/xray` |
| Manutenção e ordens de serviço | `scpo_services.maintenance` | `scpo_maintenance` | `/api/v1/maintenance` |

Em desenvolvimento, cada API usa SQLite no diretório ignorado `data/local/`. No Compose, cada processo usa um banco PostgreSQL e uma credencial próprios; as APIs não recebem o usuário administrativo nem as senhas dos demais serviços. A API de acesso registra alterações no serviço de auditoria por HTTP interno autenticado por `SCPO_SERVICE_TOKEN`; não escreve diretamente no banco de auditoria. Somente Identidade e Auditoria recebem esse token. Ordens de serviço mantêm seu próprio histórico de abertura e alterações de status com a autoria do funcionário.

Cada app publica seu próprio OpenAPI em `/docs` e `/openapi.json`. Os scripts de inicialização aplicam a revisão Alembic do serviço escolhido antes de iniciar o processo. Faça e verifique backup antes de aplicar novas migrações em qualquer ambiente persistente.

## Separação futura

Para extrair um domínio, mantenha seu pacote, migrações e banco como unidade, publique sua imagem a partir de `Dockerfile.backend` e mova sua rota no proxy. Preserve o contrato `/api/v1/<domínio>` ou publique nova versão quando houver alteração incompatível. Substitua `X-Demo-Role` por identidade autenticada institucional, defina contas de serviço e política de rede, e revise o contrato de auditoria antes de qualquer implantação real.

## Limites

O cabeçalho `X-Demo-Role` é deliberadamente falsificável: demonstra autorização de rotas, não autentica pessoas. Serviços, critérios, retenção, HTTPS interno, backup, políticas de menor privilégio e requisitos legais necessitam de revisão técnica e institucional antes de uso real. Não há integração clínica, classificação, alerta ou recomendação.
