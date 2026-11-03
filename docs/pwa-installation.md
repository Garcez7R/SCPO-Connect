# Instalar módulos do SCPO Connect

O aplicativo completo e os PWAs dos módulos podem ser adicionados separadamente à tela inicial. Cada PWA abre diretamente a área correspondente e usa um nome e um ícone próprios. A instalação e a disponibilidade das opções dependem do navegador e do sistema operacional.

| Módulo | Endereço |
| --- | --- |
| Aplicativo completo | `/` |
| Enfermagem | `/nursing.html` |
| Manutenção | `/maintenance.html` |
| Higienização | `/hygiene.html` |
| Farmácia | `/pharmacy.html` |
| Médico | `/physician.html` |
| Cozinha | `/kitchen.html` |
| Lavanderia/Rouparia | `/laundry.html` |

## Android

1. Abra o endereço HTTPS do módulo que deseja usar no Chrome ou em outro navegador compatível.
2. No menu do navegador, escolha **Instalar app** ou **Adicionar à tela inicial**.
3. Manutenção e Higienização são atalhos separados; instale somente os necessários. `/operations.html` continua disponível para instalações antigas.

## iPhone e iPad

1. Abra o endereço HTTPS do módulo no Safari.
2. Use **Compartilhar** e escolha **Adicionar à Tela de Início**.
3. Confira o nome e o ícone apresentados antes de confirmar. As opções e o comportamento podem variar entre versões do iOS/iPadOS.

Os PWAs usam as mesmas contas, permissões e serviços do aplicativo completo; instalar um atalho não concede acesso adicional. A autenticação e os recursos de cada perfil continuam sujeitos às permissões do servidor. As filas de Manutenção e Higienização e seus caches offline cifrados são separados. As cópias locais são somente para consulta, expiram em até 24 horas e não permitem login offline; alterações de situação exigem conexão ao servidor.

O PWA da Lavanderia/Rouparia registra solicitações e movimentações de enxoval somente após confirmação do servidor; não há acesso offline nem armazenamento de dados operacionais no aparelho.

O navegador controla o fluxo de instalação e pode agrupar atalhos do mesmo domínio ou apresentar opções diferentes. A imagem composta do módulo é a fornecida à instalação; não há garantia de que o sistema operacional acrescente automaticamente um selo do navegador.
