# Backup e restauração demonstrativos

Os scripts aceitam somente backups explicitamente confirmados como dados fictícios, criptografam com GPG e recusam sobrescrever destinos existentes. A chave pública do destinatário precisa estar importada no host do backup; para restaurar, a chave privada correspondente precisa estar disponível no ambiente seguro do operador.

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