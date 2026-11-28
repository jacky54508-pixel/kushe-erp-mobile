-- Local synthetic PostgreSQL test only; never apply to any hosted database.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
grant usage on schema auth to anon,authenticated;
grant execute on all functions in schema auth to anon,authenticated;
create table public.erp_states(
 user_id uuid primary key, data jsonb not null, updated_at timestamptz not null default clock_timestamp(),
 sync_version bigint not null default 1,last_writer_mode text,last_base_sync_version bigint
);
alter table public.erp_states enable row level security;
grant select,insert,update on public.erp_states to authenticated;
create policy owner_read on public.erp_states for select to authenticated using ((select auth.uid())=user_id);
create policy owner_insert on public.erp_states for insert to authenticated with check ((select auth.uid())=user_id);
create policy owner_update on public.erp_states for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy p20_require_mfa_aal2 on public.erp_states as restrictive for all to authenticated
 using ((select auth.uid()) is not null and (select auth.jwt()->>'aal')='aal2')
 with check ((select auth.uid()) is not null and (select auth.jwt()->>'aal')='aal2');
CREATE OR REPLACE FUNCTION public.erp_state_cas_write(expected_sync_version bigint, new_data jsonb)
 RETURNS TABLE(status text, sync_version bigint, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  principal_id uuid := auth.uid();
  applied_version bigint;
  applied_at timestamptz;
begin
  if principal_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  -- P20 Security-Backend-MFA-1: authenticated ERP access requires aal2.
  if (auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'MFA_REQUIRED' using errcode = '42501';
  end if;
  if expected_sync_version is not null and expected_sync_version < 1 then
    raise exception 'EXPECTED_SYNC_VERSION_INVALID' using errcode = '22023';
  end if;
  if new_data is null or pg_catalog.jsonb_typeof(new_data) <> 'object' then
    raise exception 'NEW_DATA_MUST_BE_JSON_OBJECT' using errcode = '22023';
  end if;

  if expected_sync_version is null then
    insert into public.erp_states as target
      (user_id, data, updated_at, last_writer_mode, last_base_sync_version)
    values
      (principal_id, new_data, pg_catalog.clock_timestamp(), 'legacy', null)
    on conflict on constraint erp_states_pkey do nothing
    returning target.sync_version, target.updated_at
      into applied_version, applied_at;
  else
    update public.erp_states as target
    set data = new_data,
        updated_at = pg_catalog.clock_timestamp(),
        last_writer_mode = 'legacy',
        last_base_sync_version = expected_sync_version
    where target.user_id = principal_id
      and target.sync_version = expected_sync_version
    returning target.sync_version, target.updated_at
      into applied_version, applied_at;
  end if;

  if found then
    return query select 'APPLIED'::text, applied_version, applied_at;
  else
    return query select 'CONFLICT'::text, null::bigint, null::timestamptz;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_state_cas_write_v2(expected_sync_version bigint, new_data jsonb, writer_mode text)
 RETURNS TABLE(status text, sync_version bigint, updated_at timestamp with time zone, last_writer_mode text, last_base_sync_version bigint)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  principal_id uuid := auth.uid();
  applied_version bigint;
  applied_at timestamptz;
  current_version bigint;
  current_at timestamptz;
  current_mode text;
  current_base bigint;
begin
  if principal_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  -- P20 Security-Backend-MFA-1: authenticated ERP access requires aal2.
  if (auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'MFA_REQUIRED' using errcode = '42501';
  end if;
  if expected_sync_version is not null and expected_sync_version < 1 then
    raise exception 'EXPECTED_SYNC_VERSION_INVALID' using errcode = '22023';
  end if;
  if new_data is null or pg_catalog.jsonb_typeof(new_data) <> 'object' then
    raise exception 'NEW_DATA_MUST_BE_JSON_OBJECT' using errcode = '22023';
  end if;
  if writer_mode not in ('trusted','temporary') then
    raise exception 'WRITER_MODE_INVALID' using errcode = '22023';
  end if;

  if expected_sync_version is null then
    insert into public.erp_states as target
      (user_id, data, updated_at, last_writer_mode, last_base_sync_version)
    values
      (principal_id, new_data, pg_catalog.clock_timestamp(), writer_mode, null)
    on conflict on constraint erp_states_pkey do nothing
    returning target.sync_version, target.updated_at
      into applied_version, applied_at;
  else
    update public.erp_states as target
    set data = new_data,
        updated_at = pg_catalog.clock_timestamp(),
        last_writer_mode = writer_mode,
        last_base_sync_version = expected_sync_version
    where target.user_id = principal_id
      and target.sync_version = expected_sync_version
    returning target.sync_version, target.updated_at
      into applied_version, applied_at;
  end if;

  if found then
    return query
      select 'APPLIED'::text, applied_version, applied_at, writer_mode, expected_sync_version;
    return;
  end if;

  select target.sync_version,
         target.updated_at,
         target.last_writer_mode,
         target.last_base_sync_version
    into current_version, current_at, current_mode, current_base
  from public.erp_states as target
  where target.user_id = principal_id;

  return query
    select 'CONFLICT'::text, current_version, current_at, current_mode, current_base;
end;
$function$;

CREATE OR REPLACE FUNCTION public.erp_states_enforce_sync_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        NEW.sync_version := 1;
      ELSE
        NEW.sync_version := OLD.sync_version + 1;
      END IF;
      RETURN NEW;
    END;
    $function$;

create trigger erp_states_sync_version_before_write before insert or update on public.erp_states
 for each row execute function public.erp_states_enforce_sync_version();
revoke all on function public.erp_state_cas_write(bigint,jsonb) from public,anon;
revoke all on function public.erp_state_cas_write_v2(bigint,jsonb,text) from public,anon;
grant execute on function public.erp_state_cas_write(bigint,jsonb) to authenticated;
grant execute on function public.erp_state_cas_write_v2(bigint,jsonb,text) to authenticated;

