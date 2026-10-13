-- مستكشف: policy test. Run AFTER schema.sql, any time (before or after your account exists).
-- Never aborts: every check runs in its own sub-transaction and the result is one table.
-- Expected: every row shows pass = true.
--   anon       -> blocked (no privileges at all)
--   stranger   -> 0 rows visible, inserts rejected by RLS
--   owner      -> can insert / read / delete its own row (only when the account already exists)

create temp table if not exists mustakshif_test (n serial, test text, result text, pass boolean);
truncate mustakshif_test;

do $$
declare
  cnt bigint;
  owner_id uuid;
  stranger constant text := '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
  test_id uuid := gen_random_uuid();
  victim uuid;
  -- 1-element steps so that an exception in one step rolls back only that step
begin
  -- looked up as postgres, before any role switch (authenticated cannot read auth.users)
  select id into owner_id from auth.users where lower(email) = lower('roody16jar@gmail.com');
  victim := coalesce(owner_id, '11111111-1111-1111-1111-111111111111');
  -- ---------------- anon: must be blocked entirely ----------------
  begin
    set local role anon;
    select count(*) into cnt from public.items;
    reset role;
    insert into mustakshif_test(test, result, pass) values ('anon select items', cnt || ' rows', cnt = 0);
  exception when others then
    insert into mustakshif_test(test, result, pass) values ('anon select items', 'blocked: ' || sqlerrm, true);
  end;
  begin
    set local role anon;
    select count(*) into cnt from public.explored;
    reset role;
    insert into mustakshif_test(test, result, pass) values ('anon select explored', cnt || ' rows', cnt = 0);
  exception when others then
    insert into mustakshif_test(test, result, pass) values ('anon select explored', 'blocked: ' || sqlerrm, true);
  end;
  begin
    set local role anon;
    insert into public.items (id, user_id, kind, data) values (test_id, '00000000-0000-0000-0000-000000000000', 'note', '{}');
    reset role;
    insert into mustakshif_test(test, result, pass) values ('anon insert items', 'INSERTED (bad)', false);
  exception when others then
    insert into mustakshif_test(test, result, pass) values ('anon insert items', 'blocked: ' || sqlerrm, true);
  end;

  -- ---------------- stranger: a logged-in user that is not you ----------------
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', stranger, true);
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
    select count(*) into cnt from public.items;
    reset role;
    insert into mustakshif_test(test, result, pass) values ('stranger select items', cnt || ' rows', cnt = 0);
  exception when others then
    insert into mustakshif_test(test, result, pass) values ('stranger select items', 'blocked: ' || sqlerrm, true);
  end;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', stranger, true);
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
    select count(*) into cnt from public.explored;
    reset role;
    insert into mustakshif_test(test, result, pass) values ('stranger select explored', cnt || ' rows', cnt = 0);
  exception when others then
    insert into mustakshif_test(test, result, pass) values ('stranger select explored', 'blocked: ' || sqlerrm, true);
  end;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', stranger, true);
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
    select count(*) into cnt from storage.objects where bucket_id = 'photos';
    reset role;
    insert into mustakshif_test(test, result, pass) values ('stranger select photos', cnt || ' files', cnt = 0);
  exception when others then
    insert into mustakshif_test(test, result, pass) values ('stranger select photos', 'blocked: ' || sqlerrm, true);
  end;
  begin
    -- a stranger trying to write a row that claims to be yours (user_id = somebody else) must be rejected
    set local role authenticated;
    perform set_config('request.jwt.claims', stranger, true);
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
    insert into public.items (id, user_id, kind, data) values (test_id, victim, 'note', '{}');
    reset role;
    insert into mustakshif_test(test, result, pass) values ('stranger insert as owner', 'INSERTED (bad)', false);
  exception when others then
    insert into mustakshif_test(test, result, pass) values ('stranger insert as owner', 'blocked: ' || sqlerrm, true);
  end;

  -- ---------------- owner: only when the account exists ----------------
  if owner_id is null then
    insert into mustakshif_test(test, result, pass) values ('owner round trip', 'skipped: account not created yet (create it from the app, then run again)', true);
  else
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', owner_id::text, true);
      insert into public.items (id, kind, data) values (test_id, 'note', '{"test":true}');       -- user_id defaults to auth.uid()
      select count(*) into cnt from public.items where id = test_id;
      delete from public.items where id = test_id;
      reset role;
      insert into mustakshif_test(test, result, pass) values ('owner round trip', 'insert/select/delete ok (' || cnt || ' row seen)', cnt = 1);
    exception when others then
      insert into mustakshif_test(test, result, pass) values ('owner round trip', 'FAILED: ' || sqlerrm, false);
    end;
    begin
      -- the stranger must not see the owner's rows even if some exist
      set local role authenticated;
      perform set_config('request.jwt.claims', stranger, true);
      perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
      select count(*) into cnt from public.items where user_id = owner_id;
      reset role;
      insert into mustakshif_test(test, result, pass) values ('stranger sees owner rows', cnt || ' rows', cnt = 0);
    exception when others then
      insert into mustakshif_test(test, result, pass) values ('stranger sees owner rows', 'blocked: ' || sqlerrm, true);
    end;
  end if;

  -- ---------------- signup guard ----------------
  begin
    insert into auth.users (id, instance_id, email, aud, role, encrypted_password, created_at, updated_at)
      values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'someone.else@example.com', 'authenticated', 'authenticated', 'x', now(), now());
    insert into mustakshif_test(test, result, pass) values ('signup with another email', 'INSERTED (bad)', false);
    raise exception 'rollback_probe';   -- never keep a probe user
  exception when others then
    if sqlerrm = 'rollback_probe' then
      update mustakshif_test set result = 'INSERTED (bad, rolled back)', pass = false where test = 'signup with another email';
    else
      insert into mustakshif_test(test, result, pass) values ('signup with another email', 'blocked: ' || sqlerrm, true);
    end if;
  end;
end $$;

select test, result, pass from mustakshif_test order by n;
