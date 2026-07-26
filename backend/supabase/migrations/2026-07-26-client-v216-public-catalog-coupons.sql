-- TraGo Cliente V21.6
-- Cache pública mínima, protegida por RLS, para cupões activos dos restaurantes.
-- A tabela privada public.restaurants não recebe permissões públicas.

create table if not exists public.trago_public_catalog_coupon_cache (
  id text primary key,
  code text not null,
  name text not null,
  description text not null default '',
  source text not null default 'restaurant',
  restaurant_id text not null,
  restaurant_name text not null,
  discount_type text not null default 'fixed',
  discount_percent numeric not null default 0,
  discount_value_cents bigint not null default 0,
  discount_label text not null default '',
  min_order_cents bigint not null default 0,
  expires_at timestamptz,
  conditions text not null default '',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.trago_public_catalog_coupon_cache enable row level security;

drop policy if exists trago_public_catalog_coupon_cache_read
  on public.trago_public_catalog_coupon_cache;
create policy trago_public_catalog_coupon_cache_read
on public.trago_public_catalog_coupon_cache
for select
to anon, authenticated
using (active = true and (expires_at is null or expires_at >= now()));

revoke all on table public.trago_public_catalog_coupon_cache from public;
grant select on table public.trago_public_catalog_coupon_cache
  to anon, authenticated, service_role;

create or replace function public.trago_sync_public_catalog_coupon_cache()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  restaurant_row public.restaurants%rowtype;
begin
  restaurant_row := case when tg_op = 'DELETE' then old else new end;

  delete from public.trago_public_catalog_coupon_cache
  where restaurant_id = restaurant_row.id::text;

  if tg_op <> 'DELETE' and new.status = 'active' then
    insert into public.trago_public_catalog_coupon_cache (
      id, code, name, description, source, restaurant_id, restaurant_name,
      discount_type, discount_percent, discount_value_cents, discount_label,
      min_order_cents, expires_at, conditions, active, updated_at
    )
    select
      coalesce(
        nullif(coupon.item ->> 'id', ''),
        new.id::text || ':' || upper(trim(coupon.item ->> 'code'))
      ),
      upper(trim(coupon.item ->> 'code')),
      coalesce(nullif(coupon.item ->> 'name', ''), 'Cupão ' || new.name),
      coalesce(
        nullif(coupon.item ->> 'description', ''),
        'Consulte as condições no checkout.'
      ),
      'restaurant',
      new.id::text,
      new.name,
      coalesce(nullif(coupon.item ->> 'type', ''), 'fixed'),
      case
        when lower(coalesce(coupon.item ->> 'type', '')) = 'percentage'
          then greatest(coalesce(nullif(coupon.item ->> 'value', '')::numeric, 0), 0)
        else 0
      end,
      case
        when lower(coalesce(coupon.item ->> 'type', '')) = 'fixed'
          then round(
            greatest(coalesce(nullif(coupon.item ->> 'value', '')::numeric, 0), 0) * 100
          )::bigint
        else 0
      end,
      case
        when lower(coalesce(coupon.item ->> 'type', '')) = 'percentage'
          then trim(to_char(
            greatest(coalesce(nullif(coupon.item ->> 'value', '')::numeric, 0), 0),
            'FM999999990.##'
          )) || '% de desconto'
        when lower(coalesce(coupon.item ->> 'type', '')) = 'delivery'
          then 'Entrega grátis'
        else trim(to_char(
          greatest(coalesce(nullif(coupon.item ->> 'value', '')::numeric, 0), 0),
          'FM999999990.00'
        )) || ' MZN de desconto'
      end,
      round(
        greatest(coalesce(nullif(coupon.item ->> 'min', '')::numeric, 0), 0) * 100
      )::bigint,
      case
        when nullif(coupon.item ->> 'expires_at', '') is null then null
        when (coupon.item ->> 'expires_at') ~ '^\d{4}-\d{2}-\d{2}'
          then (coupon.item ->> 'expires_at')::timestamptz
        else null
      end,
      case
        when greatest(coalesce(nullif(coupon.item ->> 'min', '')::numeric, 0), 0) > 0
          then 'Pedido mínimo de ' || trim(to_char(
            greatest(coalesce(nullif(coupon.item ->> 'min', '')::numeric, 0), 0),
            'FM999999990.00'
          )) || ' MZN'
        else 'Consulte as condições no checkout.'
      end,
      true,
      now()
    from jsonb_array_elements(coalesce(new.coupons, '[]'::jsonb)) as coupon(item)
    where coalesce((coupon.item ->> 'active')::boolean, true) = true
      and nullif(trim(coupon.item ->> 'code'), '') is not null
      and (
        greatest(coalesce(nullif(coupon.item ->> 'limit', '')::numeric, 0), 0) = 0
        or greatest(coalesce(nullif(coupon.item ->> 'used', '')::numeric, 0), 0)
          < greatest(coalesce(nullif(coupon.item ->> 'limit', '')::numeric, 0), 0)
      );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.trago_sync_public_catalog_coupon_cache()
  from public, anon, authenticated;
grant execute on function public.trago_sync_public_catalog_coupon_cache()
  to service_role;

drop trigger if exists trg_restaurants_public_catalog_coupon_cache
  on public.restaurants;
create trigger trg_restaurants_public_catalog_coupon_cache
after insert or update of coupons, name, status or delete
on public.restaurants
for each row
execute function public.trago_sync_public_catalog_coupon_cache();

truncate table public.trago_public_catalog_coupon_cache;
insert into public.trago_public_catalog_coupon_cache (
  id, code, name, description, source, restaurant_id, restaurant_name,
  discount_type, discount_percent, discount_value_cents, discount_label,
  min_order_cents, expires_at, conditions, active, updated_at
)
select
  coalesce(
    nullif(coupon.item ->> 'id', ''),
    restaurant.id::text || ':' || upper(trim(coupon.item ->> 'code'))
  ),
  upper(trim(coupon.item ->> 'code')),
  coalesce(nullif(coupon.item ->> 'name', ''), 'Cupão ' || restaurant.name),
  coalesce(
    nullif(coupon.item ->> 'description', ''),
    'Consulte as condições no checkout.'
  ),
  'restaurant',
  restaurant.id::text,
  restaurant.name,
  coalesce(nullif(coupon.item ->> 'type', ''), 'fixed'),
  case
    when lower(coalesce(coupon.item ->> 'type', '')) = 'percentage'
      then greatest(coalesce(nullif(coupon.item ->> 'value', '')::numeric, 0), 0)
    else 0
  end,
  case
    when lower(coalesce(coupon.item ->> 'type', '')) = 'fixed'
      then round(
        greatest(coalesce(nullif(coupon.item ->> 'value', '')::numeric, 0), 0) * 100
      )::bigint
    else 0
  end,
  case
    when lower(coalesce(coupon.item ->> 'type', '')) = 'percentage'
      then trim(to_char(
        greatest(coalesce(nullif(coupon.item ->> 'value', '')::numeric, 0), 0),
        'FM999999990.##'
      )) || '% de desconto'
    when lower(coalesce(coupon.item ->> 'type', '')) = 'delivery'
      then 'Entrega grátis'
    else trim(to_char(
      greatest(coalesce(nullif(coupon.item ->> 'value', '')::numeric, 0), 0),
      'FM999999990.00'
    )) || ' MZN de desconto'
  end,
  round(
    greatest(coalesce(nullif(coupon.item ->> 'min', '')::numeric, 0), 0) * 100
  )::bigint,
  case
    when nullif(coupon.item ->> 'expires_at', '') is null then null
    when (coupon.item ->> 'expires_at') ~ '^\d{4}-\d{2}-\d{2}'
      then (coupon.item ->> 'expires_at')::timestamptz
    else null
  end,
  case
    when greatest(coalesce(nullif(coupon.item ->> 'min', '')::numeric, 0), 0) > 0
      then 'Pedido mínimo de ' || trim(to_char(
        greatest(coalesce(nullif(coupon.item ->> 'min', '')::numeric, 0), 0),
        'FM999999990.00'
      )) || ' MZN'
    else 'Consulte as condições no checkout.'
  end,
  true,
  now()
from public.restaurants as restaurant
cross join lateral jsonb_array_elements(
  coalesce(restaurant.coupons, '[]'::jsonb)
) as coupon(item)
where restaurant.status = 'active'
  and coalesce((coupon.item ->> 'active')::boolean, true) = true
  and nullif(trim(coupon.item ->> 'code'), '') is not null
  and (
    greatest(coalesce(nullif(coupon.item ->> 'limit', '')::numeric, 0), 0) = 0
    or greatest(coalesce(nullif(coupon.item ->> 'used', '')::numeric, 0), 0)
      < greatest(coalesce(nullif(coupon.item ->> 'limit', '')::numeric, 0), 0)
  );

create or replace function public.trago_public_catalog_coupons()
returns table (
  id text,
  code text,
  name text,
  description text,
  source text,
  restaurant_id text,
  restaurant_name text,
  discount_type text,
  discount_percent numeric,
  discount_value_cents bigint,
  discount_label text,
  min_order_cents bigint,
  expires_at text,
  conditions text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    cache.id,
    cache.code,
    cache.name,
    cache.description,
    cache.source,
    cache.restaurant_id,
    cache.restaurant_name,
    cache.discount_type,
    cache.discount_percent,
    cache.discount_value_cents,
    cache.discount_label,
    cache.min_order_cents,
    cache.expires_at::text,
    cache.conditions
  from public.trago_public_catalog_coupon_cache as cache
  where cache.active = true
    and (cache.expires_at is null or cache.expires_at >= now())
  order by cache.restaurant_name, cache.code;
$$;

revoke all on function public.trago_public_catalog_coupons() from public;
grant execute on function public.trago_public_catalog_coupons()
  to anon, authenticated, service_role;

comment on function public.trago_public_catalog_coupons() is
  'Projecção pública mínima via cache RLS de cupões activos dos restaurantes.';
