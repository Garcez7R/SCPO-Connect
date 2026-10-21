# Dados demonstrativos

O conjunto demonstrativo contém sete pacientes com nomes prefixados por `DEMO -` e 30 dias de sinais vitais sintéticos por paciente (210 aferições). O painel permite visualizar períodos de 6 horas, 24 horas, 7 dias ou 30 dias. Cada aferição e autoria estão identificadas como demonstração; os valores não têm validade assistencial.

## Ambiente isolado

O lançador de APIs usa `data/demo` por padrão, onde o conjunto demonstrativo já está carregado. Os bancos preexistentes em `data/local` não são alterados. Para selecionar outro diretório, configure `SCPO_LOCAL_DATA_DIR`; nunca aponte esse diretório para produção.

```sh
bash scripts/dev-api.sh
```

Este lançador é exclusivo para desenvolvimento. Antes de validar com dados reais, selecione um diretório/banco novo e aprovado, confirme a configuração de ambiente e não reutilize `data/demo`.

Depois que as migrações locais forem concluídas, em outro terminal:

```sh
SCPO_ENV=demo \
SCPO_DEMO_DATA_DIR="$PWD/data/demo" \
SCPO_SERVICE=nursing \
SCPO_NURSING_DATABASE_URL="sqlite:///$PWD/data/demo/nursing.sqlite3" \
PYTHONPATH=backend \
./.venv/bin/python scripts/demo_vitals.py seed --confirm-non-production
```

O gerador exige confirmação explícita, ambiente `development`, `test` ou `demo`, uma URL de arquivo SQLite explícita e `SCPO_DEMO_DATA_DIR` apontando para um diretório dedicado chamado `demo`. O arquivo do banco deve estar dentro desse diretório; bancos remotos, bancos SQLite em memória e outros arquivos locais são recusados. Ele também recusa semear sobre um conjunto demonstrativo já existente.

## Remoção antes de validação real

Remova somente os dados demonstrativos com o mesmo banco isolado:

```sh
SCPO_ENV=demo \
SCPO_DEMO_DATA_DIR="$PWD/data/demo" \
SCPO_SERVICE=nursing \
SCPO_NURSING_DATABASE_URL="sqlite:///$PWD/data/demo/nursing.sqlite3" \
PYTHONPATH=backend \
./.venv/bin/python scripts/demo_vitals.py cleanup --confirm-non-production
```

A limpeza é cancelada se as aferições tiverem sido alteradas ou se houver registros de outros módulos vinculados aos pacientes. Para iniciar uma validação real, não reutilize `data/demo`: configure um banco novo, aprovado e vazio, e verifique as migrações e os registros antes de liberar acesso. Não remova bancos ou dados reais para limpar a demonstração.
