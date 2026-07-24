-- Trago Delivery · Supabase/Postgres schema
-- Execute este ficheiro no Supabase Dashboard > SQL Editor > New query.
-- IDs mantidos em formato texto de 24 caracteres hexadecimais para preservar
-- compatibilidade com o front-end e com validações herdadas do projecto.

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

create table if not exists public.users (
  id text primary key default public.trago_generate_id(),
  nome text not null,
  email text not null unique,
  telefone text not null,
  password text not null,
  role text not null check (role in ('admin', 'driver', 'manager')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id text primary key default public.trago_generate_id(),
  plate text not null unique,
  brand text,
  model text,
  type text not null default 'mota' check (type in ('mota', 'carro', 'carrinha', 'outro')),
  status text not null default 'ativo' check (status in ('ativo', 'manutencao', 'inativo')),
  notes text,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_profiles (
  id text primary key default public.trago_generate_id(),
  user_id text not null unique references public.users(id) on delete cascade,
  vehicle_plate text default '',
  vehicle_id text references public.vehicles(id) on delete set null,
  driver_type text not null default 'freelancer' check (driver_type in ('freelancer', 'official')),
  status text not null default 'offline' check (status in ('online_livre', 'online_ocupado', 'em_recolha', 'em_entrega', 'offline')),
  commission_rate numeric(5,2) not null default 20 check (commission_rate >= 0 and commission_rate <= 100),
  last_location jsonb,
  avatar_url text not null default '',
  vehicle_photo_url text not null default '',
  license_photo_url text not null default '',
  vehicle_brand text not null default '',
  vehicle_model text not null default '',
  vehicle_color text not null default '',
  vehicle_type text not null default 'mota',
  vehicle_year integer,
  license_number text not null default '',
  license_expiry date,
  license_category text not null default 'A',
  emergency_name text not null default '',
  emergency_phone text not null default '',
  bio text not null default '',
  rating numeric(3,2) not null default 4.90 check (rating >= 0 and rating <= 5),
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id text primary key default public.trago_generate_id(),
  nome text not null,
  telefone text not null unique,
  email text,
  empresa text,
  nuit text,
  endereco text,
  auth_provider text not null default '',
  auth_subject text not null default '',
  avatar_url text not null default '',
  last_login_at timestamptz,
  billing_type text not null default 'prepaid' check (billing_type in ('prepaid', 'postpaid')),
  credit_limit numeric(12,2) not null default 0 check (credit_limit >= 0),
  credit_balance numeric(12,2) not null default 0 check (credit_balance >= 0),
  credit_used numeric(12,2) not null default 0 check (credit_used >= 0),
  created_by_admin text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id text primary key default public.trago_generate_id(),
  service_type text not null,
  price numeric(12,2) not null default 0,
  client_name text not null,
  client_phone1 text not null,
  client_phone2 text,
  address_text text,
  address_coords jsonb,
  pickup_address_text text,
  pickup_contact_name text,
  pickup_contact_phone text,
  pickup_notes text,
  client_notes text not null default '',
  pickup_address_coords jsonb,
  service_price numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  route_distance_km numeric(10,2),
  route_duration_min numeric(10,2),
  route_pricing_source text,
  image_url text,
  verification_code text not null,
  created_by_admin text references public.users(id) on delete set null,
  assigned_to_driver text references public.driver_profiles(id) on delete set null,
  offered_to_driver text references public.driver_profiles(id) on delete set null,
  driver_offer_status text check (driver_offer_status is null or driver_offer_status in ('pending', 'accepted', 'rejected', 'expired')),
  driver_offer_expires_at timestamptz,
  driver_offer_rejected_ids jsonb not null default '[]'::jsonb,
  driver_assigned_at timestamptz,
  last_status_at timestamptz,
  restaurant_id text,
  restaurant_status text check (restaurant_status in ('new', 'accepted', 'preparing', 'ready', 'rejected')),
  restaurant_ready_at timestamptz,
  restaurant_prep_time_min integer check (restaurant_prep_time_min between 1 and 180),
  partner_confirmed_at timestamptz,
  partner_confirmed_by text,
  pickup_authorized_at timestamptz,
  pickup_authorized_by text,
  public_access_token_hash text,
  client text references public.clients(id) on delete set null,
  status text not null default 'pendente' check (status in (
    'pendente',
    'atribuido',
    'em_progresso',
    'recolha_em_progresso',
    'recolha_concluida',
    'entrega_em_progresso',
    'concluido',
    'cancelado'
  )),
  timestamp_started timestamptz,
  timestamp_completed timestamptz,
  pickup_start_at timestamptz,
  pickup_completed_at timestamptz,
  delivery_start_at timestamptz,
  delivery_completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text references public.users(id) on delete set null,
  cancel_reason text,
  valor_motorista numeric(12,2) not null default 0,
  valor_empresa numeric(12,2) not null default 0,
  payment_method text not null default 'cash' check (payment_method in ('cash', 'mpesa', 'emola', 'mkesh', 'bank_transfer', 'pos', 'postpaid_credit')),
  payment_status text not null default 'nao_pago' check (payment_status in ('nao_pago', 'aguardando_confirmacao_pagamento', 'pago', 'pos_pago_mensal')),
  payment_confirmed_amount numeric(12,2),
  payment_confirmation_requested_at timestamptz,
  payment_confirmed_at timestamptz,
  driver_delivery_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


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

-- Caixa de entrada interna partilhada por cliente, motorista, restaurante e Admin.
create table if not exists public.support_threads (
  id text primary key default public.trago_generate_id(),
  subject text not null,
  category text not null default 'general' check (category in ('order', 'payment', 'account', 'technical', 'restaurant', 'driver', 'general')),
  status text not null default 'open' check (status in ('open', 'pending', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  requester_role text not null check (requester_role in ('client', 'driver', 'restaurant', 'admin')),
  requester_id text not null,
  requester_name text not null default '',
  order_id text references public.orders(id) on delete set null,
  assigned_admin_id text references public.users(id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id text primary key default public.trago_generate_id(),
  thread_id text not null references public.support_threads(id) on delete cascade,
  sender_role text not null check (sender_role in ('client', 'driver', 'restaurant', 'admin')),
  sender_id text not null,
  sender_name text not null default '',
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id text primary key default public.trago_generate_id(),
  order_id text references public.orders(id) on delete cascade,
  scope text not null default 'order',
  channel_type text not null default 'client_driver'
    check (channel_type in ('client_driver', 'driver_partner', 'system', 'support')),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mensagens de pedido são separadas por via; nunca existe um chat único para
-- Cliente, Motorista e Estabelecimento.
create table if not exists public.order_messages (
  id text primary key default public.trago_generate_id(),
  order_id text not null references public.orders(id) on delete cascade,
  sender_role text not null check (sender_role in ('client', 'driver', 'restaurant', 'admin', 'system')),
  sender_id text not null,
  sender_name text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  conversation_id text references public.conversations(id) on delete set null,
  channel_type text not null default 'system'
    check (channel_type in ('client_driver', 'driver_partner', 'system', 'support')),
  visible_to_roles text[] not null default array['client', 'driver', 'restaurant', 'admin']::text[],
  message_type text not null default 'text' check (message_type in ('text', 'status', 'ready', 'system')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_status_events (
  id text primary key default public.trago_generate_id(),
  order_id text not null references public.orders(id) on delete cascade,
  status text not null,
  label text not null default '',
  actor_type text not null default 'system',
  actor_id text not null default '',
  actor_name text not null default '',
  note text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id text primary key default public.trago_generate_id(),
  actor_role text not null default 'system',
  actor_id text,
  action text not null,
  entity_type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.driver_presence (
  driver_profile_id text primary key references public.driver_profiles(id) on delete cascade,
  is_online boolean not null default false,
  is_available boolean not null default false,
  current_order_id text references public.orders(id) on delete set null,
  latitude numeric,
  longitude numeric,
  accuracy numeric,
  speed numeric,
  heading numeric,
  last_seen_at timestamptz,
  location_updated_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_presence_lat_check check (latitude is null or latitude between -90 and 90),
  constraint driver_presence_lng_check check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.driver_offers (
  id text primary key default public.trago_generate_id(),
  order_id text not null references public.orders(id) on delete cascade,
  driver_profile_id text not null references public.driver_profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  selected_by_role text not null check (selected_by_role in ('client', 'admin', 'system')),
  selected_by_id text,
  rejection_reason text,
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trips (
  id text primary key default public.trago_generate_id(),
  driver text not null references public.driver_profiles(id) on delete cascade,
  order_id text references public.orders(id) on delete set null,
  type text not null check (type in ('coleta', 'entrega', 'retorno_central', 'pausa', 'outro')),
  status text not null default 'em_andamento' check (status in ('em_andamento', 'concluida', 'cancelada')),
  started_at timestamptz not null,
  finished_at timestamptz,
  origin jsonb,
  destination jsonb,
  positions jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{"distance":0,"duration":0,"avgSpeed":0,"maxSpeed":0}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id text primary key default public.trago_generate_id(),
  category text not null check (category in ('manutencao', 'combustivel', 'emprestimo', 'credito', 'taxa_trans_levant', 'consumiveis', 'despesas_aplicativo', 'diversos')),
  description text not null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  date timestamptz not null,
  employee text references public.users(id) on delete set null,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_costs (
  id text primary key default public.trago_generate_id(),
  category text not null check (category in ('manutencao', 'combustivel', 'emprestimo', 'credito', 'taxa_trans_levant', 'consumiveis', 'despesas_aplicativo', 'diversos')),
  description text default '',
  amount numeric(12,2) not null default 0 check (amount >= 0),
  date timestamptz not null default now(),
  created_by text references public.users(id) on delete set null,
  assigned_user text references public.users(id) on delete set null,
  assigned_client text references public.clients(id) on delete set null,
  assigned_vehicle text references public.vehicles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_cost_single_assignment check (
    ((assigned_user is not null)::int + (assigned_client is not null)::int + (assigned_vehicle is not null)::int) <= 1
  )
);

create index if not exists idx_users_role_nome on public.users(role, nome);
create index if not exists idx_system_notifications_scope_read_created on public.system_notifications(scope, read_at, created_at desc);
create index if not exists idx_system_notifications_order on public.system_notifications(order_id);
create index if not exists idx_system_notifications_dedupe on public.system_notifications(dedupe_key);
create index if not exists idx_support_threads_requester on public.support_threads(requester_role, requester_id, last_message_at desc);
create index if not exists idx_support_threads_admin_queue on public.support_threads(status, priority, last_message_at desc);
create index if not exists idx_support_threads_order on public.support_threads(order_id);
create index if not exists idx_support_messages_thread_created on public.support_messages(thread_id, created_at);
create index if not exists idx_order_messages_order_created on public.order_messages(order_id, created_at);
create unique index if not exists idx_conversations_order_channel on public.conversations(order_id, channel_type) where order_id is not null;
create index if not exists idx_order_messages_channel_created on public.order_messages(order_id, channel_type, created_at);
create index if not exists idx_driver_presence_radar on public.driver_presence(is_online, is_available, last_seen_at desc, location_updated_at desc);
create unique index if not exists idx_driver_offers_one_pending_order on public.driver_offers(order_id) where status = 'pending';
create unique index if not exists idx_driver_offers_one_pending_driver on public.driver_offers(driver_profile_id) where status = 'pending';
create index if not exists idx_orders_restaurant_status on public.orders(restaurant_id, restaurant_status, created_at desc);
create index if not exists idx_vehicles_plate on public.vehicles(plate);
create index if not exists idx_driver_profiles_status on public.driver_profiles(status);
create index if not exists idx_driver_profiles_vehicle on public.driver_profiles(vehicle_id);
create index if not exists idx_driver_profiles_type on public.driver_profiles(driver_type);
create index if not exists idx_orders_status_created on public.orders(status, created_at desc);
create index if not exists idx_orders_driver_status on public.orders(assigned_to_driver, status);
create index if not exists idx_orders_client_completed on public.orders(client, status, timestamp_completed desc);
create index if not exists idx_orders_payment_method on public.orders(payment_method);
create index if not exists idx_orders_payment_status on public.orders(payment_status);
create index if not exists idx_clients_billing_type on public.clients(billing_type);
create index if not exists idx_clients_email_lower on public.clients(lower(email));
create index if not exists idx_clients_auth_provider_subject on public.clients(auth_provider, auth_subject) where auth_provider <> '' and auth_subject <> '';
create index if not exists idx_driver_profiles_status_location on public.driver_profiles(status) where last_location is not null;
create index if not exists idx_orders_public_radar_status on public.orders(status, created_at desc) where status in ('pendente', 'atribuido');
create index if not exists idx_orders_route_distance on public.orders(route_distance_km);
create index if not exists idx_trips_driver_started on public.trips(driver, started_at desc);
create index if not exists idx_expenses_date_category on public.expenses(date desc, category);
create index if not exists idx_company_costs_date_category on public.company_costs(date desc, category);
create index if not exists idx_company_costs_vehicle on public.company_costs(assigned_vehicle);

-- Triggers de updated_at
drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at before update on public.users
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_vehicles_updated_at on public.vehicles;
create trigger trg_vehicles_updated_at before update on public.vehicles
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_driver_profiles_updated_at on public.driver_profiles;
create trigger trg_driver_profiles_updated_at before update on public.driver_profiles
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at before update on public.clients
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at before update on public.orders
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_system_notifications_updated_at on public.system_notifications;
create trigger trg_system_notifications_updated_at before update on public.system_notifications
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_support_threads_updated_at on public.support_threads;
create trigger trg_support_threads_updated_at before update on public.support_threads
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_support_messages_updated_at on public.support_messages;
create trigger trg_support_messages_updated_at before update on public.support_messages
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_order_messages_updated_at on public.order_messages;
create trigger trg_order_messages_updated_at before update on public.order_messages
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_trips_updated_at on public.trips;
create trigger trg_trips_updated_at before update on public.trips
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_expenses_updated_at on public.expenses;
create trigger trg_expenses_updated_at before update on public.expenses
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_company_costs_updated_at on public.company_costs;
create trigger trg_company_costs_updated_at before update on public.company_costs
for each row execute function public.trago_touch_updated_at();

-- Como o backend usa SUPABASE_SECRET_KEY no servidor, a chave secreta bypassa RLS.
-- Mantemos RLS activa por segurança caso alguém tente usar chave pública no front-end.
alter table public.users enable row level security;
alter table public.vehicles enable row level security;
alter table public.driver_profiles enable row level security;
alter table public.clients enable row level security;
alter table public.orders enable row level security;
alter table public.system_notifications enable row level security;
alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
alter table public.order_messages enable row level security;
alter table public.conversations enable row level security;
alter table public.order_status_events enable row level security;
alter table public.audit_logs enable row level security;
alter table public.driver_presence enable row level security;
alter table public.driver_offers enable row level security;
alter table public.trips enable row level security;
alter table public.expenses enable row level security;
alter table public.company_costs enable row level security;

-- Restauração profissional de password por email (admin/motorista)
create table if not exists public.password_reset_codes (
  id text primary key default public.trago_generate_id(),
  user_id text not null references public.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'driver')),
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_password_reset_codes_email_role
on public.password_reset_codes(email, role);

create index if not exists idx_password_reset_codes_user_active
on public.password_reset_codes(user_id, role, created_at desc)
where used_at is null;

create index if not exists idx_password_reset_codes_expires_at
on public.password_reset_codes(expires_at);

drop trigger if exists trg_password_reset_codes_touch_updated_at on public.password_reset_codes;
create trigger trg_password_reset_codes_touch_updated_at
before update on public.password_reset_codes
for each row execute function public.trago_touch_updated_at();


-- -----------------------------------------------------------------------------
-- Portais Cliente/Restaurante
-- -----------------------------------------------------------------------------
-- Trago Delivery · Portais Cliente/Restaurante
-- Execute no Supabase SQL Editor antes de usar login-restaurante.html/restaurante.html.

create extension if not exists pgcrypto;

create table if not exists public.restaurants (
  id text primary key default public.trago_generate_id(),
  name text not null,
  email text not null unique,
  phone text not null default '',
  password_hash text not null,
  address_text text not null default '',
  address_coords jsonb,
  logo_url text not null default '',
  cover_url text not null default '',
  operational_note text not null default '',
  is_open boolean not null default true,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.restaurant_menu_items (
  id text primary key default public.trago_generate_id(),
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  name text not null,
  category text not null default 'Geral',
  description text not null default '',
  price numeric(12,2) not null default 0 check (price >= 0),
  image_url text not null default '',
  available boolean not null default true,
  prep_time_min integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_restaurant_id_fkey') then
    alter table public.orders add constraint orders_restaurant_id_fkey foreign key (restaurant_id) references public.restaurants(id) on delete set null;
  end if;
end $$;

create index if not exists idx_restaurants_status_name on public.restaurants(status, name);
create index if not exists idx_restaurants_email on public.restaurants(email);
create index if not exists idx_menu_restaurant_category on public.restaurant_menu_items(restaurant_id, category, name);
create index if not exists idx_menu_available on public.restaurant_menu_items(available);

drop trigger if exists trg_restaurants_updated_at on public.restaurants;
create trigger trg_restaurants_updated_at before update on public.restaurants
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_restaurant_menu_items_updated_at on public.restaurant_menu_items;
create trigger trg_restaurant_menu_items_updated_at before update on public.restaurant_menu_items
for each row execute function public.trago_touch_updated_at();

alter table public.restaurants enable row level security;
alter table public.restaurant_menu_items enable row level security;


-- Portal Cliente v2: avaliações de pratos/restaurantes
create table if not exists public.restaurant_ratings (
  id text primary key default public.trago_generate_id(),
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  menu_item_id text not null default '',
  customer_session_id text not null default '',
  rating integer not null check (rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, menu_item_id, customer_session_id)
);
create index if not exists idx_restaurant_ratings_restaurant on public.restaurant_ratings(restaurant_id);
create index if not exists idx_restaurant_ratings_menu_item on public.restaurant_ratings(menu_item_id);
create index if not exists idx_restaurant_ratings_score on public.restaurant_ratings(rating);
alter table public.restaurant_ratings enable row level security;
