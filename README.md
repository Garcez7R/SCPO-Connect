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

- Cadastro central de pacientes com quarto, leito, data de nascimento, foto, contatos e endereços do paciente e do responsável pela internação; pessoas sem cadastro ou leito podem ser registradas na fila própria da emergência.
- Seletores de pacientes nos módulos assistenciais, administrativos e de recepção incluem busca por nome e identificadores/localização, mantendo a lista suspensa para seleção manual.
- Histórico individual de sinais vitais, com consulta separada e controle de acesso por perfil.
- Coleta de sinais vitais com autoria, histórico e gráficos de evolução por indicador.
- Enfermagem: registro de transferências e altas com histórico; central de alergias e contraindicações com autoria, justificativa e resolução rastreável.
- Recepção: classificação manual da prioridade de chegadas à emergência; não substitui protocolo institucional de triagem.
- Gestão Hospitalar: mapa de leitos e indicadores agregados de ocupação, chegadas, coletas, fluxo, riscos cadastrais e alertas de estoque. A ocupação percentual depende da reconciliação dos pacientes legados com o mapa.
- Contas individuais, troca obrigatória da senha inicial e autenticação multifator TOTP configurável por QR code ou chave manual.
- Permissões por módulo e ações, verificadas também pelas APIs.
- Ordens de serviço com fluxos separados para Manutenção e Higienização; cada equipe acompanha sua própria fila e situação dos chamados.
- Central de Exames: abas de Raio X e exames laboratoriais, requisições vinculadas ao paciente, fila por situação e formulário de solicitação para impressão.
- Médico: consulta de alergias e sinais vitais com gráficos, perfil CRM/UF, prescrição interna integrada à Farmácia e Enfermagem e receita simples para impressão (sem assinatura digital e sem medicamentos controlados).
- Serviço Social: encaminhamentos ligados ao paciente, com busca, filtros e atualização de situação até o encerramento.
- Farmácia: inventário normalizado por produto, lote e local; movimentações com autoria e saldo resultante; leitura GS1, sugestões de identificação pelo catálogo público Anvisa/CMED e indicação informativa do lote válido com vencimento mais próximo (FEFO), sem seleção automática.
- Farmácia: consulta alfabética consolidada do estoque de medicamentos e fila de prescrições médicas pendentes para conferência e dispensação.
- Nutrição: avaliação vinculada ao paciente, alerta cadastral de alergias, contexto da última avaliação e histórico paginado com busca no servidor e filtro por paciente.
- Recepção: fluxos separados de admissão/internação e emergência; a chegada pode criar atomicamente um cadastro central sem quarto/leito ou vincular paciente existente.
- Recepção: ficha ambulatorial entra na fila do pronto atendimento e permite classificar a senha como comum (C) ou prioritária (P), conforme o critério institucional.
- Enfermagem: a escala horária de medicações pode ser impressa em folha A4 por horário com uma linha por paciente e medicamento, com opção de registrar administração, recusa, indisponibilidade ou suspensão, preservando o motivo da exceção.
- Gestão e Administração: relatórios históricos paginados incluem triagens de Enfermagem e atendimentos ambulatoriais da Recepção, com busca por paciente, filtros por período e impressão conforme permissões.
- Sala de espera: abra `/painel` (também compatível com `/painel-sala-espera`) em um computador dedicado; a tela não exige sessão de operador e não expira com a sessão da Recepção. Mostra somente a chamada atual, com primeiro nome, senha sequencial `Cxxx`/`Pxxx` e identificação visível quando prioritária; as senhas reiniciam à meia-noite de Brasília.
- Quiosque: configure o navegador do computador dedicado para iniciar em `https://SEU_HOST/painel` em modo quiosque. Para Chromium/Chrome gerenciado, a opção `--autoplay-policy=no-user-gesture-required` permite tentar ativar voz e toque ao iniciar; políticas do navegador/sistema ainda podem exigir clicar em **Ativar áudio** uma vez. Um toque sonoro curto antecede a chamada por voz.
- Proteção de tela da Recepção: no painel do operador ou na tela pública, ative a opção correspondente. Após cinco minutos sem chamada nova, a tela pública alterna imagens de `public/reception-screensaver/`; uma chamada interrompe os slides imediatamente na próxima atualização da fila (até cinco segundos). Use apenas imagens institucionais aprovadas, sem pacientes, dados pessoais ou informações clínicas. Formatos aceitos: JPG/JPEG, PNG, WebP e AVIF; o manifesto é gerado automaticamente em desenvolvimento e build.
- Ordens de Manutenção e Higienização: numeração sequencial compartilhada de sete dígitos, sem prefixos nem datas.
- Cadastro do paciente: status explícito de alergia (não verificado, sem alergia conhecida ou alergia conhecida), alerta visual nos fluxos clínicos e opção de responsável não aplicável ou autorreferência do paciente.
- Psicologia / Psiquiatria: fila de triagem com prioridade e situação, histórico individual de atendimentos e evolução estruturada, restritos às contas autorizadas no módulo.
- Higienização: solicitações por tipo de serviço, unidade e área, com prioridade, responsável e situação em fila própria, separada das ordens de manutenção.
- Caixa de tarefas: filas acionáveis de Recepção, Enfermagem, Farmácia, Manutenção e Higienização, filtradas pelas permissões da conta.
- Registro de eventos administrativos e de acessos/alterações assistenciais, sem copiar conteúdo clínico para a trilha.
- Aplicação PWA, com instalação pela interface e atualização dos arquivos do app.
- Interface responsiva para computadores, celulares e tablets.
- Menu lateral recolhível para uso mais eficiente em monitores menores e telas mais estreitas.
- Tela inicial offline: verifica a conexão a cada 30 segundos e recarrega o app somente quando o servidor voltar a responder; a verificação não roda nas telas autenticadas.
- Recepção: filas do operador ficam separadas em duas colunas (prioritários e comuns), com chamadas em linhas e opção de chamar manualmente um paciente específico.
- Enfermagem: verificação horária separa pacientes com e sem risco de evasão; o risco começa ativo e pode ser alterado por profissional autorizado, com registro de auditoria.
- Oficina terapêutica com abas de atividades/calendário, lista de presença e relatórios; resultados salvos ficam disponíveis digitalmente na aba Relatórios da Gestão Hospitalar, com impressão opcional.
- Saudação de bom dia, boa tarde ou boa noite conforme o horário de Brasília.

Na Farmácia, a atualização do catálogo Anvisa/CMED é manual e consulta a lista pública de preços de medicamentos apenas para sugerir GTIN, nome, princípio ativo, apresentação, fabricante e referência de registro. A sugestão só preenche o rascunho após ação do usuário; não cria produto/lote nem movimenta saldo. A base não confirma autenticidade, registro ativo ou adequação clínica e não substitui a conferência da equipe.

### Áreas de trabalho

Cadastro de pacientes, Enfermagem, Farmácia, Central de Exames, Médico, Serviço Social, Psicologia / Psiquiatria, Nutrição, Recepção, Oficina Terapêutica, Manutenção, Higienização e Gestão Hospitalar.

## Arquitetura

| Camada | Tecnologias |
| --- | --- |
| Interface e PWA | React, TypeScript e Vite |
| APIs | Python, FastAPI, SQLAlchemy e Alembic |
| Desenvolvimento local | SQLite em `data/demo/` por padrão; pode ser configurado por `SCPO_LOCAL_DATA_DIR`, preservando `data/local/` |
| Instalação com containers | Docker Compose e PostgreSQL 17 |
| HTTPS interno | Caddy com autoridade certificadora local |

As APIs são separadas por domínio: Identidade e Acesso, Auditoria, Enfermagem e cadastro central de pacientes (incluindo Recepção e prescrições médicas), Farmácia, Oficina Terapêutica, Central de Exames, Serviço Social e Psicologia/Psiquiatria, Manutenção e Higienização, além do serviço de Backup. Cada serviço possui migrações próprias e documentação OpenAPI em `/docs`.

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

O lançador de desenvolvimento usa `data/demo/` por padrão, onde já estão os sete pacientes fictícios e suas 210 aferições de 30 dias. Os bancos antigos em `data/local/` permanecem intactos. Na primeira abertura, crie a conta inicial usando o token em `data/demo/bootstrap-admin.token`; defina o login `rgarcez` para habilitar o perfil exclusivo de Superadministrador do Sistema (ou configure `SCPO_SUPERADMIN_USERNAME` antes da migração). A senha de bootstrap exige troca e ativação de MFA. Contas criadas posteriormente recebem senhas temporárias aleatórias de uso único. Mantenha tokens e bancos locais fora do Git. Não use o ambiente demo para dados reais.

### Contas e perfis

O usuário com acesso à Gestão Hospitalar administra as contas operacionais e concede os módulos necessários, incluindo Médico. Após criar uma conta com o módulo Médico, a Administração cadastra o nome profissional e o CRM/UF em **Perfis médicos**; o próprio médico consulta esses dados, mas não pode criá-los nem alterá-los. Confira as informações antes da emissão de prescrições. O login `rgarcez` é reservado ao Superadministrador do Sistema; esse acesso é distinto da Gestão Hospitalar e não aparece na lista de contas dos demais administradores. As funções de backup e restauração são exclusivas do Superadministrador do Sistema. Nunca compartilhe sua conta ou credenciais.

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

Após iniciar ou atualizar a implantação, confira `docker compose ps`: os serviços de API devem aparecer como `healthy`. Cada API possui um healthcheck HTTP em `/health`; o proxy aguarda as APIs ficarem saudáveis antes de iniciar. Essa verificação confirma disponibilidade básica, não valida fluxos do usuário nem substitui testes de restauração. Para investigar falhas, consulte `docker compose logs --tail=100 <serviço>` e confirme nos logs que as migrações terminaram.

## Verificações de desenvolvimento

```bash
npm run build
npm run lint
uv run pytest
uv run ruff check backend
```

## Segurança e dados

As contas locais são individuais, usam senha com derivação scrypt e MFA TOTP. Não há integração com provedor institucional de identidade. As sessões são assinadas e protegidas por cookie HttpOnly; a autorização é aplicada no servidor por módulo e ação. O HTTPS interno protege o tráfego somente nos aparelhos que confiam na CA do Caddy. O certificado TLS identifica o servidor e não substitui a autenticação do funcionário.

Antes de habilitar o uso com dados pessoais ou clínicos, a Santa Casa deve validar a matriz de acesso, os fluxos assistenciais, a auditoria de consultas e alterações, a retenção, os backups, a resposta a incidentes e os requisitos de privacidade e segurança. Consulte [preparação para piloto](docs/pilot-security-readiness.md) e [autenticação e permissões](docs/permissions.md). O sistema não interpreta sinais, diagnostica nem recomenda condutas clínicas.

Segredos, bancos locais, certificados e logs não devem ser enviados ao Git. O `.gitignore` exclui esses arquivos; mantenha `.env` apenas no servidor e use `.env.example` como modelo sem valores secretos.

## Preparação para operação

Antes de qualquer piloto com dados reais:

1. Revise e aprove a matriz de acessos e os fluxos de admissão, transferência, alta, leitos e estoque com TI, segurança, privacidade e equipes responsáveis. As contas atuais são locais; a implantação não está ligada a um diretório institucional.
2. Gere um backup e execute [restauração isolada](docs/backups.md) em bancos descartáveis. A existência de um arquivo de backup ou a passagem do healthcheck não comprova que a recuperação funciona.
3. Defina institucionalmente responsável, frequência e retenção dos backups, além das metas de perda de dados (RPO) e tempo de recuperação (RTO). Esses parâmetros ainda não são definidos pelo repositório.
4. Observe tarefas reais em ambiente de teste e registre tempo, erros, retrabalho e dificuldades, inclusive em celular/tablet. A [preparação para piloto](docs/pilot-security-readiness.md) detalha os limites e controles pendentes.

Não use dados pessoais ou clínicos reais até que esses controles e a validação institucional estejam concluídos. Os healthchecks de Compose e os testes automatizados não equivalem à verificação do servidor hospitalar nem à aprovação para produção.

## Documentação

- [Arquitetura](docs/architecture.md)
- [Autenticação e permissões](docs/permissions.md)
- [Modelo de acesso ao cadastro de pacientes](docs/patient-access-model.md)
- [Preparação para piloto e segurança](docs/pilot-security-readiness.md)
- [Backup e restauração](docs/backups.md)
