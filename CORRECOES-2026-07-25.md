# TraGo Delivery — Correcções 2026-07-25

## Aplicado na base Supabase
- Migração dos estados legados `confirmado` e `pronto_recolha`.
- Associação segura dos pedidos antigos ao restaurante único correspondente.
- Campo `orders.closed_at` e trigger de sincronização.
- Estrutura de avaliações verificadas por cliente e pedido concluído.
- Política de recepção Realtime por tópico exacto.
- RPCs atómicas para stock, cupões, crédito pós-pago, criação e cancelamento de pedidos.
- Rate limiting persistente.
- Índices de chaves estrangeiras em falta e remoção de dois índices duplicados.
- Políticas deny-all e revogação de acesso directo `anon`/`authenticated`; acesso de dados via Edge/service role.

## Código corrigido neste pacote
- Canais Realtime privados com JWT e `setAuth()`.
- Isolamento de restaurante apenas por `restaurant_id`.
- Criação/cancelamento transaccional de pedidos.
- Histórico por `closed_at`.
- Avaliações apenas após pedido concluído.
- Notificações com deduplicação de pedidos.
- Rota provisória imediata e geometria rodoviária posterior.
- CORS por origem permitida.
- Imagens operacionais preparadas para bucket privado e URLs assinadas.

## Estado de publicação
A Edge Function `api` deste pacote ainda precisa ser implantada. Até isso acontecer, o trigger pós-pago e a privacidade do bucket `order-images` foram mantidos em modo compatível com a API antiga. Após publicar `supabase/functions/api/index.ts`, aplicar novamente a migration completa deste pacote ou, no mínimo, activar `trg_orders_postpaid_reserve` e tornar `order-images` privado.

## Testes
`npm test`: 89/89 testes passaram.
