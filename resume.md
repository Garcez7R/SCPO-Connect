# SCPO Connect — handoff para retomada

Atualizado em 29/10/2026. Repositório: `/home/rgarcez/SCPO Connect`, branch `main`. Use este documento para retomar o trabalho neste workspace; não altere dados clínicos nem implante em produção sem autorização.

## Estado confirmado

- Último commit observado antes deste handoff: `0127ca0 Add kitchen roster and physician mobile PWA`.
- O workspace estava limpo antes da atualização deste documento.
- `npm run build` foi executado nesta retomada e passou: TypeScript, Vite e geração do service worker. O build inclui as entradas principal, Enfermagem, Operações, Farmácia e Médico.
- O build gerou o chunk `main` com 582,84 kB minificados e mostrou o aviso conhecido do Vite sobre chunks acima de 500 kB. O erro de build do Nursing relatado pelo usuário não foi reproduzido nesta execução; isso não comprova que o problema intermitente foi resolvido.
- Nenhuma suíte de testes foi iniciada. Respeitar a orientação de não retomar testes amplos sem autorização; fazer builds e validações direcionadas necessárias às mudanças.

## Já implementado

- PWAs separados da Enfermagem (`/nursing.html`), Operações (`/operations.html`), Farmácia (`/pharmacy.html`) e Médico (`/physician.html`).
- O PWA de Manutenção/Higienização permite, quando conectado e autorizado, alterar a situação e concluir ordens/solicitações. Offline, as filas em cache são somente para leitura; não há login offline.
- O PWA da Farmácia usa as APIs e permissões existentes, omite compras e oferece estoque, inventário, prescrições e dispensação. Uma simplificação adicional da experiência móvel ainda precisa ser avaliada.
- Nutrição tem o **Mapa da cozinha** para consulta de dieta, alergias, restrições e jejuns dos pacientes internados; um PWA específico da cozinha não está implementado.
- A proteção de tela da Recepção tem configuração de imagens e ativação após cinco minutos sem chamada nova.
- Oficina Terapêutica tem biblioteca de imagens com envio, título, download e exclusão, em armazenamento separado do banco. Ainda não há criação de pastas nem organização de imagens em diretórios.
- O projeto tem instalador de validação para Debian 13 e documentação de implantação, backup e permissões.

## Pendências desta tarefa

1. **Erro de build em Nursing:** o usuário reportou novo erro. Obter o log exato do erro quando disponível e reproduzir no ambiente correspondente. O `npm run build` atual passa, mas não valida o build/startup de cada container/backend. Inspecionar e executar as validações específicas dos serviços, principalmente Nursing, sem confundir sucesso do frontend com saúde do container.
2. **Guias da Enfermagem:** ainda não estão no alto como solicitado. Em `src/App.tsx`, o cabeçalho aparece primeiro, depois a faixa/seletor de paciente, e só então `ModuleTabNavigation` com `className="nursing-tabs"`. Reposicionar as guias logo abaixo do cabeçalho, acima da seleção de paciente, e confirmar que os fluxos/telas continuam corretos.
3. **Screensaver da Recepção:** os cinco minutos e as imagens estão implementados, mas a imagem ocupa somente o painel central (`waiting-room-kiosk-current`); o cabeçalho e o rodapé continuam visíveis. Fazer a imagem assumir a tela inteira e reduzir a exposição estática do painel para evitar burn-in. Ao surgir uma nova chamada, mostrar o painel/chamada e interromper o screensaver; confirmar também comportamento de atualização, acessibilidade e telas menores.
4. **Rótulo de Operações móveis:** as páginas desktop ainda mostram o link “PWA móvel · consulta”, que é enganoso. Trocar por texto simples para leigos (por exemplo, “Abrir no celular”) e explicitar que atualização/encerramento exigem conexão e permissão. A capacidade de alterar e concluir já existe; não reimplementá-la sem necessidade.
5. **PWA da Farmácia:** avaliar e simplificar a navegação móvel para as ações mais frequentes, mantendo o app completo no computador e sem duplicar APIs ou permissões.
6. **PWA da cozinha:** definir um fluxo móvel mínimo para a equipe sem computador. Partir do mapa existente e avaliar uma lista de refeições com dieta, alergias, restrições e jejum, além de um estado operacional simples para preparo/entrega se os responsáveis aprovarem esse fluxo. Não expor notas clínicas ou dados desnecessários.
7. **Gerenciador de arquivos da Oficina:** a biblioteca atual é uma galeria plana, sem pastas. Implementar organização simples no navegador para criar pastas, classificar/mover imagens e excluir, com autorização, validações e persistência compatíveis com o volume próprio da Oficina.
8. **Revisão final de builds:** após as mudanças, executar builds verificáveis dos pontos afetados e revisar especialmente Nursing. Investigar falhas, não ocultá-las com fallback. A suíte ampla/E2E permanece pausada até autorização do usuário.
9. Atualizar documentação pertinente, então revisar o diff, criar commit conforme o padrão do repositório e fazer push. Não incluir credenciais, tokens, bancos, logs ou artefatos gerados.

## Notas para retomada

- Mudanças desta retomada: este `resume.md` foi substituído por este handoff e o README foi corrigido para descrever que Operações permite alterações online, mantendo cache offline somente para leitura.
- O README continua sendo a referência geral do usuário; `docs/pilot-security-readiness.md` descreve as limitações offline e controles institucionais.
- Não presumir que o erro relatado no Nursing foi corrigido apenas porque o build frontend desta sessão passou. Solicitar/usar a saída completa do build que falhou para identificar a etapa e o serviço.
