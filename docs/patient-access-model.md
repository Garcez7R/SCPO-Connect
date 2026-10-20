# Cadastro central e acesso aos dados do paciente

## Diretriz solicitada

O cadastro do paciente será compartilhado entre módulos. A autorização será individual e por módulo, verificada pela API em cada operação. A interface não decide sozinha quem pode consultar um campo. Gestão Hospitalar recebeu, por decisão do responsável pelo projeto, acesso clínico total; todas as consultas e alterações desse perfil devem ser identificadas e auditadas.

## Campos iniciais propostos

- Identificação institucional única, nome e situação do cadastro.
- Foto de identificação, opcional e com acesso rastreado.
- Quarto e leito atuais, com histórico de movimentações.
- Datas de admissão/alta e dados administrativos estritamente necessários.
- Dados de saúde separados por domínio (Enfermagem, Nutrição, Farmácia, Raio X, Serviço Social e Oficina Terapêutica), sem replicar prontuário clínico completo em todos os módulos.

Os campos demográficos exatos (ex.: data de nascimento, documento, contato e responsável) e a finalidade de cada um precisam ser aprovados pela Santa Casa antes da implementação. Não coletar por conveniência.

## Matriz inicial para validar

| Perfil | Cadastro mínimo | Foto | Dados clínicos | Escrita |
| --- | --- | --- | --- | --- |
| Recepção | Identificação, situação e localização necessária ao atendimento | Consultar para conferência | Somente status/alerta de alergia para encaminhamento seguro; sem detalhes clínicos | Admissão/correção cadastral conforme regra aprovada |
| Enfermagem | Identificação e localização | Consultar para conferência | Enfermagem e informações assistenciais necessárias | Registros de Enfermagem |
| Nutrição | Identificação | Conforme necessidade aprovada | Avaliação, dieta, restrições e dados necessários ao cuidado nutricional | Registros de Nutrição |
| Farmácia | Identificação | Não por padrão | Dados necessários a dispensação segura | Registros de Farmácia |
| Raio X | Identificação, localização e solicitação | Conforme necessidade de identificação aprovada | Pedido, preparo, alergias/restrições necessárias ao exame | Fluxo de exames |
| Serviço Social | Identificação | Não por padrão | Apenas registros sociais sob responsabilidade do serviço | Registros do Serviço Social |
| Higienização | Identificador operacional, quarto/leito e status do ambiente | Não | Não | Status e rotinas de higienização |
| Oficina Terapêutica | Identificação mínima e agenda | Não por padrão | Apenas informação necessária à participação segura | Presença e evolução da atividade |
| Gestão Hospitalar | Cadastro e todos os dados clínicos | Sim | Acesso total solicitado | Conforme autorização administrativa; toda operação auditada |

O cadastro distingue alergia conhecida (com detalhes), ausência de alergias conhecidas confirmada e situação desconhecida/não verificada. Os módulos clínicos autorizados recebem o alerta e os detalhes necessários ao cuidado. A Recepção recebe somente a sinalização no fluxo de emergência para chamar a equipe clínica, sem receber os detalhes clínicos na fila ou na listagem cadastral; a finalidade, os dados exibidos e o acesso institucional precisam ser validados antes de uso com dados reais.

Esta matriz é uma proposta técnica e deve ser confirmada com cada área e com os responsáveis institucionais por privacidade, segurança e assistência. Permissões individuais podem restringir os acessos do perfil; concessões adicionais devem ter justificativa, aprovador, validade e auditoria.

## Compartilhamento seletivo entre Serviço Social e Psicologia/Psiquiatria

Os registros de atendimento psicológico/psiquiátrico continuam privados ao módulo de origem. O fluxo de compartilhamento não copia automaticamente evoluções, planos ou encaminhamentos: o profissional cria um resumo independente, seleciona as categorias estritamente necessárias e indica uma finalidade e o módulo destinatário. O resumo fica acessível somente ao módulo destinatário e ao autor no módulo de origem.

Cada compartilhamento tem prazo limitado (7 dias por padrão, com opções de 14 ou 30 dias), autoria registrada e pode ser revogado pelo autor. Leituras, criação e revogação geram eventos de auditoria sem incluir o conteúdo do resumo. A revogação impede novas consultas do destinatário; não apaga o registro de auditoria nem substitui a política institucional de retenção.

Esse mecanismo técnico não determina a base legal, não registra consentimento válido nem substitui análise do responsável institucional por privacidade. Antes de usar dados reais, a Santa Casa deve aprovar finalidade, fluxo de consentimento/base legal, retenção, exceções assistenciais, perfis autorizados e procedimento para correção de compartilhamento indevido. Até essa aprovação, o sistema deve ser validado somente com dados fictícios.

## Foto e trilha de auditoria

A imagem deve ser opcional, armazenada em repositório privado fora da pasta pública do frontend, com tipo/tamanho validados, acesso temporário autorizado pela API, política de retenção e cópias de segurança protegidas. Não embutir imagem em logs nem em listagens de massa.

Auditar pelo menos leitura de perfil/dados clínicos, abertura/visualização da foto, criação, edição, movimentação, exportação e mudança de permissões. Guardar identificador institucional, perfil efetivo, paciente/recurso, ação, resultado, data/hora e justificativa quando aplicável; não duplicar o conteúdo clínico no log. As regras de retenção e acesso aos logs devem ser aprovadas pela instituição.

## Pré-requisitos técnicos

- Diretório central de pacientes e identificador único, com chaves estrangeiras dos registros dos módulos.
- Sessão institucional validada no servidor contra o AD do Zentyal; grupos do AD mapeados para papéis, e permissões por usuário persistidas em configuração administrativa controlada.
- Autorização por endpoint e por operação/campo, negação por padrão, MFA/sessão segura conforme decisão institucional e revogação de acesso sincronizada com o diretório.
- Migração dos registros fictícios e estratégia de backup/recuperação revisadas antes de qualquer dado real.
- Auditoria de leitura e mudança implementada antes de liberar o acesso clínico total para Gestão Hospitalar.

Até esses requisitos serem implementados e validados, o cadastro mostrado no app é apenas uma estrutura de navegação; não use dados identificáveis nem fotos reais.
