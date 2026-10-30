# Publicar e atualizar o servidor de testes

Este procedimento envia uma versão já testada na VM de desenvolvimento para o servidor de testes `192.168.1.216`. O acesso web usa HTTPS na porta `7777`.

O deploy atualiza o código e reconstrói os containers, mas preserva os usuários e dados que já existem no servidor. Ele não copia os bancos SQLite da VM de desenvolvimento.

## Antes do primeiro deploy

Confirme com a equipe responsável que o servidor é Debian 13 com systemd e que você tem:

- acesso SSH por chave como `connect@192.168.1.216`;
- autorização para usar `sudo` no servidor; o instalador pode pedir a senha diretamente no terminal;
- acesso à rede nas portas TCP `7777` (HTTPS) e, se necessário, `8080` (redirecionamento HTTP).

Do computador com o clone do projeto, confira o destino:

```bash
ssh -o BatchMode=yes connect@192.168.1.216 \
  'hostname; cat /etc/os-release'
```

Se o servidor tiver uma instalação anterior, confira seu estado antes de atualizar:

```bash
ssh -t connect@192.168.1.216
cd /home/connect/apps/SCPO-Connect
sudo docker compose ps
sudo grep -E '^(SCPO_INTERNAL_HOST|SCPO_HTTP_PORT|SCPO_HTTPS_PORT|SCPO_BIND_ADDRESS)=' .env
```

Não exiba nem envie o `.env` inteiro: ele contém segredos. Para a URL deste servidor, `SCPO_INTERNAL_HOST` deve ser `192.168.1.216` e `SCPO_HTTPS_PORT` deve ser `7777`. Se os valores estiverem diferentes, ajuste somente essas configurações com `sudoedit .env` antes de publicar. O instalador preserva o `.env` existente e não troca automaticamente o host ou a porta.

## Preparar uma versão depois de testá-la na VM de desenvolvimento

No clone que contém exatamente o código aprovado:

1. Execute os testes e as verificações pertinentes à mudança. Confirme também no navegador o fluxo que foi testado na VM.
2. Confira o que será publicado:

   ```bash
   git status --short --branch
   git diff --check
   ```

3. Faça commit das alterações aprovadas. O script publica o `HEAD` local, não as alterações soltas nem necessariamente o que está no GitHub. A árvore precisa estar limpa:

   Use `git add` somente nos caminhos revisados. Por exemplo, se essas forem as únicas alterações aprovadas:

   ```bash
   git add README.md docs/deploy-test-server.md
   git commit -m "Document test server deployment"
   git status --short --branch
   ```

   O último comando não deve mostrar alterações pendentes. Não inclua `.env`, `data/`, bancos, tokens, certificados, logs ou artefatos locais no commit.

Não é obrigatório fazer push para o GitHub antes de publicar no servidor de testes. O script empacota o commit local com `git archive`.

## Publicar a primeira instalação ou uma atualização

No diretório raiz do repositório, execute:

```bash
bash scripts/deploy-test-server.sh
```

O destino padrão já é `connect@192.168.1.216`, no diretório `/home/connect/apps/SCPO-Connect`. Para confirmar ou mudar esses valores nesta execução:

```bash
SCPO_TEST_SERVER=connect@192.168.1.216 \
SCPO_TEST_APP_DIR=/home/connect/apps/SCPO-Connect \
bash scripts/deploy-test-server.sh
```

O script:

1. recusa uma árvore Git com alterações não commitadas;
2. cria um arquivo temporário somente com os arquivos versionados do commit;
3. envia o arquivo por SSH e extrai o código no diretório do app;
4. executa `sudo bash scripts/install-server-debian13.sh` no servidor;
5. constrói e inicia os containers e aguarda as APIs ficarem saudáveis.

O SSH usa autenticação em modo não interativo, portanto a chave pública deste computador precisa estar autorizada para o usuário `connect`. O `sudo` remoto pode solicitar autenticação no terminal.

## O que preserva usuários e dados entre versões

O instalador usa `docker compose up -d --build`; ele não apaga os dados da instalação existente. As informações persistentes ficam fora do arquivo enviado pelo Git:

- usuários, permissões e dados da aplicação: volume PostgreSQL `postgres_data`;
- certificados/autoridade local do Caddy: volume `caddy_data`;
- segredos e endereço do servidor: `/home/connect/apps/SCPO-Connect/.env`;
- token inicial, se criado: `data/local/bootstrap-admin.token`;
- arquivos da biblioteca da Oficina Terapêutica: diretório host definido por `SCPO_THERAPY_MATERIALS_HOST_DIR` (padrão `data/therapy-materials`).

Em atualizações, mantenha esses itens. **Nunca use `docker compose down -v`, não remova volumes e não substitua o `.env`** como parte de uma atualização. As migrações aplicáveis são executadas pelos serviços durante a inicialização.

O processo não recria os usuários em uma instalação existente. Se a instalação for realmente nova, o instalador gera um novo token de bootstrap em `data/local/bootstrap-admin.token`; leia-o diretamente no servidor e use-o uma única vez para criar o administrador inicial. Não reutilize o token da VM de desenvolvimento.

Faça o backup aprovado pelo responsável antes de alterações importantes de banco ou migrações. Este procedimento não copia os bancos `data/demo` ou `data/local` da VM de desenvolvimento para o servidor.

## Verificar após publicar

No servidor:

```bash
ssh -t connect@192.168.1.216
cd /home/connect/apps/SCPO-Connect
sudo docker compose ps
sudo docker compose logs --tail=100
```

As APIs devem estar `healthy` e o proxy deve estar em execução. Verifique a página HTTPS localmente no servidor:

```bash
curl --silent --show-error --fail --insecure \
  --resolve 192.168.1.216:7777:127.0.0.1 \
  https://192.168.1.216:7777/ >/dev/null
```

De um computador autorizado na mesma rede, abra `https://192.168.1.216:7777`. Como o Caddy usa uma autoridade certificadora local, o navegador só confiará no certificado depois de instalar o certificado raiz público do servidor e validar sua impressão digital por um canal confiável. O certificado está em `data/local/scpo-local-root.crt` no servidor; não aceite avisos de certificado sem verificar a origem e a impressão digital.

Se a página não abrir, verifique o estado dos containers, os logs, o endereço e a porta HTTPS no `.env`, as regras de firewall e a conectividade da rede. Não exponha o servidor de testes diretamente à Internet.
