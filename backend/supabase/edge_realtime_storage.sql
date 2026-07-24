-- Trago Delivery · Fase 2 Supabase
-- Storage + Realtime + ajustes necessários para Edge Functions.
-- Execute depois de backend/supabase/schema.sql no Supabase SQL Editor.

-- 1) Bucket público para imagens das encomendas.
-- A escrita continua a ser feita pela Edge Function usando chave secreta/serviço.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-images',
  'order-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Leitura pública das imagens. Upload/update/delete devem continuar no servidor/Edge Function.
drop policy if exists "order_images_public_read" on storage.objects;
create policy "order_images_public_read"
on storage.objects
for select
to public
using (bucket_id = 'order-images');

-- 2) Realtime para futuras assinaturas Postgres Changes.
-- O front-end desta fase usa Broadcast para substituir Socket.IO, mas deixamos as tabelas
-- principais publicadas para permitir evoluir para Postgres Changes sem refazer o schema.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'driver_profiles'
  ) then
    alter publication supabase_realtime add table public.driver_profiles;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trips'
  ) then
    alter publication supabase_realtime add table public.trips;
  end if;
end $$;
