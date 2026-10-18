# Backup e restauração

O formato de transporte `.rgs` reúne os sete bancos da aplicação, incluindo contas locais, permissões e dados dos módulos, em um único arquivo cifrado. Os pacotes criados pelo script usam GPG; a exportação pela interface do superadministrador usa AES-GCM com senha. A restauração isolada aceita ambos os formatos. O conteúdo inclui dados pessoais e clínicos: guarde o arquivo e a chave/senha em locais institucionais controlados.

## Pacote completo `.rgs`

Instale/configure GPG e importe a chave pública autorizada no host para gerar um pacote pelo script. O destino deve ser um volume seguro fora do repositório:

```sh
cd "/home/rgarcez/SCPO Connect"
export SCPO_BACKUP_DIR=/mnt/backup-institucional/scpo-connect
export SCPO_BACKUP_GPG_RECIPIENT=ID_DA_CHAVE_PUBLICA
bash scripts/backup-rgs.sh
```

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

Faça backups antes de migrações relevantes e execute testes periódicos de restauração em ambiente isolado. Retenção, destino externo e aprovação da rotina são decisões da Santa Casa; os scripts não apagam backups antigos.
