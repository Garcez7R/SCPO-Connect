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

O botão **Gerar backup** em Administração do Sistema exporta os mesmos sete bancos usando AES-GCM e a senha informada pelo superadministrador. A interface não importa nem aplica backups aos bancos ativos. Para validar um arquivo exportado pela interface, use a restauração isolada abaixo; o script solicitará a senha sem expô-la na linha de comando.

## Biblioteca de imagens da Oficina Terapêutica

Os metadados da biblioteca são armazenados no banco Nursing; os arquivos ficam no diretório indicado por `SCPO_THERAPY_MATERIALS_HOST_DIR` (padrão: `./data/therapy-materials`). Para usar um HD externo, a equipe de infraestrutura deve primeiro montá-lo no host em um caminho persistente e definir esse caminho no `.env`, por exemplo:

```sh
SCPO_THERAPY_MATERIALS_HOST_DIR=/mnt/scpo-therapy-assets
```

O aplicativo aceita imagens JPG, PNG e WebP de até 12 MB por arquivo. O acervo é autenticado e não é servido como conteúdo público.

Antes de iniciar ou reiniciar os containers, confirme que o dispositivo está realmente montado no caminho configurado (`findmnt --target /mnt/scpo-therapy-assets`) e que o diretório permite leitura e gravação ao UID/GID `10001` usado pelo container. Se o disco não estiver montado, o bind mount pode gravar no disco do sistema em vez do HD externo. A preparação do mount, permissões e persistência após reinicialização deve ser validada pela TI no host; o aplicativo não detecta nem monta hardware.

O pacote `.rgs` não inclui esse diretório. Faça backup separado das imagens para um destino institucional protegido, com retenção e teste de restauração definidos; preservar somente o banco não recupera os arquivos da biblioteca, e preservar somente as imagens não recupera seus metadados.

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
