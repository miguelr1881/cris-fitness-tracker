begin;

select set_config('cris.test.owner', gen_random_uuid()::text, true);
select set_config('cris.test.other', gen_random_uuid()::text, true);
select set_config('cris.test.mutation', gen_random_uuid()::text, true);
select set_config('cris.test.payload', '{"format":"cristina-diary","version":1,"demo":false,"settings":{"unit":"kg","rest":45},"activities":[],"routines":[],"rewards":[],"rewardAwards":[]}', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('cris.test.owner'), true);

do $$
declare
  saved public.cris_diaries%rowtype;
begin
  select * into saved from public.cris_save_diary(current_setting('cris.test.payload')::jsonb, 0, current_setting('cris.test.mutation')::uuid);
  if saved.revision is distinct from 1::bigint or saved.user_id is distinct from current_setting('cris.test.owner')::uuid then
    raise exception 'FAIL: owner create';
  end if;
  select * into saved from public.cris_save_diary(current_setting('cris.test.payload')::jsonb, 0, current_setting('cris.test.mutation')::uuid);
  if saved.revision is distinct from 1::bigint then raise exception 'FAIL: idempotent retry'; end if;
  begin
    perform public.cris_save_diary(current_setting('cris.test.payload')::jsonb, 0, gen_random_uuid());
    raise exception 'FAIL: stale revision accepted';
  exception when serialization_failure then null;
  end;
  select * into saved from public.cris_save_diary(current_setting('cris.test.payload')::jsonb, 1, gen_random_uuid());
  if saved.revision is distinct from 2::bigint then raise exception 'FAIL: owner update'; end if;
  begin
    perform public.cris_save_diary(jsonb_set(current_setting('cris.test.payload')::jsonb, '{demo}', 'true'::jsonb), 2, gen_random_uuid());
    raise exception 'FAIL: demo uploaded';
  exception when check_violation then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('cris.test.other'), true);

do $$
declare
  changed bigint;
begin
  if exists (select 1 from public.cris_diaries where user_id = current_setting('cris.test.owner')::uuid) then
    raise exception 'FAIL: cross-account read';
  end if;
  update public.cris_diaries set revision = 999 where user_id = current_setting('cris.test.owner')::uuid;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: cross-account update'; end if;
  begin
    insert into public.cris_diaries (user_id, payload, mutation_id)
    values (current_setting('cris.test.owner')::uuid, current_setting('cris.test.payload')::jsonb, gen_random_uuid());
    raise exception 'FAIL: forged owner accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('cris.test.owner'), true);

do $$
begin
  if (select revision from public.cris_diaries where user_id = current_setting('cris.test.owner')::uuid) is distinct from 2::bigint then
    raise exception 'FAIL: owner data changed by denied writes';
  end if;
  begin
    update public.cris_diaries set user_id = current_setting('cris.test.other')::uuid
    where user_id = current_setting('cris.test.owner')::uuid;
    raise exception 'FAIL: ownership transfer';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if has_table_privilege('anon', 'public.cris_diaries', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.cris_diaries', 'DELETE,TRUNCATE')
    or has_function_privilege('anon', 'public.cris_save_diary(jsonb,bigint,uuid)', 'EXECUTE') then
    raise exception 'FAIL: excessive grants';
  end if;
  begin
    perform 1 from public.cris_diaries;
    raise exception 'FAIL: anonymous read';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cris_save_diary(current_setting('cris.test.payload')::jsonb, 0, gen_random_uuid());
    raise exception 'FAIL: anonymous RPC';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select 'OK: account isolation, permissions, revisions and retry checks passed; no test rows retained.' as result;
rollback;