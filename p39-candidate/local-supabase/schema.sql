-- P39-3F: DISPOSABLE LOCAL SUPABASE LAB ONLY (never link or push to hosted Supabase).
-- This is NOT the ERP production schema. Every record is synthetic and tables are p39f_*.
-- The RPC uses SECURITY INVOKER, so RLS applies to the actual signed-in test user.
create table if not exists public.p39f_members (
  tenant_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null check (member_role in ('owner','approver','employee')),
  primary key (tenant_id,user_id)
);
create table if not exists public.p39f_snapshots (
  tenant_id uuid primary key,
  revision bigint not null default 1 check (revision >= 1),
  state jsonb not null check (
    jsonb_typeof(state) = 'object'
    and state->>'__p39Synthetic' = 'kushe-p39-3-synthetic-fixture-v1'
    and state #>> '{meta,p39SyntheticSchema}' = 'kushe-p39-3-synthetic-fixture-v1'
    and state #>> '{billings,0,id}' = 'SYN-B'
    and state #>> '{receivables,0,id}' = 'SYN-AR'
  )
);
create table if not exists public.p39f_allowances (
  tenant_id uuid not null references public.p39f_snapshots(tenant_id),
  source_billing_id text not null check (source_billing_id = 'SYN-B'),
  operation_key text not null check (operation_key = 'p39::SYN-B::unissued'),
  reason text not null check (length(reason) between 2 and 300),
  original_gross bigint not null check (original_gross > 0),
  approved_gross bigint not null check (approved_gross > 0),
  discount_gross bigint not null check (discount_gross > 0),
  effective_receivable bigint not null check (effective_receivable > 0),
  effective_retention bigint not null check (effective_retention >= 0),
  committed_revision bigint not null check (committed_revision >= 2),
  status text not null default 'SYNTHETIC_ONLY' check (status = 'SYNTHETIC_ONLY'),
  primary key (tenant_id, source_billing_id),
  unique (tenant_id,operation_key),
  check (original_gross - approved_gross = discount_gross)
);

-- Ensure zero broad grants; anon cannot read rows, authenticated can read only via RLS.
revoke all on table public.p39f_members,public.p39f_snapshots,public.p39f_allowances
  from public,anon,authenticated;
grant select on public.p39f_members to authenticated;
grant select on public.p39f_snapshots to authenticated;
grant update (revision) on public.p39f_snapshots to authenticated;
grant select,insert on public.p39f_allowances to authenticated;

alter table public.p39f_members enable row level security;
alter table public.p39f_snapshots enable row level security;
alter table public.p39f_allowances enable row level security;

create policy p39f_member_self_read on public.p39f_members
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy p39f_snapshot_same_tenant_read on public.p39f_snapshots
  for select to authenticated
  using (exists (
    select 1 from public.p39f_members m
    where m.tenant_id=p39f_snapshots.tenant_id
      and m.user_id=(select auth.uid())
  ));

create policy p39f_snapshot_editors_can_advance_revision on public.p39f_snapshots
  for update to authenticated
  using (exists (
    select 1 from public.p39f_members m
    where m.tenant_id=p39f_snapshots.tenant_id
      and m.user_id=(select auth.uid())
      and m.member_role in ('owner','approver')
  ))
  with check (exists (
    select 1 from public.p39f_members m
    where m.tenant_id=p39f_snapshots.tenant_id
      and m.user_id=(select auth.uid())
      and m.member_role in ('owner','approver')
  ));

create policy p39f_allowance_same_tenant_read on public.p39f_allowances
  for select to authenticated
  using (exists (
    select 1 from public.p39f_members m
    where m.tenant_id=p39f_allowances.tenant_id
      and m.user_id=(select auth.uid())
  ));

create policy p39f_allowance_editors_can_insert on public.p39f_allowances
  for insert to authenticated
  with check (exists (
    select 1 from public.p39f_members m
    where m.tenant_id=p39f_allowances.tenant_id
      and m.user_id=(select auth.uid())
      and m.member_role in ('owner','approver')
  ));

-- FOR-UPDATE CAS + insert are one PostgreSQL transaction via PostgREST RPC.
-- No SECURITY DEFINER; no user_metadata-based roles; no service-role frontend key.
create or replace function public.p39f_apply_discount(
  p_tenant uuid,
  p_expected_revision bigint,
  p_key text,
  p_approved_gross bigint,
  p_reason text,
  p_fail_before_commit boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $p39$
declare
  v_role text;
  v_revision bigint;
  v_state jsonb;
  v_bill jsonb;
  v_ar jsonb;
  v_existing public.p39f_allowances%rowtype;
  v_tax bigint;
  v_orig_untaxed bigint;
  v_orig_gross bigint;
  v_orig_retention bigint;
  v_orig_receivable bigint;
  v_approved_untaxed bigint;
  v_approved_tax bigint;
  v_approved_retention bigint;
  v_approved_receivable bigint;
  v_next bigint;
begin
  select member_role into v_role
    from public.p39f_members
    where user_id = (select auth.uid()) and tenant_id = p_tenant;
  if coalesce(v_role,'') not in ('owner','approver') then
    raise exception 'P39F_ROLE_DENIED' using errcode='42501';
  end if;
  if p_key <> 'p39::SYN-B::unissued'
     or p_reason is null or length(btrim(p_reason)) < 2
     or length(p_reason)>300 or p_approved_gross is null
     or p_approved_gross<=0 or p_expected_revision is null then
    raise exception 'P39F_COMMAND_INVALID' using errcode='22023';
  end if;

  -- UPDATE privilege on revision plus RLS UPDATE policy required for FOR UPDATE.
  select revision,state into v_revision,v_state
    from public.p39f_snapshots
    where tenant_id=p_tenant
    for update;
  if not found then
    raise exception 'P39F_TENANT_NOT_FOUND' using errcode='42501';
  end if;
  if v_state->>'__p39Synthetic' <> 'kushe-p39-3-synthetic-fixture-v1'
     or v_state #>> '{meta,p39SyntheticSchema}' <> 'kushe-p39-3-synthetic-fixture-v1' then
    raise exception 'P39F_NON_SYNTHETIC_SOURCE' using errcode='22023';
  end if;

  select * into v_existing
    from public.p39f_allowances
    where tenant_id=p_tenant and operation_key=p_key;
  if found then
    if v_existing.approved_gross = p_approved_gross
       and v_existing.reason = p_reason then
      return jsonb_build_object('status','REPLAYED_IDEMPOTENT',
        'revision',v_existing.committed_revision,'ledgerId',v_existing.operation_key,
        'productionWrites',0);
    end if;
    raise exception 'P39F_IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_revision<>p_expected_revision then
    raise exception 'P39F_STALE_VERSION' using errcode='40001';
  end if;

  -- Restrict this lab to one never-issued synthetic billing with no financial links.
  if jsonb_array_length(v_state->'billings')<>1
     or jsonb_array_length(v_state->'receivables')<>1
     or jsonb_array_length(v_state->'receipts')<>0
     or jsonb_array_length(v_state->'retentionReceipts')<>0
     or jsonb_array_length(v_state->'bankTransactions')<>0
     or jsonb_array_length(v_state->'commissions')<>0
     or jsonb_array_length(v_state->'payroll')<>0
     or jsonb_array_length(v_state->'salaryPayments')<>0
     or jsonb_array_length(v_state->'billingAllowances')<>0 then
    raise exception 'P39F_CONNECTED_ACCOUNTING_LOCKED' using errcode='22023';
  end if;
  v_bill:=v_state->'billings'->0;
  v_ar:=v_state->'receivables'->0;
  if v_bill->>'id'<>'SYN-B' or v_ar->>'id'<>'SYN-AR'
     or v_bill->>'receivableId'<>'SYN-AR' or v_ar->>'billingId'<>'SYN-B'
     or v_bill->>'invoiceStatus' not in ('invoice_pending','no_invoice')
     or coalesce(v_bill->>'invoiceNo','')<>''
     or coalesce(v_ar->>'invoiceNo','')<>'' then
    raise exception 'P39F_SOURCE_OR_INVOICE_BLOCKED' using errcode='22023';
  end if;
  v_orig_untaxed:=(v_bill->>'preTaxAmount')::bigint;
  v_tax:=(v_bill->>'taxAmount')::bigint;
  v_orig_gross:=(v_bill->>'grossTotal')::bigint;
  v_orig_retention:=(v_bill->>'retentionAmount')::bigint;
  v_orig_receivable:=(v_bill->>'total')::bigint;
  if v_orig_untaxed+v_tax<>v_orig_gross or
     v_orig_gross-v_orig_retention<>v_orig_receivable or
     v_orig_receivable<>(v_ar->>'amount')::bigint or
     v_orig_retention<>(v_ar->>'retentionAmount')::bigint or
     (v_ar->>'received')::bigint<>0 or
     (v_ar->>'retentionReceived')::bigint<>0 or
     v_orig_retention<>5000 or v_orig_untaxed<>100000 then
    raise exception 'P39F_UNSAFE_ORIGINAL_TOTALS' using errcode='22023';
  end if;
  if p_approved_gross>=v_orig_gross then
    raise exception 'P39F_AMOUNT_RANGE' using errcode='22023';
  end if;
  if v_bill->>'invoiceStatus'='invoice_pending' then
    if v_tax<>5000 or v_orig_gross<>105000 then
      raise exception 'P39F_TAX_SOURCE_UNSAFE' using errcode='22023';
    end if;
    v_approved_untaxed:=round(p_approved_gross::numeric/1.05)::bigint;
    v_approved_tax:=p_approved_gross-v_approved_untaxed;
    if round(v_approved_untaxed::numeric*0.05)::bigint<>v_approved_tax then
      raise exception 'P39F_TAX_ROUNDING_UNSAFE' using errcode='22023';
    end if;
  else
    if v_tax<>0 or v_orig_gross<>100000 then
      raise exception 'P39F_NO_INVOICE_TAX_UNSAFE' using errcode='22023';
    end if;
    v_approved_untaxed:=p_approved_gross;
    v_approved_tax:=0;
  end if;
  v_approved_retention:=round(v_approved_untaxed::numeric*0.05)::bigint;
  v_approved_receivable:=p_approved_gross-v_approved_retention;
  if v_approved_receivable<=0 then
    raise exception 'P39F_RECEIVABLE_NEGATIVE' using errcode='22023';
  end if;

  -- This revision update and ledger insertion are indivisible. A failed function
  -- statement rolls back both; existing original JSON state is never modified.
  update public.p39f_snapshots
     set revision=revision+1
     where tenant_id=p_tenant and revision=v_revision
     returning revision into v_next;
  if not found then
    raise exception 'P39F_CAS_FAILED' using errcode='40001';
  end if;
  if p_fail_before_commit is true then
    raise exception 'P39F_INJECTED_PRECOMMIT_FAILURE' using errcode='P0001';
  end if;
  insert into public.p39f_allowances (
    tenant_id,source_billing_id,operation_key,reason,original_gross,
    approved_gross,discount_gross,effective_receivable,effective_retention,
    committed_revision,status
  ) values(
    p_tenant,'SYN-B',p_key,p_reason,v_orig_gross,p_approved_gross,
    v_orig_gross-p_approved_gross,v_approved_receivable,v_approved_retention,
    v_next,'SYNTHETIC_ONLY'
  );
  return jsonb_build_object('status','SYNTHETIC_LOCAL_ONLY',
    'revision',v_next,'ledgerId',p_key,'effectiveReceivable',v_approved_receivable,
    'effectiveRetention',v_approved_retention,'productionWrites',0);
end;
$p39$;

revoke all on function public.p39f_apply_discount(uuid,bigint,text,bigint,text,boolean)
  from public,anon;
grant execute on function public.p39f_apply_discount(uuid,bigint,text,bigint,text,boolean)
  to authenticated;

-- Test-only schema marker: production must never import this candidate migration.
comment on table public.p39f_snapshots is
  'P39-3F LOCAL SYNTHETIC LAB ONLY. Never deploy to hosted Supabase.';
