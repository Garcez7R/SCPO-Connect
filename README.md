<table width="100%">
  <tr>
    <td align="center" width="120">
      <img src="public/scpo-connect-icon.png" alt="Ícone do SCPO Connect" width="92" />
    </td>
    <td align="left" valign="middle">
      <h1>SCPO Connect</h1>
      <p><strong>Santa Casa de Pedro Osório</strong><br />Plataforma interna para equipes hospitalares</p>
    </td>
  </tr>
</table>

<p align="center"><strong>Cadastro de pacientes · Sinais vitais · Ordens de serviço · Acesso por módulos</strong></p>

## Sobre o projeto

O **SCPO Connect** reúne fluxos de trabalho hospitalares em uma aplicação web responsiva e instalável. A equipe pode consultar o cadastro compartilhado de pacientes conforme suas permissões, registrar sinais vitais e acompanhar sua evolução, além de abrir e acompanhar ordens de serviço.

O sistema foi desenvolvido para a Santa Casa de Pedro Osório. Os módulos e as permissões são atribuídos individualmente pelo administrador master.

## Recursos

- Cadastro central de pacientes com quarto, leito, data de nascimento, foto, contatos e endereços do paciente e do responsável pela internação.
- Histórico individual de sinais vitais, com consulta separada e controle de acesso por perfil.
- Coleta de sinais vitais com autoria, histórico e gráficos de evolução por indicador.
- Contas individuais, troca obrigatória da senha inicial e autenticação multifator TOTP.
- Permissões por módulo e ações, verificadas também pelas APIs.
- Ordens de serviço: abertura por funcionários, vínculo opcional com paciente e fila de execução da manutenção.
- Solicitações de Raio X e encaminhamentos de Serviço Social ligados ao cadastro compartilhado de pacientes.
- Psicologia / Psiquiatria: fila de triagem com prioridade e situação, histórico individual de atendimentos e evolução estruturada, restritos às contas autorizadas no módulo.
- Higienização: solicitações por tipo de serviço, unidade e área, com prioridade, responsável e situação em fila própria, separada das ordens de manutenção.
- Registro de eventos administrativos e de acessos/alterações assistenciais, sem copiar conteúdo clínico para a trilha.
- Aplicação PWA, com instalação pela interface e atualização dos arquivos do app.
- Interface responsiva para computadores, celulares e tablets.
- Oficina terapêutica com agenda de atividades e calendário mensal de aniversários.
- Saudação de bom dia, boa tarde ou boa noite conforme o horário de Brasília.

### Áreas de trabalho

Cadastro de pacientes, Enfermagem, Farmácia, Raio X, Serviço Social, Psicologia / Psiquiatria, Nutrição, Recepção, Oficina Terapêutica, Manutenção e Gestão Hospitalar. Higienização não aparece como área operacional até ter fluxos funcionais definidos.

## Arquitetura

| Camada | Tecnologias |
| --- | --- |
| Interface e PWA | React, TypeScript e Vite |
| APIs | Python, FastAPI, SQLAlchemy e Alembic |
| Desenvolvimento local | SQLite em `data/local/`; cadastro de pacientes, sinais vitais e agenda terapêutica compartilham o banco clínico |
| Instalação com containers | Docker Compose e PostgreSQL 17 |
| HTTPS interno | Caddy com autoridade certificadora local |

As APIs são separadas por domínio: Identidade e Acesso, Auditoria, Enfermagem e cadastro central de pacientes, Farmácia, Oficina Terapêutica, Raio X, Serviço Social e Manutenção. Cada serviço possui migrações próprias e documentação OpenAPI em `/docs`.

## Executar para desenvolvimento

### Requisitos

- Node.js 24 ou superior e npm
- Python 3.11 ou superior e [uv](https://docs.astral.sh/uv/)
- Caddy 2 para servir o build local por HTTPS na rede

Instale as dependências e gere os arquivos do PWA:

```bash
npm ci
uv sync
npm run build
```

Inicie as APIs em um terminal:

```bash
SCPO_COOKIE_SECURE=true bash scripts/dev-api.sh
```

Em outro terminal, informe o IP ou nome DNS da VM e inicie o Caddy:

```bash
read -r -p "IP ou DNS da VM: " SCPO_INTERNAL_HOST
export SCPO_INTERNAL_HOST
export SCPO_DEV_HTTPS_PORT=8444
caddy run --config Caddyfile.local --adapter caddyfile
```

Abra `https://<IP-ou-DNS-da-VM>:8444` em um dispositivo da rede local, substituindo o marcador pelo endereço informado. O Caddy local usa uma CA própria; para o navegador considerar a conexão confiável, instale a raiz pública `data/local/scpo-local-root.crt` em cada dispositivo e confira a impressão digital por um canal independente.

Na primeira abertura, crie o usuário administrador usando o token armazenado em `data/local/bootstrap-admin.token`. As contas iniciais recebem a senha `0000`, exigem troca no primeiro acesso e devem configurar o MFA. Mantenha o token e os arquivos de `data/local/` fora do Git.

Para desenvolver a interface com atualização instantânea no computador, use `npm run dev -- --host 127.0.0.1`. Os logs locais são gravados em `.logs/`.

## Instalação com Docker Compose

Copie o modelo de configuração e preencha os segredos antes de iniciar:

```bash
cp .env.example .env
```

Gere segredos distintos para os campos de serviço, sessão, criptografia do MFA e bootstrap. Por exemplo:

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

Configure também `SCPO_INTERNAL_HOST` com o endereço estável da VM e inicie os serviços:

```bash
docker compose up -d --build
```

O Caddy publica HTTP na porta `8080` para redirecionamento e HTTPS na porta `8443`. Exporte a raiz pública da CA com `bash scripts/export-caddy-ca.sh`, confira sua impressão digital e distribua-a por um canal controlado pela instituição. Preserve os volumes `postgres_data` e `caddy_data`; eles contêm, respectivamente, os bancos do sistema e a autoridade certificadora usada pelos dispositivos.

## Verificações de desenvolvimento

```bash
npm run build
npm run lint
uv run pytest
uv run ruff check backend
```

## Segurança e dados

As contas são individuais, usam senha com derivação scrypt e MFA TOTP. As sessões são assinadas e protegidas por cookie HttpOnly; a autorização é aplicada no servidor por módulo e ação. O HTTPS interno protege o tráfego somente nos aparelhos que confiam na CA do Caddy. O certificado TLS identifica o servidor e não substitui a autenticação do funcionário.

Antes de habilitar o uso com dados pessoais ou clínicos, a Santa Casa deve validar a matriz de acesso, os fluxos assistenciais, a auditoria de consultas e alterações, a retenção, os backups, a resposta a incidentes e os requisitos de privacidade e segurança. Consulte [preparação para piloto](docs/pilot-security-readiness.md) e [autenticação e permissões](docs/permissions.md). O sistema não interpreta sinais, diagnostica nem recomenda condutas clínicas.

Segredos, bancos locais, certificados e logs não devem ser enviados ao Git. O `.gitignore` exclui esses arquivos; mantenha `.env` apenas no servidor e use `.env.example` como modelo sem valores secretos.

## Documentação

- [Arquitetura](docs/architecture.md)
- [Autenticação e permissões](docs/permissions.md)
- [Modelo de acesso ao cadastro de pacientes](docs/patient-access-model.md)
- [Integração futura com Zentyal](docs/zentyal-integration.md)
- [Preparação para piloto e segurança](docs/pilot-security-readiness.md)
- [Backup e restauração](docs/backups.md)
