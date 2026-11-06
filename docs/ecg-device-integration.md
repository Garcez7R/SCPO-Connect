# Integração do ECG Bionet CardioCare 2000 / EKS2000

## Objetivo e estado atual

Preparar uma integração verificável entre o eletrocardiógrafo Bionet CardioCare 2000 (também identificado como EKS2000) e a guia **Eletrocardiograma** da Central de Exames, sem presumir protocolo, formato ou interface do equipamento.

No código atual, a Central de Exames cria solicitações `ecg` vinculadas a um cadastro de paciente e permite registrar resultado textual, situação e autoria. Ainda não há recepção de arquivos/traçados, API de anexos para ECG, armazenamento persistente dedicado no serviço `xray` ou comunicação com o aparelho. A configuração Docker do serviço `xray` não expõe uma porta de recepção para a rede do equipamento.

Por isso, a proposta compartilhada de abrir um listener TCP na porta 9100 não deve ser implantada nem testada contra o aparelho antes de confirmar a interface suportada pelo fabricante e receber autorização da TI. Também não se deve tentar decodificar um payload desconhecido. O exemplo de código contém `threading.time.time()`, que não existe, e não define limite de tamanho, timeout, autenticação, confirmação de recebimento ou política de dados clínicos.

A guia ECG inclui uma prévia navegável das etapas de equipamento, recepção e conferência/vínculo. Ela usa somente conteúdo fictício, inclusive um traçado sintético decorativo sem finalidade diagnóstica: não se conecta ao aparelho, não aceita upload e não grava dados.

## Preparação para a sessão com o aparelho

### Antes de conectar

- Confirmar com a TI responsável que o aparelho pode ser conectado à rede designada e que a atividade de teste está autorizada.
- Obter o manual técnico correspondente à versão/modelo e, se possível, consultar a Bionet ou assistência autorizada sobre as interfaces de exportação e integração suportadas.
- Uma impressão de teste mostra a identificação `EKG2000 6.05/3.26`. Registrar como texto observado na impressão, não como versão confirmada de firmware: pedir à TI/fornecedor que esclareça o significado de cada número e a quais componentes/software se referem.
- Separar uma solicitação ECG de teste e um fluxo de demonstração que não contenha dados identificáveis de paciente. Não usar exames reais em ambiente não aprovado.
- Não registrar senhas, chaves, dados do paciente ou conteúdo do traçado em tickets, capturas de tela ou este repositório.

### Levantamento a registrar (sem varredura da rede)

1. Modelo exato indicado na etiqueta, versão de firmware exibida no menu de serviço/configuração e nome/versão do software Bionet usado para revisão ou exportação. Comparar essas informações com `EKG2000 6.05/3.26` visto na impressão e confirmar explicitamente seu significado; não inferir capacidades de rede ou formatos a partir desses números.
2. Opções de saída exibidas pelo próprio equipamento/software: USB/mídia, arquivo, impressão, compartilhamento em rede ou integração documentada. Não assumir que DICOM, HL7, XML ou TCP estejam disponíveis.
3. Para cada opção, registrar o nome do formato documentado, direção do envio, destino configurado pela TI, confirmação/ACK, comportamento em falha/reenvio e identificação que acompanha o exame.
4. Se houver interface de rede oficialmente suportada, a TI deve informar IP, máscara/VLAN e porta/protocolo configurados. Consultar apenas a configuração do equipamento e testar comunicação explicitamente autorizada; não escanear sub-redes, não abrir portas no firewall e não iniciar listener antes de conhecer o protocolo e o sentido da conexão.
5. Se o fabricante disponibilizar arquivo de amostra, preservar uma cópia original de teste em armazenamento institucional aprovado e produzir uma cópia desidentificada para desenvolvimento.

## Ordem de decisão técnica

1. **Preferir exportação/importação oficial de arquivo** se preservar o traçado em formato que possa ser aberto por software clínico. Identificar a especificação e obter pelo menos uma amostra desidentificada válida e uma inválida.
2. **Avaliar DICOM/PACS, incluindo Orthanc, somente se houver suporte confirmado.** O fabricante deve confirmar que o modelo/firmware exporta ECG em DICOM e informar o tipo de objeto e o fluxo de envio. Antes de integrar ao SCPO, validar com amostra desidentificada se o arquivo contém o traçado e metadados necessários e se uma ferramenta clínica consegue apresentá-lo. Um PACS não substitui a implementação de recepção, armazenamento protegido, vínculo, permissões, auditoria, retenção e backup; não publicar suas portas diretamente nem adicionar um serviço ao Compose antes de definir controles de acesso e rede com a TI.
3. **Usar protocolo padrão ou SDK oficial** somente se o manual/fornecedor confirmar que o modelo e a versão instalados o suportam e definir transporte, payload, ACK, autenticação e reenvio.
4. **Implementar um adaptador isolado** apenas após a etapa anterior. O adaptador não deve interpretar achados ou completar automaticamente o laudo; deve receber em área de staging privada, limitar origem e tamanho, aplicar timeout, validar o formato documentado, registrar hash e resultado técnico sem conteúdo clínico e rejeitar entradas inválidas de forma explícita.
5. **Vincular o exame com confirmação humana.** Não localizar pacientes por nome extraído do arquivo nem criar/alterar cadastro automaticamente. O operador seleciona uma solicitação ECG existente e confere a identificação no fluxo institucional antes de anexar.
6. **Preservar o original e a auditoria.** Não sobrescrever o arquivo recebido; armazenar hash SHA-256, nome original sanitizado, tamanho, tipo reconhecido, horário, usuário/serviço de origem e solicitação vinculada. Downloads e visualização devem exigir permissão e ser auditados.
7. **Planejar armazenamento e recuperação antes da produção.** O serviço `xray` não tem hoje volume próprio de anexos. Qualquer suporte a traçados precisa definir armazenamento privado e persistente, limites, retenção, backup e restauração, acesso por perfil e comportamento após exclusão/arquivamento do pedido.
8. **Validar visualização com a equipe clínica.** Se o formato for proprietário, abrir ou converter somente com biblioteca/ferramenta licenciada e validada. A apresentação do traçado ou do laudo deve manter a distinção entre dado do aparelho e resultado revisado/assinado por profissional.

## Casos de teste para uma amostra autorizada

- Arquivo oficial válido: identificar tipo/tamanho, calcular hash e confirmar que os bytes originais permanecem inalterados.
- Arquivo truncado, extensão/MIME divergentes, tipo não suportado e arquivo acima do limite: rejeitar com erro visível, sem criar anexo parcialmente utilizável.
- Reenvio do mesmo arquivo: detectar possível duplicidade pelo hash e pedir decisão explícita; não duplicar ou substituir silenciosamente.
- Associação a paciente/solicitação inexistente, encerrada ou incompatível: impedir o vínculo e manter o arquivo em staging restrito para tratamento autorizado.
- Falha de comunicação ou interrupção durante transferência: não marcar como recebido/importado até concluir a validação e confirmação definida pelo protocolo.
- Permissões: perfil sem acesso ao módulo não consulta, envia nem baixa o arquivo; leituras e alterações autorizadas ficam auditadas.
- Backup/recuperação: demonstrar que metadados e arquivo podem ser recuperados juntos em ambiente isolado, antes de habilitar o fluxo em produção.

## Decisões pendentes após conectar o equipamento

- Interface e formato efetivamente disponíveis nesta unidade/modelo/firmware.
- Onde o arquivo/traçado fica acessível e qual equipe terá permissão de operação.
- Se a integração será importação manual, integração via software oficial ou recepção de rede documentada.
- Tipos de arquivo aceitos, limites, política de retenção e armazenamento/backup.
- Revisão clínica da exibição, vínculo ao pedido e etapa em que o resultado pode ser considerado concluído.

Até essas decisões serem registradas e testadas com dados desidentificados, não habilitar comunicação de rede, listener TCP ou importação de exames reais.
