-- Trago Delivery · Melhorias do Portal Cliente
-- Carrinho modal, avaliações e destaques de pratos/restaurantes.
-- Execute no Supabase SQL Editor depois da migration dos portais cliente/restaurante.

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

drop trigger if exists trg_restaurant_ratings_updated_at on public.restaurant_ratings;
create trigger trg_restaurant_ratings_updated_at before update on public.restaurant_ratings
for each row execute function public.trago_touch_updated_at();

alter table public.restaurant_ratings enable row level security;
