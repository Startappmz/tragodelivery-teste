-- Trago Delivery — notificações persistidas + filtros por período
-- Execute no Supabase SQL Editor antes de publicar a Edge Function actualizada.

begin;

create extension if not exists pgcrypto;

create or replace function public.trago_generate_id()
returns text
language sql
as $$
  select substr(encode(gen_random_bytes(12), 'hex'), 1, 24);
$$;

create or replace function public.trago_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.system_notifications (
  id text primary key default public.trago_generate_id(),
  scope text not null default 'admin' check (scope in ('admin')),
  dedupe_key text not null unique,
  type text not null default 'info' check (type in ('info', 'order', 'payment', 'success', 'warning', 'error')),
  title text not null,
  message text not null default '',
  order_id text references public.orders(id) on delete set null,
  order_code text,
  verification_code text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_system_notifications_scope_read_created
  on public.system_notifications(scope, read_at, created_at desc);
create index if not exists idx_system_notifications_order
  on public.system_notifications(order_id);
create index if not exists idx_system_notifications_dedupe
  on public.system_notifications(dedupe_key);

drop trigger if exists trg_system_notifications_updated_at on public.system_notifications;
create trigger trg_system_notifications_updated_at before update on public.system_notifications
for each row execute function public.trago_touch_updated_at();

alter table public.system_notifications enable row level security;

commit;
