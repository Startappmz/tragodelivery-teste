-- Trago Delivery - distância, pontos de recolha/entrega e preço final
-- Execute no Supabase Dashboard > SQL Editor para actualizar bases já existentes.

alter table public.orders
  add column if not exists pickup_address_text text,
  add column if not exists pickup_address_coords jsonb,
  add column if not exists service_price numeric(12,2) not null default 0,
  add column if not exists delivery_fee numeric(12,2) not null default 0,
  add column if not exists route_distance_km numeric(10,2),
  add column if not exists route_duration_min numeric(10,2),
  add column if not exists route_pricing_source text;

create index if not exists idx_orders_route_distance on public.orders(route_distance_km);

-- Para pedidos antigos, considera o preço total antigo como preço de serviço
-- e deixa a taxa de distância a 0 até serem recalculados manualmente.
update public.orders
set service_price = price
where service_price = 0 and price > 0;
