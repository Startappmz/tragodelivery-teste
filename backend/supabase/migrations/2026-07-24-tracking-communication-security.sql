-- TraGo Delivery · rastreio, ofertas atómicas e canais privados por pedido.
--
-- Mantém as colunas antigas de orders/driver_profiles para compatibilidade,
-- mas torna driver_presence e driver_offers as fontes operacionais do radar.

begin;

create table if not exists public.conversations (
  id text primary key default public.trago_generate_id(),
  order_id text references public.orders(id) on delete cascade,
  scope text not null default 'order',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

alter table public.orders
  add column if not exists client_notes text not null default '',
  add column if not exists partner_confirmed_at timestamptz,
  add column if not exists partner_confirmed_by text,
  add column if not exists pickup_authorized_at timestamptz,
  add column if not exists pickup_authorized_by text,
  add column if not exists offered_to_driver text references public.driver_profiles(id) on delete set null,
  add column if not exists driver_offer_status text,
  add column if not exists driver_offer_expires_at timestamptz,
  add column if not exists driver_offer_rejected_ids jsonb not null default '[]'::jsonb,
  add column if not exists driver_assigned_at timestamptz,
  add column if not exists last_status_at timestamptz;

alter table public.orders drop constraint if exists orders_driver_offer_status_check;
alter table public.orders add constraint orders_driver_offer_status_check
  check (
    driver_offer_status is null
    or driver_offer_status in ('pending', 'accepted', 'rejected', 'expired')
  );

create index if not exists idx_orders_driver_offer
  on public.orders(offered_to_driver, driver_offer_status, driver_offer_expires_at)
  where offered_to_driver is not null;

alter table public.conversations
  add column if not exists channel_type text,
  add column if not exists closed_at timestamptz;

update public.conversations
set channel_type = case
  when scope = 'restaurant' then 'driver_partner'
  when scope = 'support' then 'support'
  else 'client_driver'
end
where channel_type is null;

alter table public.conversations
  alter column channel_type set default 'client_driver',
  alter column channel_type set not null;

alter table public.conversations drop constraint if exists conversations_channel_type_check;
alter table public.conversations add constraint conversations_channel_type_check
  check (channel_type in ('client_driver', 'driver_partner', 'system', 'support'));

create unique index if not exists idx_conversations_order_channel
  on public.conversations(order_id, channel_type)
  where order_id is not null;

insert into public.conversations(order_id, scope, channel_type)
select o.id, 'order', channel.channel_type
from public.orders o
cross join (values ('client_driver'), ('driver_partner'), ('system')) as channel(channel_type)
where not exists (
  select 1
  from public.conversations c
  where c.order_id = o.id
    and c.channel_type = channel.channel_type
);

alter table public.order_messages
  add column if not exists conversation_id text references public.conversations(id) on delete set null,
  add column if not exists channel_type text,
  add column if not exists visible_to_roles text[];

update public.order_messages
set channel_type = case
  when sender_role = 'client' then 'client_driver'
  when sender_role = 'driver' then 'client_driver'
  when sender_role = 'restaurant' and message_type = 'text' then 'driver_partner'
  when sender_role = 'restaurant' then 'system'
  else 'system'
end
where channel_type is null;

update public.order_messages
set visible_to_roles = case
  when sender_role = 'driver' and message_type = 'text' then array['driver', 'admin']::text[]
  when channel_type = 'client_driver' then array['client', 'driver', 'admin']::text[]
  when channel_type = 'driver_partner' then array['driver', 'restaurant', 'admin']::text[]
  else array['client', 'driver', 'restaurant', 'admin']::text[]
end
where visible_to_roles is null;

update public.order_messages m
set conversation_id = c.id
from public.conversations c
where c.order_id = m.order_id
  and c.channel_type = m.channel_type
  and m.conversation_id is null;

alter table public.order_messages
  alter column channel_type set default 'system',
  alter column channel_type set not null,
  alter column visible_to_roles set default array['client', 'driver', 'restaurant', 'admin']::text[],
  alter column visible_to_roles set not null;

alter table public.order_messages drop constraint if exists order_messages_channel_type_check;
alter table public.order_messages add constraint order_messages_channel_type_check
  check (channel_type in ('client_driver', 'driver_partner', 'system', 'support'));

create index if not exists idx_order_messages_channel_created
  on public.order_messages(order_id, channel_type, created_at);
create index if not exists idx_order_messages_visible_roles
  on public.order_messages using gin(visible_to_roles);

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

insert into public.driver_presence(
  driver_profile_id,
  is_online,
  is_available,
  current_order_id,
  latitude,
  longitude,
  accuracy,
  speed,
  last_seen_at,
  location_updated_at
)
select
  p.id,
  p.status <> 'offline',
  p.status = 'online_livre',
  (
    select o.id
    from public.orders o
    where o.assigned_to_driver = p.id
      and o.status in ('atribuido', 'em_progresso', 'recolha_em_progresso', 'recolha_concluida', 'entrega_em_progresso')
    order by o.created_at desc
    limit 1
  ),
  case when (p.last_location ->> 'lat') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.last_location ->> 'lat')::numeric end,
  case when (p.last_location ->> 'lng') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.last_location ->> 'lng')::numeric end,
  case when (p.last_location ->> 'accuracy') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.last_location ->> 'accuracy')::numeric end,
  case when (p.last_location ->> 'speed') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.last_location ->> 'speed')::numeric end,
  coalesce(
    nullif(p.last_location ->> 'updatedAt', '')::timestamptz,
    nullif(p.last_location ->> 'updated_at', '')::timestamptz,
    p.updated_at
  ),
  coalesce(
    nullif(p.last_location ->> 'updatedAt', '')::timestamptz,
    nullif(p.last_location ->> 'updated_at', '')::timestamptz,
    p.updated_at
  )
from public.driver_profiles p
on conflict (driver_profile_id) do nothing;

create index if not exists idx_driver_presence_radar
  on public.driver_presence(is_online, is_available, last_seen_at desc, location_updated_at desc);
create index if not exists idx_driver_presence_current_order
  on public.driver_presence(current_order_id)
  where current_order_id is not null;

create table if not exists public.driver_offers (
  id text primary key default public.trago_generate_id(),
  order_id text not null references public.orders(id) on delete cascade,
  driver_profile_id text not null references public.driver_profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  selected_by_role text not null
    check (selected_by_role in ('client', 'admin', 'system')),
  selected_by_id text,
  rejection_reason text,
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_driver_offers_one_pending_order
  on public.driver_offers(order_id)
  where status = 'pending';
create unique index if not exists idx_driver_offers_one_pending_driver
  on public.driver_offers(driver_profile_id)
  where status = 'pending';
create index if not exists idx_driver_offers_driver_status
  on public.driver_offers(driver_profile_id, status, expires_at desc);

create or replace function public.trago_ensure_order_conversations(p_order_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.conversations(order_id, scope, channel_type)
  select p_order_id, 'order', channel_type
  from (values ('client_driver'), ('driver_partner'), ('system')) as channels(channel_type)
  on conflict (order_id, channel_type) where order_id is not null do nothing;
end;
$$;

create or replace function public.trago_order_conversations_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.trago_ensure_order_conversations(new.id);
  return new;
end;
$$;

drop trigger if exists trg_orders_ensure_conversations on public.orders;
create trigger trg_orders_ensure_conversations
after insert on public.orders
for each row execute function public.trago_order_conversations_trigger();

create or replace function public.trago_expire_driver_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count integer := 0;
begin
  with expired as (
    update public.driver_offers
    set status = 'expired', responded_at = now(), updated_at = now()
    where status = 'pending' and expires_at <= now()
    returning order_id, driver_profile_id
  ),
  reset_presence as (
    update public.driver_presence p
    set is_available = p.is_online and p.current_order_id is null,
        updated_at = now(),
        version = p.version + 1
    from expired e
    where p.driver_profile_id = e.driver_profile_id
    returning p.driver_profile_id
  ),
  reset_order as (
    update public.orders o
    set offered_to_driver = null,
        driver_offer_status = 'expired',
        driver_offer_expires_at = null,
        updated_at = now()
    from expired e
    where o.id = e.order_id
      and o.assigned_to_driver is null
    returning o.id
  )
  select count(*) into expired_count from expired;
  return expired_count;
end;
$$;

create or replace function public.trago_create_driver_offer(
  p_order_id text,
  p_driver_profile_id text,
  p_selected_by_role text,
  p_selected_by_id text,
  p_expires_at timestamptz
)
returns public.driver_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders%rowtype;
  target_presence public.driver_presence%rowtype;
  created_offer public.driver_offers%rowtype;
begin
  perform public.trago_expire_driver_offers();

  select * into target_order
  from public.orders
  where id = p_order_id
  for update;

  if target_order.id is null then
    raise exception 'Pedido não encontrado.';
  end if;
  if target_order.status <> 'pendente' or target_order.assigned_to_driver is not null then
    raise exception 'Este pedido já não está disponível para escolher motorista.';
  end if;
  if exists (
    select 1 from public.driver_offers
    where order_id = p_order_id and status = 'pending'
  ) then
    raise exception 'Já existe uma oferta activa para este pedido.';
  end if;

  select * into target_presence
  from public.driver_presence
  where driver_profile_id = p_driver_profile_id
  for update;

  if target_presence.driver_profile_id is null
     or not target_presence.is_online
     or not target_presence.is_available
     or target_presence.current_order_id is not null
     or target_presence.last_seen_at < now() - interval '60 seconds'
     or target_presence.location_updated_at < now() - interval '10 minutes' then
    raise exception 'O motorista já não está online, livre ou com localização actual.';
  end if;

  insert into public.driver_offers(
    order_id, driver_profile_id, selected_by_role, selected_by_id, expires_at
  ) values (
    p_order_id,
    p_driver_profile_id,
    p_selected_by_role,
    p_selected_by_id,
    greatest(p_expires_at, now() + interval '15 seconds')
  )
  returning * into created_offer;

  update public.driver_presence
  set is_available = false,
      updated_at = now(),
      version = version + 1
  where driver_profile_id = p_driver_profile_id;

  update public.orders
  set offered_to_driver = p_driver_profile_id,
      driver_offer_status = 'pending',
      driver_offer_expires_at = created_offer.expires_at,
      updated_at = now()
  where id = p_order_id;

  insert into public.audit_logs(actor_role, actor_id, action, entity_type, entity_id, payload)
  values (
    p_selected_by_role,
    p_selected_by_id,
    'driver_offer_created',
    'order',
    p_order_id,
    jsonb_build_object('offer_id', created_offer.id, 'driver_profile_id', p_driver_profile_id)
  );

  return created_offer;
end;
$$;

create or replace function public.trago_respond_driver_offer(
  p_offer_id text,
  p_driver_profile_id text,
  p_accept boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_offer public.driver_offers%rowtype;
  target_order public.orders%rowtype;
  target_presence public.driver_presence%rowtype;
  rejected_ids jsonb;
begin
  select * into target_offer
  from public.driver_offers
  where id = p_offer_id
  for update;

  if target_offer.id is null
     or target_offer.driver_profile_id <> p_driver_profile_id
     or target_offer.status <> 'pending' then
    raise exception 'Esta oferta já não está disponível para si.';
  end if;

  select * into target_order
  from public.orders
  where id = target_offer.order_id
  for update;

  select * into target_presence
  from public.driver_presence
  where driver_profile_id = p_driver_profile_id
  for update;

  if target_offer.expires_at <= now() then
    update public.driver_offers
    set status = 'expired', responded_at = now(), updated_at = now()
    where id = p_offer_id;
    update public.driver_presence
    set is_available = is_online and current_order_id is null,
        updated_at = now(),
        version = version + 1
    where driver_profile_id = p_driver_profile_id;
    update public.orders
    set offered_to_driver = null,
        driver_offer_status = 'expired',
        driver_offer_expires_at = null,
        updated_at = now()
    where id = target_offer.order_id and assigned_to_driver is null;
    return jsonb_build_object('outcome', 'expired', 'order_id', target_offer.order_id);
  end if;

  if not p_accept then
    update public.driver_offers
    set status = 'rejected',
        rejection_reason = nullif(left(coalesce(p_reason, ''), 500), ''),
        responded_at = now(),
        updated_at = now()
    where id = p_offer_id;
    update public.driver_presence
    set is_available = is_online and current_order_id is null,
        updated_at = now(),
        version = version + 1
    where driver_profile_id = p_driver_profile_id;
    rejected_ids := coalesce(target_order.driver_offer_rejected_ids, '[]'::jsonb);
    if not rejected_ids @> jsonb_build_array(p_driver_profile_id) then
      rejected_ids := rejected_ids || jsonb_build_array(p_driver_profile_id);
    end if;
    update public.orders
    set offered_to_driver = null,
        driver_offer_status = 'rejected',
        driver_offer_expires_at = null,
        driver_offer_rejected_ids = rejected_ids,
        updated_at = now()
    where id = target_offer.order_id;
    insert into public.audit_logs(actor_role, actor_id, action, entity_type, entity_id, payload)
    values ('driver', p_driver_profile_id, 'driver_offer_rejected', 'order', target_offer.order_id, jsonb_build_object('offer_id', p_offer_id));
    return jsonb_build_object('outcome', 'rejected', 'order_id', target_offer.order_id);
  end if;

  if target_order.status <> 'pendente'
     or target_order.assigned_to_driver is not null
     or not target_presence.is_online
     or target_presence.current_order_id is not null then
    raise exception 'Este pedido já foi aceite ou o motorista deixou de estar disponível.';
  end if;

  update public.driver_offers
  set status = 'accepted', responded_at = now(), updated_at = now()
  where id = p_offer_id;

  update public.driver_offers
  set status = 'cancelled', responded_at = now(), updated_at = now()
  where order_id = target_offer.order_id
    and id <> p_offer_id
    and status = 'pending';

  update public.orders
  set assigned_to_driver = p_driver_profile_id,
      offered_to_driver = null,
      driver_offer_status = 'accepted',
      driver_offer_expires_at = null,
      status = 'atribuido',
      driver_assigned_at = coalesce(driver_assigned_at, now()),
      last_status_at = now(),
      updated_at = now()
  where id = target_offer.order_id;

  update public.driver_presence
  set is_available = false,
      current_order_id = target_offer.order_id,
      updated_at = now(),
      version = version + 1
  where driver_profile_id = p_driver_profile_id;

  update public.driver_profiles
  set status = 'online_ocupado', updated_at = now()
  where id = p_driver_profile_id;

  insert into public.order_status_events(order_id, status, label, actor_type, actor_id, actor_name, metadata)
  values (
    target_offer.order_id,
    'atribuido',
    'Pedido confirmado',
    'driver',
    p_driver_profile_id,
    'Motorista',
    jsonb_build_object('offer_id', p_offer_id)
  );
  insert into public.audit_logs(actor_role, actor_id, action, entity_type, entity_id, payload)
  values ('driver', p_driver_profile_id, 'driver_offer_accepted', 'order', target_offer.order_id, jsonb_build_object('offer_id', p_offer_id));

  return jsonb_build_object('outcome', 'accepted', 'order_id', target_offer.order_id);
end;
$$;

create or replace function public.trago_order_status_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.audit_logs(actor_role, actor_id, action, entity_type, entity_id, payload)
    values (
      'system',
      null,
      'order_status_changed',
      'order',
      new.id,
      jsonb_build_object('previous_status', old.status, 'new_status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_status_audit on public.orders;
create trigger trg_orders_status_audit
after update of status on public.orders
for each row execute function public.trago_order_status_audit_trigger();

drop trigger if exists trg_driver_presence_updated_at on public.driver_presence;
create trigger trg_driver_presence_updated_at
before update on public.driver_presence
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_driver_offers_updated_at on public.driver_offers;
create trigger trg_driver_offers_updated_at
before update on public.driver_offers
for each row execute function public.trago_touch_updated_at();

alter table public.driver_presence enable row level security;
alter table public.driver_offers enable row level security;
alter table public.conversations enable row level security;
alter table public.order_messages enable row level security;
alter table public.audit_logs enable row level security;
alter table public.order_status_events enable row level security;

revoke all on public.driver_presence from anon, authenticated;
revoke all on public.driver_offers from anon, authenticated;
revoke all on public.conversations from anon, authenticated;
revoke all on public.order_messages from anon, authenticated;
revoke all on public.audit_logs from anon, authenticated;
revoke all on public.order_status_events from anon, authenticated;

grant all on public.driver_presence to service_role;
grant all on public.driver_offers to service_role;
grant all on public.conversations to service_role;
grant all on public.order_messages to service_role;
grant all on public.audit_logs to service_role;
grant all on public.order_status_events to service_role;

revoke all on function public.trago_ensure_order_conversations(text) from public, anon, authenticated;
revoke all on function public.trago_expire_driver_offers() from public, anon, authenticated;
revoke all on function public.trago_create_driver_offer(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.trago_respond_driver_offer(text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.trago_order_conversations_trigger() from public, anon, authenticated;
revoke all on function public.trago_order_status_audit_trigger() from public, anon, authenticated;

grant execute on function public.trago_ensure_order_conversations(text) to service_role;
grant execute on function public.trago_expire_driver_offers() to service_role;
grant execute on function public.trago_create_driver_offer(text, text, text, text, timestamptz) to service_role;
grant execute on function public.trago_respond_driver_offer(text, text, boolean, text) to service_role;

commit;
