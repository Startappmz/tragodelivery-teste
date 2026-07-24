-- Corrige a geração de IDs usada pelos fluxos internos da TraGo.
-- O pgcrypto está instalado no schema "extensions", enquanto a função
-- mantém um search_path deliberadamente restrito.
create or replace function public.trago_generate_id()
returns text
language sql
volatile
set search_path to 'pg_catalog', 'public'
as $function$
  select pg_catalog.substr(
    pg_catalog.encode(extensions.gen_random_bytes(12), 'hex'),
    1,
    24
  );
$function$;

-- A função é uma implementação interna. Preserva a superfície mínima de acesso.
revoke all on function public.trago_generate_id() from public, anon, authenticated;
grant execute on function public.trago_generate_id() to service_role;
