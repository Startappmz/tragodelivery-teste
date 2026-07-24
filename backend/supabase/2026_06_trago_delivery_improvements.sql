-- Trago Delivery · Migração incremental das melhorias solicitadas
-- Execute no Supabase SQL Editor antes de publicar o novo backend/front-end.

create extension if not exists pgcrypto;

create or replace function public.trago_generate_id()
returns text
language sql
as $$
  select substr(encode(gen_random_bytes(12), 'hex'), 1, 24);
$$;

create table if not exists public.vehicles (
  id text primary key default public.trago_generate_id(),
  plate text not null unique,
  brand text,
  model text,
  type text not null default 'mota',
  status text not null default 'ativo',
  notes text,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vehicles drop constraint if exists vehicles_type_check;
alter table public.vehicles add constraint vehicles_type_check check (type in ('mota', 'carro', 'carrinha', 'outro'));
alter table public.vehicles drop constraint if exists vehicles_status_check;
alter table public.vehicles add constraint vehicles_status_check check (status in ('ativo', 'manutencao', 'inativo'));

alter table public.driver_profiles add column if not exists vehicle_id text references public.vehicles(id) on delete set null;
alter table public.driver_profiles add column if not exists driver_type text not null default 'freelancer';
update public.driver_profiles set driver_type = 'freelancer' where driver_type is null;
alter table public.driver_profiles drop constraint if exists driver_profiles_driver_type_check;
alter table public.driver_profiles add constraint driver_profiles_driver_type_check check (driver_type in ('freelancer', 'official'));
update public.driver_profiles set commission_rate = 0 where driver_type = 'official';

alter table public.clients add column if not exists billing_type text not null default 'prepaid';
alter table public.clients add column if not exists credit_limit numeric(12,2) not null default 0;
alter table public.clients add column if not exists credit_balance numeric(12,2) not null default 0;
alter table public.clients add column if not exists credit_used numeric(12,2) not null default 0;
update public.clients set billing_type = 'prepaid' where billing_type is null;
alter table public.clients drop constraint if exists clients_billing_type_check;
alter table public.clients add constraint clients_billing_type_check check (billing_type in ('prepaid', 'postpaid'));
alter table public.clients drop constraint if exists clients_credit_limit_check;
alter table public.clients add constraint clients_credit_limit_check check (credit_limit >= 0);
alter table public.clients drop constraint if exists clients_credit_balance_check;
alter table public.clients add constraint clients_credit_balance_check check (credit_balance >= 0);
alter table public.clients drop constraint if exists clients_credit_used_check;
alter table public.clients add constraint clients_credit_used_check check (credit_used >= 0);

alter table public.orders add column if not exists pickup_contact_name text;
alter table public.orders add column if not exists pickup_contact_phone text;
alter table public.orders add column if not exists pickup_notes text;
alter table public.orders add column if not exists payment_status text not null default 'nao_pago';
alter table public.orders add column if not exists payment_confirmed_amount numeric(12,2);
alter table public.orders add column if not exists payment_confirmation_requested_at timestamptz;
alter table public.orders add column if not exists payment_confirmed_at timestamptz;
alter table public.orders add column if not exists driver_delivery_notes text;
update public.orders set payment_status = 'pago' where status = 'concluido' and payment_status = 'nao_pago';
alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check check (payment_method in ('cash', 'mpesa', 'emola', 'mkesh', 'bank_transfer', 'pos', 'postpaid_credit'));
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check check (payment_status in ('nao_pago', 'aguardando_confirmacao_pagamento', 'pago', 'pos_pago_mensal'));

alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses add constraint expenses_category_check check (category in ('manutencao', 'combustivel', 'emprestimo', 'credito', 'taxa_trans_levant', 'consumiveis', 'despesas_aplicativo', 'diversos'));

alter table public.company_costs add column if not exists assigned_vehicle text references public.vehicles(id) on delete set null;
alter table public.company_costs drop constraint if exists company_costs_category_check;
alter table public.company_costs add constraint company_costs_category_check check (category in ('manutencao', 'combustivel', 'emprestimo', 'credito', 'taxa_trans_levant', 'consumiveis', 'despesas_aplicativo', 'diversos'));
alter table public.company_costs drop constraint if exists company_cost_single_assignment;
alter table public.company_costs add constraint company_cost_single_assignment check (
  ((assigned_user is not null)::int + (assigned_client is not null)::int + (assigned_vehicle is not null)::int) <= 1
);

create index if not exists idx_vehicles_plate on public.vehicles(plate);
create index if not exists idx_driver_profiles_vehicle on public.driver_profiles(vehicle_id);
create index if not exists idx_driver_profiles_type on public.driver_profiles(driver_type);
create index if not exists idx_clients_billing_type on public.clients(billing_type);
create index if not exists idx_orders_payment_status on public.orders(payment_status);
create index if not exists idx_company_costs_vehicle on public.company_costs(assigned_vehicle);

drop trigger if exists trg_vehicles_updated_at on public.vehicles;
create trigger trg_vehicles_updated_at before update on public.vehicles
for each row execute function public.trago_touch_updated_at();

alter table public.vehicles enable row level security;
