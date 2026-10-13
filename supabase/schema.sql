-- مستكشف: schema + row level security + grants.
-- Paste the whole file in the Supabase SQL editor (Dashboard > SQL Editor) and Run.
-- Safe to run again at any time: every statement is idempotent.
-- Works whether "Automatically expose new tables" is ON or OFF (grants are explicit)
-- and whether "Enable automatic RLS" is ON or OFF (RLS is enabled explicitly).
-- Everything is scoped to auth.uid(): no other user can read or write any row or file.

-- ---------------------------------------------------------------------------
-- 0. the single allowed account. Change the email here if yours differs.
-- ---------------------------------------------------------------------------
create or replace function public.only_owner_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(new.email, '')) <> lower('roody16jar@gmail.com') then
    raise exception 'signup_disabled_for_this_email';
  end if;
  return new;
end $$;
revoke execute on function public.only_owner_signup() from public, anon, authenticated;
grant execute on function public.only_owner_signup() to supabase_auth_admin, postgres;
drop trigger if exists only_owner_signup on auth.users;
create trigger only_owner_signup before insert on auth.users
  for each row execute function public.only_owner_signup();

-- ---------------------------------------------------------------------------
-- 1. items: targets, properties, notes, settings. One generic document table with a kind.
-- ---------------------------------------------------------------------------
create table if not exists public.items (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('target','property','note','setting')),
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  synced_at timestamptz not null default clock_timestamp()
);
alter table public.items add column if not exists synced_at timestamptz not null default clock_timestamp();
create index if not exists items_user_synced on public.items (user_id, synced_at);
create index if not exists items_user_kind on public.items (user_id, kind) where not deleted;

-- ---------------------------------------------------------------------------
-- 2. explored streets: one row per (district, OSM way id)
-- ---------------------------------------------------------------------------
create table if not exists public.explored (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  hood text not null,
  explored_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  synced_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);
alter table public.explored add column if not exists synced_at timestamptz not null default clock_timestamp();
create index if not exists explored_user_synced on public.explored (user_id, synced_at);

-- ---------------------------------------------------------------------------
-- 2b. server-side rules: synced_at is always the server clock (the pull cursor), and an
--     older updated_at never overwrites a newer row (last write wins, even across devices).
-- ---------------------------------------------------------------------------
create or replace function public.stamp_synced_at() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;  -- keep the newer row already stored; the upsert still reports success
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;
revoke execute on function public.stamp_synced_at() from public, anon, authenticated;
drop trigger if exists items_stamp on public.items;
create trigger items_stamp before insert or update on public.items for each row execute function public.stamp_synced_at();
drop trigger if exists explored_stamp on public.explored;
create trigger explored_stamp before insert or update on public.explored for each row execute function public.stamp_synced_at();

-- ---------------------------------------------------------------------------
-- 3. row level security (explicit, so it does not depend on the "automatic RLS" setting)
-- ---------------------------------------------------------------------------
alter table public.items enable row level security;
alter table public.explored enable row level security;
alter table public.items force row level security;      -- even the table owner goes through RLS
alter table public.explored force row level security;

drop policy if exists items_owner_select on public.items;
drop policy if exists items_owner_insert on public.items;
drop policy if exists items_owner_update on public.items;
drop policy if exists items_owner_delete on public.items;
create policy items_owner_select on public.items for select to authenticated using (user_id = auth.uid());
create policy items_owner_insert on public.items for insert to authenticated with check (user_id = auth.uid());
create policy items_owner_update on public.items for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy items_owner_delete on public.items for delete to authenticated using (user_id = auth.uid());

drop policy if exists explored_owner_select on public.explored;
drop policy if exists explored_owner_insert on public.explored;
drop policy if exists explored_owner_update on public.explored;
drop policy if exists explored_owner_delete on public.explored;
create policy explored_owner_select on public.explored for select to authenticated using (user_id = auth.uid());
create policy explored_owner_insert on public.explored for insert to authenticated with check (user_id = auth.uid());
create policy explored_owner_update on public.explored for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy explored_owner_delete on public.explored for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. grants: explicit, so the Data API sees the tables even when
--    "Automatically expose new tables" is OFF. anon gets nothing at all.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
revoke all on table public.items, public.explored from anon;
revoke all on table public.items, public.explored from public;
grant select, insert, update, delete on table public.items, public.explored to authenticated;
grant all on table public.items, public.explored to service_role;

-- ---------------------------------------------------------------------------
-- 5. photos bucket (private). Files live under <user_id>/<item_id>/<photo_id>.jpg
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists photos_owner_select on storage.objects;
drop policy if exists photos_owner_insert on storage.objects;
drop policy if exists photos_owner_update on storage.objects;
drop policy if exists photos_owner_delete on storage.objects;
create policy photos_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy photos_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy photos_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy photos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- storage grants normally exist already; (re)apply them defensively, never fail the script on them
do $$
begin
  begin
    grant usage on schema storage to authenticated, service_role;
    grant select, insert, update, delete on table storage.objects to authenticated;
    grant select on table storage.buckets to authenticated;
  exception when others then
    raise notice 'storage grants skipped: %', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 6. ask PostgREST to reload its schema cache right away
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
