-- TraGo Delivery · security, consistency and transactional hardening
-- 2026-07-25 · idempotent migration

begin;

-- ---------------------------------------------------------------------------
-- 1. Safe migration audit and legacy data repair
-- ---------------------------------------------------------------------------
create table if not exists public.trago_migration_backups (
  id text primary key default public.trago_generate_id(),
  migration_key text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (migration_key, entity_type, entity_id)
);
alter table public.trago_migration_backups enable row level security;

insert into public.trago_migration_backups(migration_key, entity_type, entity_id, payload)
select '2026-07-25-security-consistency-hardening', 'order', o.id, to_jsonb(o)
from public.orders o
where o.status in ('confirmado', 'pronto_recolha')
on conflict (migration_key, entity_type, entity_id) do nothing;

with unique_restaurant_match as (
  select o.id as order_id, min(r.id) as restaurant_id
  from public.orders o
  join public.restaurants r
    on lower(trim(coalesce(o.pickup_contact_name, ''))) = lower(trim(coalesce(r.name, '')))
    or regexp_replace(coalesce(o.pickup_contact_phone, ''), '\D', '', 'g') = regexp_replace(coalesce(r.phone, ''), '\D', '', 'g')
  where o.restaurant_id is null
    and (coalesce(trim(o.pickup_contact_name), '') <> '' or coalesce(trim(o.pickup_contact_phone), '') <> '')
  group by o.id
  having count(distinct r.id) = 1
)
update public.orders o
set restaurant_id = m.restaurant_id,
    updated_at = now()
from unique_restaurant_match m
where o.id = m.order_id
  and o.restaurant_id is null;

update public.orders
set status = 'pendente',
    restaurant_status = coalesce(restaurant_status, 'accepted'),
    partner_confirmed_at = coalesce(partner_confirmed_at, created_at),
    updated_at = now()
where status = 'confirmado';

update public.orders
set status = 'pendente',
    restaurant_status = 'ready',
    partner_confirmed_at = coalesce(partner_confirmed_at, created_at),
    restaurant_ready_at = coalesce(restaurant_ready_at, created_at),
    pickup_authorized_at = coalesce(pickup_authorized_at, created_at),
    updated_at = now()
where status = 'pronto_recolha';

-- ---------------------------------------------------------------------------
-- 2. Unified order closing timestamp
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists closed_at timestamptz;

update public.orders
set closed_at = case
  when status = 'concluido' then coalesce(timestamp_completed, delivery_completed_at, updated_at, created_at)
  when status = 'cancelado' then coalesce(cancelled_at, updated_at, created_at)
  else null
end
where closed_at is distinct from case
  when status = 'concluido' then coalesce(timestamp_completed, delivery_completed_at, updated_at, created_at)
  when status = 'cancelado' then coalesce(cancelled_at, updated_at, created_at)
  else null
end;

create or replace function public.trago_sync_order_closed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'concluido' then
    new.closed_at := coalesce(new.timestamp_completed, new.delivery_completed_at, new.closed_at, now());
  elsif new.status = 'cancelado' then
    new.closed_at := coalesce(new.cancelled_at, new.closed_at, now());
  else
    new.closed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_closed_at on public.orders;
create trigger trg_orders_closed_at
before insert or update of status, timestamp_completed, delivery_completed_at, cancelled_at
on public.orders
for each row execute function public.trago_sync_order_closed_at();

create index if not exists idx_orders_closed_at on public.orders(closed_at desc)
where closed_at is not null;

-- ---------------------------------------------------------------------------
-- 3. Verified ratings: client + completed order provenance
-- ---------------------------------------------------------------------------
alter table public.restaurant_ratings add column if not exists client_id text;
alter table public.restaurant_ratings add column if not exists order_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'restaurant_ratings_client_id_fkey'
  ) then
    alter table public.restaurant_ratings
      add constraint restaurant_ratings_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'restaurant_ratings_order_id_fkey'
  ) then
    alter table public.restaurant_ratings
      add constraint restaurant_ratings_order_id_fkey
      foreign key (order_id) references public.orders(id) on delete cascade;
  end if;
end $$;

alter table public.restaurant_ratings
  drop constraint if exists restaurant_ratings_restaurant_id_menu_item_id_customer_sess_key;
drop index if exists public.restaurant_ratings_restaurant_id_menu_item_id_customer_sess_key;
create unique index if not exists idx_restaurant_ratings_verified_order_item
  on public.restaurant_ratings(order_id, menu_item_id)
  where order_id is not null;
create index if not exists idx_restaurant_ratings_client on public.restaurant_ratings(client_id);
create index if not exists idx_restaurant_ratings_order on public.restaurant_ratings(order_id);

-- ---------------------------------------------------------------------------
-- 4. Exact-topic private Supabase Realtime authorization
-- ---------------------------------------------------------------------------
drop policy if exists trago_realtime_receive_exact_topic on realtime.messages;
create policy trago_realtime_receive_exact_topic
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and coalesce((select auth.jwt() ->> 'scope'), '') = 'trago_realtime'
  and coalesce((select auth.jwt() -> 'realtime' ->> 'topic'), '') = (select realtime.topic())
);
grant select on realtime.messages to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Atomic stock tracking and rollback
-- ---------------------------------------------------------------------------
create table if not exists public.order_stock_reservations (
  id text primary key default public.trago_generate_id(),
  order_id text not null references public.orders(id) on delete cascade,
  menu_item_id text not null references public.restaurant_menu_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null default 'active' check (status in ('active', 'released')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique(order_id, menu_item_id)
);
alter table public.order_stock_reservations enable row level security;
create index if not exists idx_order_stock_reservations_order_status
  on public.order_stock_reservations(order_id, status);

create or replace function public.trago_reserve_product_stock(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_item jsonb;
  requested_item_id text;
  requested_quantity integer;
  current_stock public.product_stock%rowtype;
  next_quantity integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Lista de stock inválida.' using errcode = '22023';
  end if;

  for requested_item in select value from jsonb_array_elements(p_items)
  loop
    requested_item_id := nullif(trim(requested_item->>'menu_item_id'), '');
    requested_quantity := greatest(1, coalesce((requested_item->>'quantity')::integer, 1));
    if requested_item_id is null then
      raise exception 'Produto inválido na reserva de stock.' using errcode = '22023';
    end if;

    select * into current_stock
    from public.product_stock
    where menu_item_id = requested_item_id
    for update;

    -- No row means unlimited / unmanaged stock.
    if not found then continue; end if;
    if current_stock.unavailable_until is not null and current_stock.unavailable_until > now() then
      raise exception 'Produto temporariamente indisponível: %', requested_item_id using errcode = 'P0001';
    end if;
    if current_stock.auto_disable and current_stock.quantity is not null and current_stock.quantity <= 0 then
      raise exception 'Produto esgotado: %', requested_item_id using errcode = 'P0001';
    end if;
    if current_stock.quantity is not null and current_stock.quantity < requested_quantity then
      raise exception 'Stock insuficiente para produto %. Disponível: %', requested_item_id, current_stock.quantity using errcode = 'P0001';
    end if;

    if current_stock.quantity is not null then
      next_quantity := greatest(0, current_stock.quantity - requested_quantity);
      update public.product_stock
      set quantity = next_quantity, updated_at = now()
      where id = current_stock.id;
      if current_stock.auto_disable and next_quantity <= 0 then
        update public.restaurant_menu_items
        set available = false, unavailable_reason = 'Esgotado', updated_at = now()
        where id = requested_item_id;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.trago_release_product_stock(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_item jsonb;
  requested_item_id text;
  requested_quantity integer;
  current_stock public.product_stock%rowtype;
  next_quantity integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Lista de stock inválida.' using errcode = '22023';
  end if;

  for requested_item in select value from jsonb_array_elements(p_items)
  loop
    requested_item_id := nullif(trim(requested_item->>'menu_item_id'), '');
    requested_quantity := greatest(1, coalesce((requested_item->>'quantity')::integer, 1));
    if requested_item_id is null then continue; end if;

    select * into current_stock
    from public.product_stock
    where menu_item_id = requested_item_id
    for update;
    if not found or current_stock.quantity is null then continue; end if;

    next_quantity := current_stock.quantity + requested_quantity;
    update public.product_stock
    set quantity = next_quantity, updated_at = now()
    where id = current_stock.id;

    if current_stock.auto_disable and next_quantity > 0 then
      update public.restaurant_menu_items
      set available = true,
          unavailable_reason = case when unavailable_reason = 'Esgotado' then '' else unavailable_reason end,
          updated_at = now()
      where id = requested_item_id;
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Atomic restaurant coupons
-- ---------------------------------------------------------------------------
create table if not exists public.restaurant_coupon_redemptions (
  id text primary key default public.trago_generate_id(),
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  order_id text not null references public.orders(id) on delete cascade,
  code text not null,
  discount_cents bigint not null default 0,
  status text not null default 'applied' check (status in ('applied', 'released')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique(restaurant_id, order_id)
);
alter table public.restaurant_coupon_redemptions enable row level security;
create index if not exists idx_restaurant_coupon_redemptions_order
  on public.restaurant_coupon_redemptions(order_id);

create or replace function public.trago_redeem_restaurant_coupon(
  p_restaurant_id text,
  p_code text,
  p_order_id text,
  p_subtotal_cents bigint,
  p_delivery_fee_cents bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant public.restaurants%rowtype;
  v_coupon jsonb;
  v_existing public.restaurant_coupon_redemptions%rowtype;
  v_code text := upper(regexp_replace(trim(coalesce(p_code, '')), '\s+', '', 'g'));
  v_type text;
  v_value numeric;
  v_min_cents bigint;
  v_limit integer;
  v_used integer;
  v_discount bigint := 0;
begin
  select * into v_existing
  from public.restaurant_coupon_redemptions
  where restaurant_id = p_restaurant_id and order_id = p_order_id and status = 'applied';
  if found then
    return jsonb_build_object('source','restaurant','code',v_existing.code,'discount_cents',v_existing.discount_cents,'idempotent',true);
  end if;

  select * into v_restaurant from public.restaurants where id = p_restaurant_id for update;
  if not found then raise exception 'Restaurante não encontrado'; end if;

  select value into v_coupon
  from jsonb_array_elements(coalesce(v_restaurant.coupons, '[]'::jsonb))
  where upper(regexp_replace(trim(coalesce(value->>'code','')), '\s+', '', 'g')) = v_code
  limit 1;

  if v_coupon is null or coalesce((v_coupon->>'active')::boolean, true) = false then
    raise exception 'Cupão inexistente ou inactivo';
  end if;
  if nullif(v_coupon->>'expires_at','') is not null and (v_coupon->>'expires_at')::timestamptz < now() then
    raise exception 'Cupão expirado';
  end if;

  v_min_cents := round(coalesce(nullif(v_coupon->>'min','')::numeric, 0) * 100)::bigint;
  if p_subtotal_cents < v_min_cents then raise exception 'Pedido mínimo do cupão não atingido'; end if;
  v_used := coalesce(nullif(v_coupon->>'used','')::integer, 0);
  v_limit := coalesce(nullif(v_coupon->>'limit','')::integer, 2147483647);
  if v_used >= v_limit then raise exception 'Limite total do cupão atingido'; end if;

  v_type := lower(coalesce(v_coupon->>'type','fixed'));
  v_value := coalesce(nullif(v_coupon->>'value','')::numeric, 0);
  if v_type = 'percentage' then
    v_discount := round(greatest(0,p_subtotal_cents) * least(100,v_value) / 100.0);
  elsif v_type = 'delivery' then
    v_discount := greatest(0,p_delivery_fee_cents);
  else
    v_discount := least(greatest(0,p_subtotal_cents), round(greatest(0,v_value) * 100)::bigint);
  end if;
  v_discount := least(greatest(0,p_subtotal_cents) + greatest(0,p_delivery_fee_cents), greatest(0,v_discount));

  update public.restaurants
  set coupons = (
    select coalesce(jsonb_agg(
      case
        when upper(regexp_replace(trim(coalesce(item->>'code','')), '\s+', '', 'g')) = v_code
          then jsonb_set(item, '{used}', to_jsonb(v_used + 1), true)
        else item
      end
    ), '[]'::jsonb)
    from jsonb_array_elements(coalesce(v_restaurant.coupons, '[]'::jsonb)) item
  ), updated_at = now()
  where id = p_restaurant_id;

  insert into public.restaurant_coupon_redemptions(restaurant_id, order_id, code, discount_cents, status)
  values(p_restaurant_id, p_order_id, v_code, v_discount, 'applied');

  return jsonb_build_object('source','restaurant','code',v_code,'discount_cents',v_discount,'idempotent',false);
end;
$$;

create or replace function public.trago_release_restaurant_coupon(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redemption public.restaurant_coupon_redemptions%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_code text;
begin
  select * into v_redemption
  from public.restaurant_coupon_redemptions
  where order_id = p_order_id and status = 'applied'
  for update;
  if not found then return jsonb_build_object('released',false); end if;

  select * into v_restaurant from public.restaurants where id = v_redemption.restaurant_id for update;
  v_code := upper(v_redemption.code);
  if found then
    update public.restaurants
    set coupons = (
      select coalesce(jsonb_agg(
        case
          when upper(regexp_replace(trim(coalesce(item->>'code','')), '\s+', '', 'g')) = v_code
            then jsonb_set(item, '{used}', to_jsonb(greatest(0, coalesce(nullif(item->>'used','')::integer,0)-1)), true)
          else item
        end
      ), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_restaurant.coupons, '[]'::jsonb)) item
    ), updated_at = now()
    where id = v_restaurant.id;
  end if;

  update public.restaurant_coupon_redemptions
  set status='released', released_at=now()
  where id=v_redemption.id;
  return jsonb_build_object('released',true,'discount_cents',v_redemption.discount_cents);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Idempotent postpaid reservation/release with consistent balances
-- ---------------------------------------------------------------------------
create or replace function public.trago_postpaid_reserve(p_client_id text, p_order_id text, p_amount_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_new_used_cents bigint;
begin
  if p_amount_cents <= 0 then raise exception 'Valor pós-pago inválido'; end if;
  if exists(select 1 from public.finance_audit_logs where action='postpaid_reserve' and entity_id=p_order_id) then
    select * into v_client from public.clients where id=p_client_id;
    return jsonb_build_object('idempotent',true,'credit_used_cents',round(v_client.credit_used*100)::bigint);
  end if;

  select * into v_client from public.clients where id=p_client_id for update;
  if not found then raise exception 'Cliente não encontrado'; end if;
  if v_client.billing_type <> 'postpaid' or v_client.postpaid_blocked then raise exception 'Cliente sem autorização pós-pago'; end if;
  v_new_used_cents := round(v_client.credit_used*100)::bigint + p_amount_cents;
  if v_new_used_cents > round(v_client.credit_limit*100)::bigint then raise exception 'Limite pós-pago insuficiente'; end if;

  update public.clients
  set credit_used=v_new_used_cents/100.0,
      credit_balance=greatest(0,(round(credit_limit*100)::bigint-v_new_used_cents)/100.0),
      postpaid_due_cents=postpaid_due_cents+p_amount_cents,
      updated_at=now()
  where id=p_client_id;

  insert into public.finance_audit_logs(actor_type,actor_id,action,entity_type,entity_id,amount_cents,payload)
  values('client',p_client_id,'postpaid_reserve','order',p_order_id,p_amount_cents,jsonb_build_object('reference','postpaid:'||p_order_id));
  return jsonb_build_object('idempotent',false,'reserved_cents',p_amount_cents);
end;
$$;

create or replace function public.trago_postpaid_release(p_client_id text, p_order_id text, p_amount_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_new_used_cents bigint;
begin
  if exists(select 1 from public.finance_audit_logs where action='postpaid_release' and entity_id=p_order_id) then
    return jsonb_build_object('idempotent',true,'released_cents',0);
  end if;
  select * into v_client from public.clients where id=p_client_id for update;
  if not found then return jsonb_build_object('released_cents',0); end if;
  v_new_used_cents := greatest(0,round(v_client.credit_used*100)::bigint-p_amount_cents);
  update public.clients
  set credit_used=v_new_used_cents/100.0,
      credit_balance=greatest(0,(round(credit_limit*100)::bigint-v_new_used_cents)/100.0),
      postpaid_due_cents=greatest(0,postpaid_due_cents-p_amount_cents),
      updated_at=now()
  where id=p_client_id;
  insert into public.finance_audit_logs(actor_type,actor_id,action,entity_type,entity_id,amount_cents)
  values('system',p_client_id,'postpaid_release','order',p_order_id,p_amount_cents);
  return jsonb_build_object('released_cents',p_amount_cents);
end;
$$;

-- Postpaid reservation runs inside the order INSERT transaction.
create or replace function public.trago_reserve_postpaid_on_order_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_method = 'postpaid_credit' and new.client is not null then
    perform public.trago_postpaid_reserve(
      new.client,
      new.id,
      round(greatest(0,coalesce(new.price,0))*100)::bigint
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_postpaid_reserve on public.orders;
create trigger trg_orders_postpaid_reserve
after insert on public.orders
for each row execute function public.trago_reserve_postpaid_on_order_insert();

-- ---------------------------------------------------------------------------
-- 8. One atomic finalizer for stock + coupon + order totals
-- ---------------------------------------------------------------------------
create or replace function public.trago_finalize_public_order(
  p_order_id text,
  p_stock_items jsonb default '[]'::jsonb,
  p_coupon_source text default '',
  p_coupon_code text default '',
  p_client_id text default null,
  p_restaurant_id text default null,
  p_subtotal_cents bigint default 0,
  p_delivery_fee_cents bigint default 0,
  p_category_ids jsonb default '[]'::jsonb,
  p_zone text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_coupon jsonb := null;
  v_discount_cents bigint := 0;
  v_first_order boolean := false;
  v_stock_items jsonb := coalesce(p_stock_items, '[]'::jsonb);
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;

  if jsonb_typeof(v_stock_items) <> 'array' then raise exception 'Lista de stock inválida'; end if;
  if jsonb_array_length(v_stock_items) > 0
     and not exists(select 1 from public.order_stock_reservations where order_id=p_order_id and status='active') then
    perform public.trago_reserve_product_stock(v_stock_items);
    insert into public.order_stock_reservations(order_id,menu_item_id,quantity,status)
    select p_order_id,
           nullif(trim(item->>'menu_item_id'),''),
           greatest(1,coalesce((item->>'quantity')::integer,1)),
           'active'
    from jsonb_array_elements(v_stock_items) item
    where nullif(trim(item->>'menu_item_id'),'') is not null
    on conflict(order_id,menu_item_id) do update
      set quantity=excluded.quantity,status='active',released_at=null;
  end if;

  if coalesce(trim(p_coupon_code),'') <> '' then
    if p_coupon_source = 'restaurant' then
      v_coupon := public.trago_redeem_restaurant_coupon(
        p_restaurant_id, p_coupon_code, p_order_id, p_subtotal_cents, p_delivery_fee_cents
      );
    else
      if p_client_id is null then raise exception 'Cliente autenticado obrigatório para cupão financeiro'; end if;
      select jsonb_build_object(
        'source','finance','code',c.code,'discount_cents',cr.discount_cents,'idempotent',true
      ) into v_coupon
      from public.coupon_redemptions cr
      join public.finance_coupons c on c.id=cr.coupon_id
      where cr.order_id=p_order_id and cr.status in ('reserved','applied')
      limit 1;
      if v_coupon is null then
        select not exists(
          select 1 from public.orders
          where client=p_client_id and id<>p_order_id and status<>'cancelado'
        ) into v_first_order;
        v_coupon := public.trago_redeem_finance_coupon(
          p_coupon_code,p_client_id,p_order_id,p_restaurant_id,
          p_subtotal_cents,p_delivery_fee_cents,v_first_order,
          coalesce(p_category_ids,'[]'::jsonb),coalesce(p_zone,'')
        );
      end if;
    end if;
    v_discount_cents := coalesce((v_coupon->>'discount_cents')::bigint,0);
  end if;

  update public.orders
  set price = greatest(0,(greatest(0,p_subtotal_cents)+greatest(0,p_delivery_fee_cents)-greatest(0,v_discount_cents))/100.0),
      coupon_code = case when coalesce(trim(p_coupon_code),'')='' then '' else upper(trim(p_coupon_code)) end,
      coupon_discount = greatest(0,v_discount_cents)/100.0,
      updated_at = now()
  where id=p_order_id
  returning * into v_order;

  return jsonb_build_object('order',to_jsonb(v_order),'coupon',v_coupon,'stock_reserved',jsonb_array_length(v_stock_items)>0);
end;
$$;

-- Public order creation and stock/coupon finalization share one transaction.
create or replace function public.trago_create_public_order(
  p_order jsonb,
  p_stock_items jsonb default '[]'::jsonb,
  p_coupon_source text default '',
  p_coupon_code text default '',
  p_client_id text default null,
  p_restaurant_id text default null,
  p_subtotal_cents bigint default 0,
  p_delivery_fee_cents bigint default 0,
  p_category_ids jsonb default '[]'::jsonb,
  p_zone text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_order public.orders%rowtype;
  v_result jsonb;
begin
  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    raise exception 'Dados do pedido inválidos';
  end if;

  v_payload := jsonb_build_object(
    'id', public.trago_generate_id(),
    'price', 0,
    'status', 'pendente',
    'valor_motorista', 0,
    'valor_empresa', 0,
    'payment_method', 'cash',
    'created_at', now(),
    'updated_at', now(),
    'service_price', 0,
    'delivery_fee', 0,
    'payment_status', 'nao_pago',
    'failure_reason', '',
    'delivery_code_attempts', 0,
    'cargo_category', '',
    'cargo_description', '',
    'food_items', '[]'::jsonb,
    'food_subtotal', 0,
    'coupon_code', '',
    'coupon_discount', 0,
    'payment_reference', '',
    'payment_proof_url', '',
    'payment_failure_reason', '',
    'payment_refunded_amount', 0,
    'wallet_debit_amount', 0,
    'cashback_amount', 0,
    'invoice_number', '',
    'route_stops', '[]'::jsonb,
    'delivery_proof_url', '',
    'driver_offer_rejected_ids', '[]'::jsonb,
    'purchase_source_label', '',
    'requested_product', '',
    'client_notes', ''
  ) || p_order;

  v_order := jsonb_populate_record(null::public.orders, v_payload);
  if coalesce(trim(v_order.service_type),'')='' or coalesce(trim(v_order.client_name),'')=''
     or coalesce(trim(v_order.client_phone1),'')='' or coalesce(trim(v_order.verification_code),'')='' then
    raise exception 'Campos obrigatórios do pedido em falta';
  end if;

  insert into public.orders select (v_order).* returning * into v_order;
  v_result := public.trago_finalize_public_order(
    v_order.id, coalesce(p_stock_items,'[]'::jsonb), coalesce(p_coupon_source,''),
    coalesce(p_coupon_code,''), p_client_id, p_restaurant_id,
    greatest(0,p_subtotal_cents), greatest(0,p_delivery_fee_cents),
    coalesce(p_category_ids,'[]'::jsonb), coalesce(p_zone,'')
  );
  return v_result;
end;
$$;

create or replace function public.trago_rollback_public_order(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_stock_items jsonb;
  v_postpaid_cents bigint;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then return jsonb_build_object('rolled_back',false,'reason','order_not_found'); end if;

  select jsonb_agg(jsonb_build_object('menu_item_id',menu_item_id,'quantity',quantity))
  into v_stock_items
  from public.order_stock_reservations
  where order_id=p_order_id and status='active';

  if v_stock_items is not null then
    perform public.trago_release_product_stock(v_stock_items);
    update public.order_stock_reservations
    set status='released',released_at=now()
    where order_id=p_order_id and status='active';
  end if;

  perform public.trago_release_coupon_redemption(p_order_id);
  perform public.trago_release_restaurant_coupon(p_order_id);

  select amount_cents into v_postpaid_cents
  from public.finance_audit_logs
  where action='postpaid_reserve' and entity_id=p_order_id
  order by created_at desc limit 1;
  if v_postpaid_cents is not null and v_order.client is not null then
    perform public.trago_postpaid_release(v_order.client,p_order_id,v_postpaid_cents);
  end if;

  return jsonb_build_object('rolled_back',true);
end;
$$;

-- Atomic cancellation: order state and all reservations roll back together.
create or replace function public.trago_cancel_order(
  p_order_id text,
  p_reason text,
  p_cancelled_by text default null,
  p_restaurant_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_stock_items jsonb;
  v_postpaid_cents bigint;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_order.status in ('concluido','cancelado') then raise exception 'Pedido já encerrado'; end if;

  select jsonb_agg(jsonb_build_object('menu_item_id',menu_item_id,'quantity',quantity))
  into v_stock_items
  from public.order_stock_reservations
  where order_id=p_order_id and status='active';

  if v_stock_items is not null then
    perform public.trago_release_product_stock(v_stock_items);
    update public.order_stock_reservations
    set status='released',released_at=now()
    where order_id=p_order_id and status='active';
  end if;

  perform public.trago_release_coupon_redemption(p_order_id);
  perform public.trago_release_restaurant_coupon(p_order_id);

  select amount_cents into v_postpaid_cents
  from public.finance_audit_logs
  where action='postpaid_reserve' and entity_id=p_order_id
  order by created_at desc limit 1;
  if v_postpaid_cents is not null and v_order.client is not null then
    perform public.trago_postpaid_release(v_order.client,p_order_id,v_postpaid_cents);
  end if;

  update public.orders
  set status='cancelado',
      cancelled_at=now(),
      cancelled_by=p_cancelled_by,
      cancel_reason=left(coalesce(nullif(trim(p_reason),''),'Cancelado'),500),
      restaurant_status=coalesce(nullif(trim(p_restaurant_status),''),restaurant_status),
      offered_to_driver=null,
      driver_offer_status=null,
      driver_offer_expires_at=null,
      updated_at=now()
  where id=p_order_id
  returning * into v_order;

  return to_jsonb(v_order);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Atomic product-option replacement
-- ---------------------------------------------------------------------------
create or replace function public.trago_replace_product_options(p_item_id text, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group jsonb;
  v_name text;
  v_values jsonb;
  v_count integer := 0;
begin
  if not exists(select 1 from public.restaurant_menu_items where id=p_item_id) then
    raise exception 'Produto não encontrado';
  end if;
  if p_options is null or jsonb_typeof(p_options)<>'array' then
    raise exception 'Opções inválidas';
  end if;

  delete from public.product_options where menu_item_id=p_item_id;
  for v_group in select value from jsonb_array_elements(p_options)
  loop
    v_name := left(trim(coalesce(v_group->>'name','')),80);
    v_values := coalesce(v_group->'values','[]'::jsonb);
    if v_name='' or jsonb_typeof(v_values)<>'array' or jsonb_array_length(v_values)=0 then continue; end if;
    insert into public.product_options(
      id,menu_item_id,name,required,min_select,max_select,values,created_at,updated_at
    ) values(
      coalesce(nullif(v_group->>'id',''),public.trago_generate_id()),
      p_item_id,v_name,coalesce((v_group->>'required')::boolean,false),
      greatest(0,coalesce((v_group->>'min_select')::integer,0)),
      greatest(1,coalesce((v_group->>'max_select')::integer,1)),
      v_values,now(),now()
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('ok',true,'groups',v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Database-backed rate limiting for public/sensitive endpoints
-- ---------------------------------------------------------------------------
create table if not exists public.api_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null default now(),
  hits integer not null default 0 check (hits >= 0),
  updated_at timestamptz not null default now()
);
alter table public.api_rate_limits enable row level security;

create or replace function public.trago_check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.api_rate_limits%rowtype;
  v_now timestamptz := now();
  v_reset timestamptz;
begin
  if coalesce(trim(p_key),'')='' or p_limit<1 or p_window_seconds<1 then
    raise exception 'Configuração de rate limit inválida';
  end if;

  insert into public.api_rate_limits(bucket_key,window_started_at,hits,updated_at)
  values(p_key,v_now,0,v_now)
  on conflict(bucket_key) do nothing;

  select * into v_row from public.api_rate_limits where bucket_key=p_key for update;
  v_reset := v_row.window_started_at + make_interval(secs=>p_window_seconds);
  if v_reset <= v_now then
    update public.api_rate_limits
    set window_started_at=v_now,hits=1,updated_at=v_now
    where bucket_key=p_key;
    return jsonb_build_object('allowed',true,'remaining',p_limit-1,'reset_at',(v_now+make_interval(secs=>p_window_seconds)));
  end if;
  if v_row.hits >= p_limit then
    return jsonb_build_object('allowed',false,'remaining',0,'reset_at',v_reset);
  end if;

  update public.api_rate_limits set hits=hits+1,updated_at=v_now where bucket_key=p_key;
  return jsonb_build_object('allowed',true,'remaining',greatest(0,p_limit-v_row.hits-1),'reset_at',v_reset);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Missing FK indexes and duplicate-index cleanup
-- ---------------------------------------------------------------------------
create index if not exists idx_cashback_entries_client_id on public.cashback_entries(client_id);
create index if not exists idx_cashback_entries_rule_id on public.cashback_entries(rule_id);
create index if not exists idx_cashback_entries_wallet_transaction_id on public.cashback_entries(wallet_transaction_id);
create index if not exists idx_client_notifications_order_id on public.client_notifications(order_id);
create index if not exists idx_client_referrals_qualifying_order_id on public.client_referrals(qualifying_order_id);
create index if not exists idx_client_reviews_client_id on public.client_reviews(client_id);
create index if not exists idx_clients_created_by_admin on public.clients(created_by_admin);
create index if not exists idx_clients_referred_by_client_id on public.clients(referred_by_client_id);
create index if not exists idx_company_costs_assigned_client on public.company_costs(assigned_client);
create index if not exists idx_company_costs_assigned_user on public.company_costs(assigned_user);
create index if not exists idx_company_costs_created_by on public.company_costs(created_by);
create index if not exists idx_coupon_redemptions_order_id on public.coupon_redemptions(order_id);
create index if not exists idx_coupon_usages_order_id on public.coupon_usages(order_id);
create index if not exists idx_expenses_created_by on public.expenses(created_by);
create index if not exists idx_expenses_employee on public.expenses(employee);
create index if not exists idx_invoices_client_id on public.invoices(client_id);
create index if not exists idx_order_messages_conversation_id on public.order_messages(conversation_id);
create index if not exists idx_orders_cancelled_by on public.orders(cancelled_by);
create index if not exists idx_orders_created_by_admin on public.orders(created_by_admin);
create index if not exists idx_payment_proofs_client_id on public.payment_proofs(client_id);
create index if not exists idx_payment_proofs_order_id on public.payment_proofs(order_id);
create index if not exists idx_payment_proofs_payment_transaction_id on public.payment_proofs(payment_transaction_id);
create index if not exists idx_refunds_client_id on public.refunds(client_id);
create index if not exists idx_refunds_order_id on public.refunds(order_id);
create index if not exists idx_refunds_payment_transaction_id on public.refunds(payment_transaction_id);
create index if not exists idx_support_threads_assigned_admin_id on public.support_threads(assigned_admin_id);
create index if not exists idx_trago_partners_reviewed_by on public.trago_partners(reviewed_by);
create index if not exists idx_trips_order_id on public.trips(order_id);
create index if not exists idx_vehicles_created_by on public.vehicles(created_by);

drop index if exists public.idx_client_notifications_client_created;
drop index if exists public.idx_orders_driver_offer_pending;

-- ---------------------------------------------------------------------------
-- 12. Keep operational images private
-- ---------------------------------------------------------------------------
update storage.buckets set public=false where id='order-images';

-- Existing public references become private storage references.
update public.orders
set image_url = 'private-order:' || split_part(image_url, '/order-images/', 2),
    updated_at = now()
where image_url like '%/storage/v1/object/public/order-images/%';

-- Explicit deny-all policies document the Edge-only data-access architecture.
do $$
declare
  v_table record;
begin
  for v_table in
    select tablename from pg_tables where schemaname='public'
  loop
    execute format('alter table public.%I enable row level security', v_table.tablename);
    execute format('drop policy if exists trago_edge_only_deny_all on public.%I', v_table.tablename);
    execute format(
      'create policy trago_edge_only_deny_all on public.%I for all to anon, authenticated using (false) with check (false)',
      v_table.tablename
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 13. Browser roles do not access private tables directly; Edge service role does
-- ---------------------------------------------------------------------------
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Explicitly lock internal RPCs to service_role.
revoke all on function public.trago_postpaid_reserve(text,text,bigint) from public, anon, authenticated;
revoke all on function public.trago_postpaid_release(text,text,bigint) from public, anon, authenticated;
revoke all on function public.trago_reserve_postpaid_on_order_insert() from public, anon, authenticated;
revoke all on function public.trago_reserve_product_stock(jsonb) from public, anon, authenticated;
revoke all on function public.trago_release_product_stock(jsonb) from public, anon, authenticated;
revoke all on function public.trago_redeem_restaurant_coupon(text,text,text,bigint,bigint) from public, anon, authenticated;
revoke all on function public.trago_release_restaurant_coupon(text) from public, anon, authenticated;
revoke all on function public.trago_finalize_public_order(text,jsonb,text,text,text,text,bigint,bigint,jsonb,text) from public, anon, authenticated;
revoke all on function public.trago_create_public_order(jsonb,jsonb,text,text,text,text,bigint,bigint,jsonb,text) from public, anon, authenticated;
revoke all on function public.trago_rollback_public_order(text) from public, anon, authenticated;
revoke all on function public.trago_cancel_order(text,text,text,text) from public, anon, authenticated;
revoke all on function public.trago_replace_product_options(text,jsonb) from public, anon, authenticated;
revoke all on function public.trago_check_rate_limit(text,integer,integer) from public, anon, authenticated;

grant execute on function public.trago_postpaid_reserve(text,text,bigint) to service_role;
grant execute on function public.trago_postpaid_release(text,text,bigint) to service_role;
grant execute on function public.trago_reserve_postpaid_on_order_insert() to service_role;
grant execute on function public.trago_reserve_product_stock(jsonb) to service_role;
grant execute on function public.trago_release_product_stock(jsonb) to service_role;
grant execute on function public.trago_redeem_restaurant_coupon(text,text,text,bigint,bigint) to service_role;
grant execute on function public.trago_release_restaurant_coupon(text) to service_role;
grant execute on function public.trago_finalize_public_order(text,jsonb,text,text,text,text,bigint,bigint,jsonb,text) to service_role;
grant execute on function public.trago_create_public_order(jsonb,jsonb,text,text,text,text,bigint,bigint,jsonb,text) to service_role;
grant execute on function public.trago_rollback_public_order(text) to service_role;
grant execute on function public.trago_cancel_order(text,text,text,text) to service_role;
grant execute on function public.trago_replace_product_options(text,jsonb) to service_role;
grant execute on function public.trago_check_rate_limit(text,integer,integer) to service_role;

commit;
