-- Trago Delivery · Cliente v3
-- Cadastro opcional de clientes, login Google, pesquisa de endereços e radar de motoristas.
-- Execute depois das migrations dos portais cliente/restaurante.

alter table public.clients
  add column if not exists auth_provider text not null default '',
  add column if not exists auth_subject text not null default '',
  add column if not exists avatar_url text not null default '',
  add column if not exists last_login_at timestamptz;

create index if not exists idx_clients_email_lower
on public.clients (lower(email));

create index if not exists idx_clients_auth_provider_subject
on public.clients (auth_provider, auth_subject)
where auth_provider <> '' and auth_subject <> '';

create index if not exists idx_driver_profiles_status_location
on public.driver_profiles (status)
where last_location is not null;

create index if not exists idx_orders_public_radar_status
on public.orders (status, created_at desc)
where status in ('pendente', 'atribuido');
