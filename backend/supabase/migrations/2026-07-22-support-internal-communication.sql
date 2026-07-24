-- TraGo: suporte e comunicacao interna entre os quatro perfis.
create table if not exists public.support_threads (
  id text primary key default public.trago_generate_id(),
  subject text not null,
  category text not null default 'general' check (category in ('order', 'payment', 'account', 'technical', 'restaurant', 'driver', 'general')),
  status text not null default 'open' check (status in ('open', 'pending', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  requester_role text not null check (requester_role in ('client', 'driver', 'restaurant', 'admin')),
  requester_id text not null,
  requester_name text not null default '',
  order_id text references public.orders(id) on delete set null,
  assigned_admin_id text references public.users(id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id text primary key default public.trago_generate_id(),
  thread_id text not null references public.support_threads(id) on delete cascade,
  sender_role text not null check (sender_role in ('client', 'driver', 'restaurant', 'admin')),
  sender_id text not null,
  sender_name text not null default '',
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_support_threads_requester on public.support_threads(requester_role, requester_id, last_message_at desc);
create index if not exists idx_support_threads_admin_queue on public.support_threads(status, priority, last_message_at desc);
create index if not exists idx_support_threads_order on public.support_threads(order_id);
create index if not exists idx_support_messages_thread_created on public.support_messages(thread_id, created_at);

drop trigger if exists trg_support_threads_updated_at on public.support_threads;
create trigger trg_support_threads_updated_at before update on public.support_threads
for each row execute function public.trago_touch_updated_at();

drop trigger if exists trg_support_messages_updated_at on public.support_messages;
create trigger trg_support_messages_updated_at before update on public.support_messages
for each row execute function public.trago_touch_updated_at();

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
