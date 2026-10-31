# Backup e restauração

O formato de transporte `.rgs` reúne os sete bancos da aplicação, incluindo contas locais, permissões e dados dos módulos, em um único arquivo cifrado. Os pacotes criados pelo script usam GPG; a exportação pela interface do superadministrador usa AES-GCM com senha. A restauração isolada aceita ambos os formatos. O conteúdo inclui dados pessoais e clínicos: guarde o arquivo e a chave/senha em locais institucionais controlados.

## Backup automático diário

O serviço de backup pode gerar diariamente, às 02:00 no fuso `America/Sao_Paulo`, um `.rgs` cifrado com a chave pública GPG aprovada. O pacote inclui os sete bancos, o `.env`, o volume de dados do Caddy e os arquivos da Oficina Terapêutica. A chave privada nunca é enviada ao aplicativo; mantenha-a em custódia técnica separada para restauração.

A instalação cria um volume-base de estágio em `./data/backup-staging`, mas isso **não é um destino institucional nem imutável**. Antes de ativar a rotina, a TI deve montar o destino autorizado no host, configurar `SCPO_BACKUP_HOST_DIR` no `.env` com o caminho absoluto desse mount e garantir gravação ao UID/GID `10001` do container. Compartilhamentos de rede precisam estar montados no host Linux antes do Compose iniciar:

```dotenv
SCPO_BACKUP_HOST_DIR=/mnt/backup-institucional/scpo-connect
SCPO_BACKUP_TIMEZONE=America/Sao_Paulo
```

Após reiniciar o serviço `backup`, no Superadministrador → **Cópias de segurança**, importe somente a chave pública GPG ASCII-armored e informe uma subpasta relativa ao volume-base. Não informe caminhos do host na interface. Salvar essa configuração ativa a rotina; o painel mostra o último resultado, espaço livre e alertas. O serviço remove automaticamente apenas arquivos `.rgs` com mais de 30 dias. Abaixo de 10% de espaço livre, o painel alerta, mas não apaga backups mais novos para liberar espaço.

Até a TI montar o servidor físico e testar gravação, leitura e restauração, a interface identifica a imutabilidade como **não validada**. Um volume configurado e a retenção de 30 dias, por si sós, não comprovam imutabilidade/WORM.

Para validar um backup automático GPG sem substituir bancos ativos, use a restauração isolada. Além do prefixo novo para os bancos, informe uma pasta absoluta, nova e fora do repositório para preservar os anexos:

```sh
export SCPO_RGS_FILE=/mnt/backup-institucional/scpo-connect/backups/scpo-connect-AAAAMMDDTHHMMSSZ.rgs
export SCPO_RGS_WORK_DIR=/mnt/backup-seguro/restauracao-temporaria
export SCPO_RGS_RESTORE_PREFIX=scpo_restore_validacao
export SCPO_RGS_ATTACHMENTS_DIR=/mnt/backup-seguro/anexos-validacao
bash scripts/restore-rgs-isolated.sh
```

O script cria bancos novos `scpo_restore_*` e extrai `.env`, Caddy e biblioteca terapêutica para a pasta isolada, sem aplicá-los à instalação ativa. A chave privada GPG precisa estar disponível no ambiente de restauração. Não use a restauração da interface para arquivos GPG: ela recebe os pacotes AES-GCM gerados pela própria interface.

## Pacote completo `.rgs`

O script manual abaixo permanece disponível para gerar um pacote GPG contendo somente os sete bancos. O destino deve ser um volume seguro fora do repositório:

```sh
cd "/home/rgarcez/SCPO Connect"
export SCPO_BACKUP_DIR=/mnt/backup-institucional/scpo-connect
export SCPO_BACKUP_GPG_RECIPIENT=ID_DA_CHAVE_PUBLICA
bash scripts/backup-rgs.sh
```

O botão **Gerar backup** em Administração do Sistema exporta os mesmos sete bancos usando AES-GCM e a senha informada pelo superadministrador. A interface não importa nem aplica backups aos bancos ativos. Para validar um arquivo exportado pela interface, use a restauração isolada abaixo; o script solicitará a senha sem expô-la na linha de comando.

Na criação manual, o popup de operação mostra a geração do pacote e o progresso real do download do `.rgs`. Na restauração pela interface, o mesmo popup mostra o envio e informa quando o servidor passa à validação e substituição dos bancos. Antes de tocar nos dados atuais, o servidor valida a senha, o manifesto e cada dump com `pg_restore --list`; um arquivo incompatível é rejeitado antes da criação das cópias de segurança ou de qualquer alteração. A tela informa explicitamente que arquivos GPG da rotina automática usam a chave privada custodiada e não podem ser restaurados nesse fluxo da interface.

## Biblioteca de imagens da Oficina Terapêutica

Os metadados da biblioteca são armazenados no banco Nursing; os arquivos ficam no diretório indicado por `SCPO_THERAPY_MATERIALS_HOST_DIR` (padrão: `./data/therapy-materials`). A rotina automática inclui os arquivos da biblioteca; pacotes manuais de banco e a exportação AES-GCM da interface não incluem. Para usar um HD externo, a equipe de infraestrutura deve primeiro montá-lo no host em um caminho persistente e definir esse caminho no `.env`, por exemplo:

```sh
SCPO_THERAPY_MATERIALS_HOST_DIR=/mnt/scpo-therapy-assets
```

O aplicativo aceita imagens JPG, PNG e WebP de até 12 MB por arquivo. O acervo é autenticado e não é servido como conteúdo público.

Antes de iniciar ou reiniciar os containers, confirme que o dispositivo está realmente montado no caminho configurado (`findmnt --target /mnt/scpo-therapy-assets`) e que o diretório permite leitura e gravação ao UID/GID `10001` usado pelo container. Se o disco não estiver montado, o bind mount pode gravar no disco do sistema em vez do HD externo. A preparação do mount, permissões e persistência após reinicialização deve ser validada pela TI no host; o aplicativo não detecta nem monta hardware.

O banco Nursing sem o diretório de imagens não recupera os arquivos da biblioteca, e preservar somente as imagens não recupera seus metadados. Faça exercícios de restauração que validem ambos.

A retenção automática de 30 dias remove somente arquivos de backup cifrados do destino configurado. A retenção de 365 dias da Auditoria remove somente eventos centrais antigos, mantendo um checkpoint verificável. Nenhum desses processos apaga os cadastros ou registros clínicos ativos dos pacientes.

Para validar a integração do volume, use somente uma imagem sintética e sem dados pessoais: abra Oficina Terapêutica → Materiais → Biblioteca de imagens, envie a imagem, confira se ela aparece na lista e abra-a pela própria interface. Confirme no host que o arquivo correspondente foi criado dentro do ponto de montagem configurado e, por fim, remova a imagem pela interface e confira que o arquivo e o registro foram removidos. A suíte direcionada automatizada também exercita upload, leitura e exclusão em diretório temporário; isso não comprova montagem, permissão, persistência após reinicialização nem restauração do disco externo real.

Para validar/importar o pacote sem trocar os bancos ativos, restaure em um conjunto novo e isolado:

```sh
cd "/home/rgarcez/SCPO Connect"
export SCPO_RGS_FILE=/mnt/backup-institucional/scpo-connect/scpo-connect-AAAAMMDDTHHMMSSZ.rgs
export SCPO_RGS_WORK_DIR=/mnt/backup-seguro/restauracao-temporaria
export SCPO_RGS_RESTORE_PREFIX=scpo_restore_validacao
bash scripts/restore-rgs-isolated.sh
```

O script recusa sobrescrever bancos existentes e cria cópias `scpo_restore_*`. A instância em execução continua usando os bancos originais; para validar uma importação, aponte uma instância isolada para as cópias restauradas. Para pacotes GPG, preserve a chave privada em custódia institucional separada do arquivo `.rgs`. Para pacotes exportados pela interface, o script solicitará a senha; não a coloque na linha de comando.

## Backup individual demonstrativo

Os scripts `backup-demo.sh` e `restore-demo.sh` continuam disponíveis para testes com bancos isolados e recusam sobrescrever destinos existentes.

## Backup

Monte um destino autorizado fora do servidor e configure a chave pública e a confirmação do protótipo:

```sh
export SCPO_BACKUP_DIR=/mnt/backup-institucional/scpo-connect
export SCPO_BACKUP_GPG_RECIPIENT=ID_DA_CHAVE_PUBLICA
export SCPO_BACKUP_DEMO_ONLY=yes
bash scripts/backup-demo.sh
```

São gerados arquivos separados para os seis bancos PostgreSQL e um arquivo do volume persistente do Caddy. Os arquivos temporários sem criptografia são removidos ao final. O destino, cifragem em repouso e em trânsito, retenção e controle de acesso devem ser definidos pela instituição. Não armazene dados reais neste protótipo. Não considere o Git um backup de bancos.

## Teste de restauração do banco

O exemplo cria um banco novo `scpo_restore_demo_*`, nunca remove nem substitui o banco de origem:

```sh
export SCPO_RESTORE_FILE=/mnt/backup-institucional/scpo-connect/scpo_nursing_YYYYMMDDTHHMMSSZ.dump.gpg
export SCPO_RESTORE_KIND=database
export SCPO_RESTORE_DATABASE=scpo_nursing
export SCPO_RESTORE_NEW_DATABASE=scpo_restore_demo_teste1
export SCPO_RESTORE_DEMO_ONLY=yes
bash scripts/restore-demo.sh
```

## Teste de restauração do Caddy

O arquivo do Caddy é restaurado em um volume Docker novo. Valide-o antes de apontar qualquer implantação para esse volume:

```sh
export SCPO_RESTORE_FILE=/mnt/backup-institucional/scpo-connect/caddy_data_YYYYMMDDTHHMMSSZ.tar.gz.gpg
export SCPO_RESTORE_KIND=caddy-data
export SCPO_RESTORE_DEMO_ONLY=yes
bash scripts/restore-demo.sh
```

Faça backups antes de migrações relevantes e execute testes periódicos de restauração em ambiente isolado. A instituição deve designar um responsável, aprovar frequência e retenção, definir metas de perda de dados (RPO) e tempo de recuperação (RTO), e registrar o resultado de cada exercício de restauração. Esses parâmetros ainda não são definidos pelo repositório. Retenção, destino externo e aprovação da rotina são decisões da Santa Casa; os scripts não apagam backups antigos.
