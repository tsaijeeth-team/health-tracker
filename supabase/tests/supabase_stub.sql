-- LOCAL TESTING ONLY. Never run this in Supabase.
-- Imitates the parts of Supabase the migration relies on:
-- the anon/authenticated roles, auth.users, auth.uid() and default grants.

-- Roles are shared by every database on a server, so create them only once.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (id uuid primary key);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants everything by default; row level security does the real protecting.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
