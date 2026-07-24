-- Trago Delivery · Portais Cliente/Restaurante
-- Execute no Supabase SQL Editor antes de usar login-restaurante.html/restaurante.html.

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
