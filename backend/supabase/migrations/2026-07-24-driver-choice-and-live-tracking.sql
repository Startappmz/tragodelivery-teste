-- TraGo Delivery · escolha explícita e aceite do motorista.
--
-- O pedido permanece pendente enquanto o cliente escolhe um motorista e
-- enquanto esse motorista decide se aceita. A atribuição só é concluída no
-- aceite do motorista.

begin;

alter table public.orders
  add column if not exists offered_to_driver text references public.driver_profiles(id) on delete set null,
  add column if not exists driver_offer_status text,
  add column if not exists driver_offer_expires_at timestamptz,
  add column if not exists driver_offer_rejected_ids jsonb not null default '[]'::jsonb;

alter table public.orders drop constraint if exists orders_driver_offer_status_check;
alter table public.orders add constraint orders_driver_offer_status_check
  check (
    driver_offer_status is null
    or driver_offer_status in ('pending', 'accepted', 'rejected', 'expired')
  );

create index if not exists idx_orders_driver_offer_pending
  on public.orders(offered_to_driver, driver_offer_status, driver_offer_expires_at)
  where offered_to_driver is not null;

commit;
