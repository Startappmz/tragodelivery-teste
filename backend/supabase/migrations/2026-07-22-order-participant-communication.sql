-- TraGo · comunicação operacional Cliente ↔ Restaurante ↔ Motorista ↔ Admin.
alter table public.restaurants add column if not exists operational_note text not null default '';
alter table public.restaurants add column if not exists is_open boolean not null default true;

alter table public.orders add column if not exists restaurant_id text references public.restaurants(id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_restaurant_id_fkey') then
    alter table public.orders add constraint orders_restaurant_id_fkey foreign key (restaurant_id) references public.restaurants(id) on delete set null;
  end if;
end $$;
alter table public.orders add column if not exists restaurant_status text;
alter table public.orders drop constraint if exists orders_restaurant_status_check;
alter table public.orders add constraint orders_restaurant_status_check
  check (restaurant_status is null or restaurant_status in ('new', 'accepted', 'preparing', 'ready', 'rejected'));
alter table public.orders add column if not exists restaurant_ready_at timestamptz;
alter table public.orders add column if not exists restaurant_prep_time_min integer;
alter table public.orders drop constraint if exists orders_restaurant_prep_time_min_check;
alter table public.orders add constraint orders_restaurant_prep_time_min_check
  check (restaurant_prep_time_min is null or restaurant_prep_time_min between 1 and 180);
alter table public.orders add column if not exists public_access_token_hash text;

create table if not exists public.order_messages (
  id text primary key default public.trago_generate_id(),
  order_id text not null references public.orders(id) on delete cascade,
  sender_role text not null check (sender_role in ('client', 'driver', 'restaurant', 'admin', 'system')),
  sender_id text not null,
  sender_name text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  message_type text not null default 'text' check (message_type in ('text', 'status', 'ready', 'system')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_order_messages_order_created on public.order_messages(order_id, created_at);
create index if not exists idx_orders_restaurant_status on public.orders(restaurant_id, restaurant_status, created_at desc);

drop trigger if exists trg_order_messages_updated_at on public.order_messages;
create trigger trg_order_messages_updated_at before update on public.order_messages
for each row execute function public.trago_touch_updated_at();

alter table public.order_messages enable row level security;
