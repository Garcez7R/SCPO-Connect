# Integração futura com Active Directory do Zentyal

O AD do Zentyal está adiado, sem previsão, pois depende de verba. A configuração abaixo fica como referência futura; não bloqueia o uso da CA interna do Caddy para HTTPS. Enquanto AD não estiver disponível, o app continua sem login institucional e não deve receber dados reais até que uma alternativa de identidade, autorização no servidor e auditoria seja implementada.

## Grupos de segurança sugeridos

Criar grupos próprios para a aplicação, sem usar `Domain Admins` como grupo de acesso ao app:

- `SCPO-Enfermagem`
- `SCPO-Farmacia`
- `SCPO-RaioX`
- `SCPO-ServicoSocial`
- `SCPO-Nutricao`
- `SCPO-Higienizacao`
- `SCPO-Recepcao`
- `SCPO-OficinaTerapeutica`
- `SCPO-GestaoHospitalar`

Gestão Hospitalar será mapeada ao perfil master solicitado, com acesso clínico total e auditoria obrigatória. Grupos AD indicam o perfil inicial; permissões individuais e exceções devem ser administradas pelo SCPO com aprovador, motivo, validade e trilha de auditoria.

## Dados de configuração a obter do Zentyal

Registrar em configuração protegida do servidor, nunca no Git:

- FQDN e IP do controlador de domínio; domínio DNS e Base DN.
- DN dos contêineres de usuários e grupos e atributo estável do usuário (`sAMAccountName` ou `userPrincipalName`).
- Endereço LDAP seguro (LDAPS ou StartTLS), certificado/CA confiável e política de validação TLS.
- Conta de serviço de leitura mínima, se necessária para busca de grupos; não usar credencial de administrador do domínio.
- Nomes/SIDs definitivos dos grupos SCPO e fluxo de bloqueio/desligamento de usuário.

Não iniciar autenticação por LDAP simples sem TLS. Não armazenar senha de usuário no SCPO. Se a instituição disponibilizar um provedor OIDC já integrado ao diretório, preferir OIDC; caso contrário, a integração LDAP segura deverá criar sessão curta e protegida no backend, com MFA/controles definidos pela TI.

## Fluxo de autorização

1. Backend valida identidade no diretório/provedor e cria sessão segura; nenhuma função, nome ou grupo é aceito de cabeçalhos enviados pelo navegador.
2. Backend consulta grupos autorizados e cruza com as permissões por usuário/módulo armazenadas no SCPO. Toda rota nega por padrão.
3. Registros de negócio carregam um identificador imutável da pessoa autenticada; nome e papel apresentados são derivados dessa identidade.
4. Cada leitura sensível, exibição de foto, alteração e concessão de privilégio é auditada. A interface apenas oculta ações sem acesso, sem substituir a verificação do servidor.
5. Remoção/bloqueio no AD revoga sessões no SCPO segundo procedimento definido pela TI.

## Dados pendentes antes da implementação

Preencher domínio, Base DN, FQDN/IP, certificados, grupos e formato do atributo de login após a instalação. Obter esses dados não exige enviar senha ou credencial administrativa nesta conversa; compartilhar somente parâmetros não secretos.

Referência: [documentação oficial do Zentyal 8.1 — Domain Controller and Directory Services](https://doc.zentyal.org/en/directory.html).
