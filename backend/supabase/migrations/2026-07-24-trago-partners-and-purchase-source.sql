-- TraGo Delivery · Parceiros, origem de compra e pontos de carga.
-- Migração idempotente: não altera nem publica parceiros existentes.

begin;

create table if not exists public.trago_partners (
  id text primary key default public.trago_generate_id(),
  restaurant_id text references public.restaurants(id) on delete set null,
  name text not null,
  partner_type text not null default 'other',
  summary text not null default '',
  products_summary text not null default '',
  phone text not null default '',
  whatsapp text not null default '',
  email text not null default '',
  address_text text not null default '',
  address_coords jsonb,
  logo_url text not null default '',
  cover_url text not null default '',
  opening_hours text not null default '',
  status text not null default 'pending',
  source text not null default 'application',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trago_partners drop constraint if exists trago_partners_partner_type_check;
alter table public.trago_partners add constraint trago_partners_partner_type_check
  check (partner_type in (
    'restaurant', 'bottle_store', 'shop', 'market', 'pharmacy',
    'bakery', 'florist', 'electronics', 'fashion', 'other'
  ));

alter table public.trago_partners drop constraint if exists trago_partners_status_check;
alter table public.trago_partners add constraint trago_partners_status_check
  check (status in ('pending', 'active', 'inactive', 'rejected'));

alter table public.trago_partners drop constraint if exists trago_partners_source_check;
alter table public.trago_partners add constraint trago_partners_source_check
  check (source in ('application', 'restaurant', 'admin', 'import'));

create unique index if not exists idx_trago_partners_restaurant
  on public.trago_partners(restaurant_id)
  where restaurant_id is not null;
create index if not exists idx_trago_partners_public
  on public.trago_partners(status, partner_type, name);
create index if not exists idx_trago_partners_contact
  on public.trago_partners(email, phone);

drop trigger if exists trg_trago_partners_updated_at on public.trago_partners;
create trigger trg_trago_partners_updated_at
before update on public.trago_partners
for each row execute function public.trago_touch_updated_at();

alter table public.trago_partners enable row level security;

alter table public.orders
  add column if not exists partner_id text references public.trago_partners(id) on delete set null,
  add column if not exists purchase_source_type text,
  add column if not exists purchase_source_label text not null default '',
  add column if not exists purchase_source_coords jsonb,
  add column if not exists requested_product text not null default '';

alter table public.orders drop constraint if exists orders_purchase_source_type_check;
alter table public.orders add constraint orders_purchase_source_type_check
  check (
    purchase_source_type is null
    or purchase_source_type in ('catalog_product', 'partner', 'map_location')
  );

create index if not exists idx_orders_partner_created
  on public.orders(partner_id, created_at desc)
  where partner_id is not null;

commit;
