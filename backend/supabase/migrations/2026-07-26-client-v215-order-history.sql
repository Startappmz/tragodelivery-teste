-- TraGo Cliente V21.5 — histórico paginado, ordenação estável e índices por estado.

update public.orders
set closed_at = coalesce(
  closed_at,
  case
    when status = 'concluido' then timestamp_completed
    when status = 'cancelado' then cancelled_at
    else null
  end,
  updated_at,
  created_at
)
where status in ('concluido', 'cancelado')
  and closed_at is null;

create index if not exists idx_orders_client_active_cursor
  on public.orders (client, updated_at desc, id desc)
  where status in ('pendente', 'atribuido', 'em_progresso', 'recolha_em_progresso', 'recolha_concluida', 'entrega_em_progresso');

create index if not exists idx_orders_client_completed_cursor
  on public.orders (client, closed_at desc, id desc)
  where status = 'concluido';

create index if not exists idx_orders_client_cancelled_cursor
  on public.orders (client, closed_at desc, id desc)
  where status = 'cancelado';
