-- TraGo Delivery · integração final dos quatro painéis.
--
-- Migração idempotente e conservadora:
-- - preserva pedidos e mensagens operacionais existentes;
-- - transforma as tabelas de suporte antigas no contrato usado pelos quatro painéis;
-- - acrescenta os campos de perfil, comunicação, agendamento e comprovativo;
-- - cria um bucket público apenas para leitura de imagens publicadas pela API.

begin;

-- Restaurante e pedido operacional.
alter table public.restaurants
  add column if not exists operational_note text not null default '';

alter table public.orders
  add column if not exists restaurant_status text,
  add column if not exists restaurant_ready_at timestamptz,
  add column if not exists restaurant_prep_time_min integer,
  add column if not exists public_access_token_hash text,
  add column if not exists route_stops jsonb not null default '[]'::jsonb,
  add column if not exists delivery_proof_url text not null default '',
  add column if not exists delivery_proof_at timestamptz;

alter table public.orders drop constraint if exists orders_restaurant_status_check;
alter table public.orders add constraint orders_restaurant_status_check
  check (
    restaurant_status is null
    or restaurant_status in ('new', 'accepted', 'preparing', 'ready', 'rejected')
  );

alter table public.orders drop constraint if exists orders_restaurant_prep_time_min_check;
alter table public.orders add constraint orders_restaurant_prep_time_min_check
  check (
    restaurant_prep_time_min is null
    or restaurant_prep_time_min between 1 and 180
  );

alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
  check (
    payment_method in (
      'cash', 'mpesa', 'emola', 'mkesh', 'bank_transfer',
      'pos', 'card', 'wallet', 'postpaid_credit'
    )
  );

-- Perfil premium do motorista.
alter table public.driver_profiles
  add column if not exists vehicle_photo_url text not null default '',
  add column if not exists license_photo_url text not null default '',
  add column if not exists vehicle_brand text not null default '',
  add column if not exists vehicle_model text not null default '',
  add column if not exists vehicle_color text not null default '',
  add column if not exists vehicle_type text not null default 'mota',
  add column if not exists vehicle_year integer,
  add column if not exists license_number text not null default '',
  add column if not exists license_expiry date,
  add column if not exists license_category text not null default 'A',
  add column if not exists emergency_name text not null default '',
  add column if not exists emergency_phone text not null default '',
  add column if not exists bio text not null default '',
  add column if not exists verified boolean not null default false;

update public.driver_profiles
set
  emergency_name = coalesce(nullif(emergency_name, ''), emergency_contact_name, ''),
  emergency_phone = coalesce(nullif(emergency_phone, ''), emergency_contact_phone, '')
where emergency_name = '' or emergency_phone = '';

alter table public.driver_profiles drop constraint if exists driver_profiles_rating_check;
alter table public.driver_profiles add constraint driver_profiles_rating_check
  check (rating >= 0 and rating <= 5);

-- Endereços persistentes do Cliente.
alter table public.saved_addresses
  add column if not exists reference text not null default '',
  add column if not exists is_default boolean not null default false;

create index if not exists idx_saved_addresses_client_created
  on public.saved_addresses(client_id, created_at desc);

create unique index if not exists idx_saved_addresses_one_default
  on public.saved_addresses(client_id)
  where is_default;

-- Conversa operacional do pedido: converte o contrato legado sem apagar dados.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_messages' and column_name = 'sender_type'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_messages' and column_name = 'sender_role'
  ) then
    alter table public.order_messages rename column sender_type to sender_role;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_messages' and column_name = 'message'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_messages' and column_name = 'body'
  ) then
    alter table public.order_messages rename column message to body;
  end if;
end
$$;

alter table public.order_messages
  add column if not exists message_type text not null default 'text',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.order_messages drop constraint if exists order_messages_message_check;
alter table public.order_messages drop constraint if exists order_messages_body_check;
alter table public.order_messages add constraint order_messages_body_check
  check (char_length(body) between 1 and 2000);

alter table public.order_messages drop constraint if exists order_messages_sender_type_check;
alter table public.order_messages drop constraint if exists order_messages_sender_role_check;
alter table public.order_messages add constraint order_messages_sender_role_check
  check (sender_role in ('client', 'driver', 'restaurant', 'admin', 'system'));

alter table public.order_messages drop constraint if exists order_messages_message_type_check;
alter table public.order_messages add constraint order_messages_message_type_check
  check (message_type in ('text', 'status', 'ready', 'system'));

create index if not exists idx_order_messages_order_created
  on public.order_messages(order_id, created_at);

drop trigger if exists trg_order_messages_updated_at on public.order_messages;
create trigger trg_order_messages_updated_at
before update on public.order_messages
for each row execute function public.trago_touch_updated_at();

alter table public.order_messages enable row level security;

-- Suporte interno: converte support_tickets/support_messages para um contrato
-- comum a Cliente, Restaurante, Motorista e Admin.
do $$
begin
  if to_regclass('public.support_threads') is null
     and to_regclass('public.support_tickets') is not null then
    alter table public.support_tickets rename to support_threads;
  end if;
end
$$;

alter table public.support_threads
  alter column client_id drop not null,
  alter column ticket_number set default (
    'SUP-' || upper(public.trago_generate_id())
  ),
  add column if not exists requester_role text,
  add column if not exists requester_id text,
  add column if not exists requester_name text not null default '',
  add column if not exists assigned_admin_id text references public.users(id) on delete set null,
  add column if not exists last_message_at timestamptz not null default now();

update public.support_threads
set
  requester_role = coalesce(nullif(requester_role, ''), 'client'),
  requester_id = coalesce(nullif(requester_id, ''), client_id, id),
  requester_name = coalesce(nullif(requester_name, ''), 'Cliente'),
  last_message_at = coalesce(last_message_at, updated_at, created_at, now()),
  category = case when category = 'other' then 'general' else category end,
  status = case
    when status in ('in_progress', 'waiting_client') then 'pending'
    else status
  end;

alter table public.support_threads
  alter column requester_role set not null,
  alter column requester_id set not null;

alter table public.support_threads drop constraint if exists support_tickets_category_check;
alter table public.support_threads drop constraint if exists support_threads_category_check;
alter table public.support_threads add constraint support_threads_category_check
  check (category in ('order', 'payment', 'refund', 'account', 'technical', 'restaurant', 'driver', 'general'));

alter table public.support_threads drop constraint if exists support_tickets_status_check;
alter table public.support_threads drop constraint if exists support_threads_status_check;
alter table public.support_threads add constraint support_threads_status_check
  check (status in ('open', 'pending', 'resolved', 'closed'));

alter table public.support_threads drop constraint if exists support_threads_requester_role_check;
alter table public.support_threads add constraint support_threads_requester_role_check
  check (requester_role in ('client', 'driver', 'restaurant', 'admin'));

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'support_messages' and column_name = 'ticket_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'support_messages' and column_name = 'thread_id'
  ) then
    alter table public.support_messages rename column ticket_id to thread_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'support_messages' and column_name = 'sender_type'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'support_messages' and column_name = 'sender_role'
  ) then
    alter table public.support_messages rename column sender_type to sender_role;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'support_messages' and column_name = 'message'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'support_messages' and column_name = 'body'
  ) then
    alter table public.support_messages rename column message to body;
  end if;
end
$$;

alter table public.support_messages
  add column if not exists sender_name text not null default '',
  add column if not exists updated_at timestamptz not null default now();

update public.support_messages
set
  sender_id = coalesce(nullif(sender_id, ''), 'system'),
  sender_role = case when sender_role = 'agent' then 'admin' else sender_role end,
  sender_name = coalesce(nullif(sender_name, ''), case when sender_role = 'admin' then 'Admin' else 'TraGo' end);

alter table public.support_messages alter column sender_id set not null;

alter table public.support_messages drop constraint if exists support_messages_sender_type_check;
alter table public.support_messages drop constraint if exists support_messages_sender_role_check;
alter table public.support_messages add constraint support_messages_sender_role_check
  check (sender_role in ('client', 'driver', 'restaurant', 'admin', 'system'));

create index if not exists idx_support_threads_requester
  on public.support_threads(requester_role, requester_id, last_message_at desc);
create index if not exists idx_support_threads_admin_queue
  on public.support_threads(status, priority, last_message_at desc);
create index if not exists idx_support_threads_order
  on public.support_threads(order_id);
create index if not exists idx_support_messages_thread_created
  on public.support_messages(thread_id, created_at);

drop trigger if exists trg_support_threads_updated_at on public.support_threads;
create trigger trg_support_threads_updated_at
before update on public.support_threads
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_support_messages_updated_at on public.support_messages;
create trigger trg_support_messages_updated_at
before update on public.support_messages
for each row execute function public.trago_touch_updated_at();

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;

-- Índices operacionais usados pelos quatro painéis.
create index if not exists idx_orders_restaurant_status
  on public.orders(restaurant_id, restaurant_status, created_at desc);
create index if not exists idx_orders_scheduled_at
  on public.orders(scheduled_at)
  where scheduled_at is not null;
create index if not exists idx_driver_profiles_status_location
  on public.driver_profiles(status)
  where last_location is not null;

-- Imagens públicas de perfil, viatura, restaurante e produtos.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'trago-media',
  'trago-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Documentos e comprovativos nunca ficam publicamente acessíveis.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'trago-private-media',
  'trago-private-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Buckets públicos não precisam de SELECT em storage.objects para servir
-- URLs públicas. Sem estas policies, os objectos continuam visíveis pela
-- respectiva URL, mas não podem ser enumerados por clientes anónimos.
drop policy if exists order_images_public_read on storage.objects;
drop policy if exists trago_media_public_read on storage.objects;

-- As RPCs TraGo são executadas exclusivamente pela Edge Function com a
-- service role. Retira o acesso directo via /rest/v1/rpc aos papéis públicos.
do $$
declare
  function_record record;
begin
  for function_record in
    select p.oid::regprocedure as signature
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'trago_%'
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      function_record.signature
    );
    execute format(
      'grant execute on function %s to service_role',
      function_record.signature
    );
  end loop;
end
$$;

alter function public.trago_generate_id()
  set search_path = pg_catalog, public;
alter function public.trago_touch_updated_at()
  set search_path = pg_catalog, public;

-- Mantém apenas os índices UNIQUE pertencentes às constraints.
drop index if exists public.idx_driver_profiles_user_unique;
drop index if exists public.idx_product_stock_item_unique;
drop index if exists public.idx_support_messages_ticket;

commit;
