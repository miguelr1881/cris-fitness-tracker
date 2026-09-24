begin;

create table public.cris_diaries (
  user_id uuid primary key,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  mutation_id uuid not null,
  updated_at timestamptz not null default now(),
  constraint cris_diary_payload_shape check ((
    jsonb_typeof(payload) = 'object'
    and payload ?& array['format', 'version', 'demo', 'activities', 'routines', 'settings', 'rewards', 'rewardAwards']
    and payload->>'format' = 'cristina-diary'
    and payload->'version' = '1'::jsonb
    and payload->'demo' = 'false'::jsonb
    and jsonb_typeof(payload->'activities') = 'array'
    and jsonb_typeof(payload->'routines') = 'array'
    and jsonb_typeof(payload->'settings') = 'object'
    and jsonb_typeof(payload->'rewards') = 'array'
    and jsonb_typeof(payload->'rewardAwards') = 'array'
    and octet_length(payload::text) <= 5242880
  ) is true)
);

alter table public.cris_diaries enable row level security;
alter table public.cris_diaries force row level security;
revoke all on table public.cris_diaries from public, anon, authenticated;
grant select, insert, update on table public.cris_diaries to authenticated;

create policy cris_diary_select on public.cris_diaries
for select to authenticated
using ((select auth.uid()) = user_id);

create policy cris_diary_insert on public.cris_diaries
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy cris_diary_update on public.cris_diaries
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create function public.cris_save_diary(
  p_payload jsonb,
  p_expected_revision bigint,
  p_mutation_id uuid
)
returns setof public.cris_diaries
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  saved public.cris_diaries%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_mutation_id is null or p_payload is null then
    raise exception 'Invalid save request' using errcode = '22023';
  end if;

  select * into saved from public.cris_diaries
  where user_id = current_user_id and mutation_id = p_mutation_id;
  if found then
    if saved.payload is distinct from p_payload then
      raise exception 'Mutation ID already used' using errcode = '22023';
    end if;
    return next saved;
    return;
  end if;

  if p_expected_revision = 0 then
    insert into public.cris_diaries (user_id, payload, revision, mutation_id)
    values (current_user_id, p_payload, 1, p_mutation_id)
    on conflict (user_id) do nothing
    returning * into saved;
  else
    update public.cris_diaries
    set payload = p_payload,
        revision = revision + 1,
        mutation_id = p_mutation_id,
        updated_at = now()
    where user_id = current_user_id and revision = p_expected_revision
    returning * into saved;
  end if;

  if not found then
    raise exception 'Diary changed on another device; reload before saving' using errcode = '40001';
  end if;
  return next saved;
end;
$$;

revoke all on function public.cris_save_diary(jsonb, bigint, uuid) from public, anon;
grant execute on function public.cris_save_diary(jsonb, bigint, uuid) to authenticated;

commit;