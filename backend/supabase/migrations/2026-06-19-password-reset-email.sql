-- Trago Delivery · Password reset por email
-- Execute no Supabase Dashboard > SQL Editor antes de publicar a Edge Function.

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

create table if not exists public.password_reset_codes (
  id text primary key default public.trago_generate_id(),
  user_id text not null references public.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'driver')),
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_password_reset_codes_email_role
on public.password_reset_codes(email, role);

create index if not exists idx_password_reset_codes_user_active
on public.password_reset_codes(user_id, role, created_at desc)
where used_at is null;

create index if not exists idx_password_reset_codes_expires_at
on public.password_reset_codes(expires_at);

drop trigger if exists trg_password_reset_codes_touch_updated_at on public.password_reset_codes;
create trigger trg_password_reset_codes_touch_updated_at
before update on public.password_reset_codes
for each row execute function public.trago_touch_updated_at();
