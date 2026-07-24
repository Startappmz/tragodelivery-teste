-- Perfil premium do motorista e identificação pública da viatura.
alter table public.driver_profiles add column if not exists avatar_url text not null default '';
alter table public.driver_profiles add column if not exists vehicle_photo_url text not null default '';
alter table public.driver_profiles add column if not exists license_photo_url text not null default '';
alter table public.driver_profiles add column if not exists vehicle_brand text not null default '';
alter table public.driver_profiles add column if not exists vehicle_model text not null default '';
alter table public.driver_profiles add column if not exists vehicle_color text not null default '';
alter table public.driver_profiles add column if not exists vehicle_type text not null default 'mota';
alter table public.driver_profiles add column if not exists vehicle_year integer;
alter table public.driver_profiles add column if not exists license_number text not null default '';
alter table public.driver_profiles add column if not exists license_expiry date;
alter table public.driver_profiles add column if not exists license_category text not null default 'A';
alter table public.driver_profiles add column if not exists emergency_name text not null default '';
alter table public.driver_profiles add column if not exists emergency_phone text not null default '';
alter table public.driver_profiles add column if not exists bio text not null default '';
alter table public.driver_profiles add column if not exists rating numeric(3,2) not null default 4.90;
alter table public.driver_profiles add column if not exists verified boolean not null default false;

alter table public.driver_profiles drop constraint if exists driver_profiles_rating_check;
alter table public.driver_profiles add constraint driver_profiles_rating_check check (rating >= 0 and rating <= 5);
