# Backup e restauração

O formato de transporte `.rgs` reúne os sete bancos da aplicação, incluindo contas locais, permissões e dados dos módulos, em um único arquivo cifrado. Os pacotes criados pelo script usam GPG; a exportação pela interface do superadministrador usa AES-GCM com senha. A restauração isolada aceita ambos os formatos. O conteúdo inclui dados pessoais e clínicos: guarde o arquivo e a chave/senha em locais institucionais controlados.

## Backup automático

O serviço de backup pode gerar um `.rgs` cifrado por senha AES-GCM ou pela chave pública GPG aprovada. O pacote inclui os sete bancos, o `.env`, o volume de dados do Caddy e os arquivos da Oficina Terapêutica. No Superadministrador, é possível gerar um par GPG: a chave privada fica no volume de backup do servidor, dentro de um diretório restrito, protegida pela senha escolhida; essa senha não é armazenada pelo aplicativo. A interface também permite baixar uma cópia ASCII-armored que continua cifrada pela mesma senha. Guarde o arquivo e a senha em locais institucionais separados para recuperação isolada. Sem a senha, a chave e os backups correspondentes não podem ser recuperados. A proteção por senha reduz o risco de acesso imediato, mas não equivale a custódia física separada: quem obtiver o arquivo cifrado poderá tentar adivinhar a senha offline.

Também é possível importar uma chave pública criada fora do sistema; nesse fluxo, a chave privada externa não é enviada ao aplicativo. A geração local configura automaticamente a chave pública correspondente para novos backups e mostra a impressão digital para conferência.

A instalação usa `/backups` como destino padrão do volume-base. Isso pressupõe que a TI tenha montado um disco autorizado nesse ponto. A variável `SCPO_BACKUP_HOST_DIR` continua permitindo escolher outro caminho absoluto futuro. No `.env` do projeto: Compartilhamentos de rede precisam estar montados no host Linux antes do Compose iniciar:

```dotenv
SCPO_BACKUP_HOST_DIR=/mnt/backup-institucional/scpo-connect
SCPO_BACKUP_TIMEZONE=America/Sao_Paulo
```

### Diretórios locais provisórios para testes

Para validar a funcionalidade com dados sintéticos, a instalação pode manter o estágio de backup dentro do diretório do app e usar os discos da Biblioteca/Álbum como volumes externos:

```dotenv
SCPO_BACKUP_HOST_DIR=./data/backup-staging
SCPO_THERAPY_LIBRARY_HOST_DIR=/biblio
SCPO_THERAPY_ALBUM_HOST_DIR=/album
SCPO_THERAPY_SEPARATE_STORAGE=true
```

Esses já são os caminhos padrão do Compose e estão excluídos do Git por `data/`. Se necessário, crie-os no host antes de subir os serviços: `mkdir -p data/backup-staging data/therapy-materials`. A rotina automática grava no volume de estágio; a exportação manual continua sendo baixada pelo navegador. São diretórios no mesmo disco do app, não uma cópia externa, imutável ou adequada para produção. Use somente dados sintéticos/desidentificados durante a avaliação; monitore o espaço disponível e confirme as permissões de gravação do container. Para operação institucional, migre para volumes persistentes autorizados e teste a recuperação isolada antes de guardar dados reais.

Após reiniciar o serviço `backup`, no Superadministrador → **Cópias de segurança**, importe somente a chave pública GPG ASCII-armored e informe uma subpasta relativa ao volume-base. Não informe caminhos do host na interface. O Superadministrador pode escolher a subpasta de backup; o diretório-base e a montagem física continuam sob responsabilidade da TI. Configure a rotina para executar diariamente, em intervalos de horas/dias, nos dias escolhidos da semana ou em datas do mês; o horário usa `America/Sao_Paulo`. Datas inexistentes no mês, como dia 31 em fevereiro, são ignoradas. O formulário exibe a configuração e a próxima execução.

A retenção configurável mantém até 1–365 dos backups próprios mais recentes. Também pode ser definido um limite máximo em GB para o destino. A expiração preexistente de 30 dias continua sendo um limite máximo adicional; ao ultrapassar quantidade, idade ou quota, a rotina apaga somente arquivos `.rgs` identificados como `scpo-connect-*.rgs`, começando pelos mais antigos. Backups mais novos são preservados enquanto a própria geração não fizer o total ultrapassar o limite. Falhas e espaço baixo são mostrados no painel. Abaixo de 10% de espaço livre, o painel alerta.

Até a TI montar o servidor físico e testar gravação, leitura e restauração, a interface identifica a imutabilidade como **não validada**. Um volume configurado e a retenção por quantidade/idade, por si sós, não comprovam imutabilidade/WORM.

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

Em Administração do Sistema → **Cópias de segurança**, use o atalho **Backup manual** ou a seção **Exportação imediata** para informar somente a senha e baixar o `.rgs`; não é necessário configurar a rotina automática. A exportação manual da interface inclui os sete bancos, usa AES-GCM e não inclui os arquivos da Oficina Terapêutica. A interface não importa nem aplica backups aos bancos ativos. Para validar um arquivo exportado pela interface, use a restauração isolada abaixo; o script solicitará a senha sem expô-la na linha de comando.

Na exportação manual, uma notificação persistente fixa na tela com o ícone do app indica a geração do pacote com barra indeterminada e mostra o percentual recebido durante o download do `.rgs`; a geração em si é indeterminada porque o servidor só inicia a resposta após criar o arquivo. Na restauração pela interface, a mesma notificação fixa mostra o envio e consulta as etapas no servidor: descriptografia, validação dos sete bancos, cópias temporárias e restauração de cada banco. Não feche a página até a conclusão. As operações de CPU e PostgreSQL rodam fora do ciclo HTTP para que a tela continue atualizando. Antes de tocar nos dados atuais, o servidor valida a senha, o manifesto e cada dump com `pg_restore --list`; um arquivo incompatível é rejeitado antes da criação das cópias de segurança ou de qualquer alteração. A tela informa explicitamente que arquivos GPG da rotina automática usam a chave privada custodiada e não podem ser restaurados nesse fluxo da interface.

## Biblioteca de imagens e Álbum da Oficina Terapêutica

Os metadados dos dois acervos são armazenados no banco Nursing; os arquivos ficam nos volumes definidos por `SCPO_THERAPY_LIBRARY_HOST_DIR` e `SCPO_THERAPY_ALBUM_HOST_DIR`. Na guia **Dashboard técnico**, o Superadministrador pode escolher subpastas independentes para Biblioteca, ativar/desativar cada acervo e definir cotas separadas. O sistema começa com a Biblioteca na raiz do disco configurado e o Álbum em `photo-album`. Alterar uma subpasta exige confirmação e move somente os arquivos cadastrados daquele acervo. As duas pastas não podem ser iguais. Reduzir cotas preserva arquivos e bloqueia novos envios até liberar espaço. A rotina automática inclui os dois volumes; pacotes manuais de banco e a exportação AES-GCM da interface não incluem imagens.

O caminho-base pode ser definido pela TI no host e montado nos containers; o campo da aplicação aceita somente subpastas relativas ao volume da Biblioteca, não caminhos absolutos do host. Para usar dois discos físicos distintos, configure os volumes separados no `.env` deste servidor:

```sh
SCPO_THERAPY_LIBRARY_HOST_DIR=/biblio
SCPO_THERAPY_ALBUM_HOST_DIR=/album
SCPO_THERAPY_SEPARATE_STORAGE=true
```

Nesta configuração, `/biblio` é usado pela Biblioteca e `/album` é usado pelo Álbum. O contêiner mantém o Álbum em `photo-album`, correspondendo a `/album` no host. Na interface, a Biblioteca pode usar a raiz ou uma subpasta relativa, como `biblioteca`; já o Álbum permanece em `photo-album` enquanto os discos estiverem separados. As pastas devem existir, estar montadas antes de iniciar os containers e permitir leitura/gravação ao UID/GID `10001` usado pelo serviço da Oficina. O backup automático também monta os dois discos em modo somente leitura. O Compose aceita `SCPO_THERAPY_MATERIALS_HOST_DIR` como fallback legado somente para o volume da Biblioteca; instalações novas devem usar as duas novas variáveis.

Os dois acervos aceitam imagens JPG, PNG e WebP de até 12 MB por arquivo. O acesso é autenticado e não é servido como conteúdo público. Use somente imagens aprovadas institucionalmente; não envie fotos identificáveis de pacientes sem as autorizações e o consentimento exigidos pela instituição.

Antes de iniciar ou reiniciar os containers, confirme que o dispositivo está realmente montado no caminho configurado (`findmnt --target /biblio`) e que o diretório permite leitura e gravação ao UID/GID `10001` usado pelo container. Se o disco não estiver montado, o bind mount pode gravar no disco do sistema em vez do HD externo. A preparação do mount, permissões e persistência após reinicialização deve ser validada pela TI no host; o aplicativo não detecta nem monta hardware.

O banco Nursing sem o volume de imagens não recupera os arquivos da Biblioteca nem do Álbum, e preservar somente o volume não recupera seus metadados. Faça exercícios de restauração que validem ambos.

A retenção automática de 30 dias remove somente arquivos de backup cifrados do destino configurado. A retenção de 365 dias da Auditoria remove somente eventos centrais antigos, mantendo um checkpoint verificável. Nenhum desses processos apaga os cadastros ou registros clínicos ativos dos pacientes.

Para validar a integração do volume, use somente uma imagem sintética e sem dados pessoais: abra Oficina Terapêutica → Biblioteca de imagens ou Álbum, envie a imagem, confira a prévia/lista e remova-a pela interface. Confirme no host que o arquivo correspondente foi criado na pasta própria e que arquivo e registro foram removidos. A suíte direcionada automatizada exercita upload, leitura e exclusão em diretório temporário; isso não comprova montagem, permissão, persistência após reinicialização nem restauração do disco externo real.

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
