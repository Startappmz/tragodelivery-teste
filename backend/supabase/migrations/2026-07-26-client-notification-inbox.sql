-- Cliente V21.3 · caixa de notificações persistente
alter table public.client_notifications
  add column if not exists deleted_at timestamptz;

create index if not exists idx_client_notifications_visible
  on public.client_notifications (client_id, created_at desc)
  where deleted_at is null;
