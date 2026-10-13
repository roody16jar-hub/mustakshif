-- Run in the SQL editor AFTER schema.sql and after your account exists.
-- Simulates the anon role and the authenticated role of a stranger: both must see zero rows.
begin;
set local role anon;
select 'anon items' as test, count(*) from public.items;          -- expect 0 (or permission denied)
select 'anon explored' as test, count(*) from public.explored;    -- expect 0 (or permission denied)
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
select 'stranger items' as test, count(*) from public.items;      -- expect 0
select 'stranger explored' as test, count(*) from public.explored;-- expect 0
select 'stranger photos' as test, count(*) from storage.objects where bucket_id = 'photos'; -- expect 0
rollback;
