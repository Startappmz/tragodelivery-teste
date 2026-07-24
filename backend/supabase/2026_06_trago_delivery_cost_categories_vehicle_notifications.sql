-- Trago Delivery — custos actualizados + compatibilidade com categorias antigas
-- Execute este ficheiro no Supabase SQL Editor depois das migrações anteriores.

begin;

-- Normaliza categorias antigas para permitir a nova restrição sem perder registos.
update public.company_costs
set category = case category
  when 'salarios' then 'diversos'
  when 'renda' then 'diversos'
  when 'comunicacao' then 'despesas_aplicativo'
  when 'marketing' then 'despesas_aplicativo'
  when 'veiculo' then 'manutencao'
  else category
end
where category in ('salarios', 'renda', 'comunicacao', 'marketing', 'veiculo');

update public.expenses
set category = case category
  when 'salarios' then 'diversos'
  when 'renda' then 'diversos'
  when 'comunicacao' then 'despesas_aplicativo'
  when 'marketing' then 'despesas_aplicativo'
  when 'veiculo' then 'manutencao'
  else category
end
where category in ('salarios', 'renda', 'comunicacao', 'marketing', 'veiculo');

alter table public.company_costs drop constraint if exists company_costs_category_check;
alter table public.company_costs add constraint company_costs_category_check
  check (category in ('manutencao', 'combustivel', 'emprestimo', 'credito', 'taxa_trans_levant', 'consumiveis', 'despesas_aplicativo', 'diversos'));

alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses add constraint expenses_category_check
  check (category in ('manutencao', 'combustivel', 'emprestimo', 'credito', 'taxa_trans_levant', 'consumiveis', 'despesas_aplicativo', 'diversos'));

commit;
