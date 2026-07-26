-- Cliente V21.4 · paginação e sincronização da caixa de notificações
alter table public.client_notifications
  add column if not exists deleted_at timestamptz;

create index if not exists idx_client_notifications_visible_cursor
  on public.client_notifications (client_id, created_at desc, id desc)
  where deleted_at is null;

create index if not exists idx_client_notifications_unread_cursor
  on public.client_notifications (client_id, created_at desc, id desc)
  where deleted_at is null and read_at is null;
