-- K30 candidate only. Generated with Supabase CLI 3.4.0 migration new.
-- NOT APPLIED to the hosted project. No business rows are inserted or changed.
-- Keep v1/v2 and all existing RLS/MFA rules. Once an allowance exists, only the
-- capability-aware CAS may write; direct REST and legacy CAS are rejected.
begin;

create schema if not exists erp_allowance_internal;
revoke all on schema erp_allowance_internal from public;
grant usage on schema erp_allowance_internal to authenticated;

create or replace function erp_allowance_internal.money(value jsonb)
returns numeric language plpgsql immutable security invoker set search_path = pg_catalog as $$
declare result numeric;
begin
  if value is null or jsonb_typeof(value) not in ('number','string')
    or (value #>> '{}') !~ '^(0|[1-9][0-9]*)$' then
    raise exception 'ALLOWANCE_MONEY_INVALID' using errcode = '23514';
  end if;
  result := (value #>> '{}')::numeric;
  if result > 9007199254740991 then
    raise exception 'ALLOWANCE_MONEY_INVALID' using errcode = '23514';
  end if;
  return result;
end $$;

create or replace function erp_allowance_internal.validate_snapshot(snapshot jsonb)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare
  ledger jsonb := snapshot #> '{meta,billingAllowances}';
  event jsonb; allocation jsonb; original jsonb; reduction jsonb;
  billing jsonb; ar jsonb; invoice jsonb; prior jsonb; item jsonb; field text;
  event_ids text[] := '{}'; intent_ids text[] := '{}'; reversal_ids text[] := '{}';
  source_ids text[]; recorded_sources text[]; seen_sources text[] := '{}';
  count_rows integer; total_reduction numeric; received numeric; retained numeric;
  pending numeric; cash numeric; deduction numeric; settlement numeric;
  effective_net numeric; effective_tax numeric; effective_gross numeric;
  effective_retention numeric; effective_receivable numeric;
  r_net numeric; r_tax numeric; r_gross numeric; r_retention numeric; r_receivable numeric;
  source_id text; invoice_basis jsonb;
begin
  if ledger is null then return; end if;
  if jsonb_typeof(ledger) <> 'array' then
    raise exception 'ALLOWANCE_LEDGER_INVALID' using errcode = '23514';
  end if;
  if jsonb_array_length(ledger) = 0 then return; end if;
  foreach field in array array['billings','receivables','receipts','retentionReceipts','invoices'] loop
    if jsonb_typeof(snapshot -> field) is distinct from 'array' then
      raise exception 'ALLOWANCE_COLLECTION_INVALID: %',field using errcode = '23514';
    end if;
  end loop;
  for event in select value from jsonb_array_elements(ledger) loop
    if jsonb_typeof(event) <> 'object' or event->>'schema' is distinct from 'kushe.billing.allowances.v1'
      or coalesce(event->>'id','') = '' or coalesce(event->>'idempotencyKey','') = ''
      or coalesce(event->>'intentFingerprint','') = ''
      or coalesce(event->>'eventType','') not in ('post','reverse')
      or coalesce(event->>'scope','') not in ('billing','external-document')
      or coalesce(event->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(btrim(event->>'reason'),'') = '' or coalesce(btrim(event->>'reference'),'') = ''
      or jsonb_typeof(event->'allocations') is distinct from 'array'
      or jsonb_typeof(event->'sourceBillingIds') is distinct from 'array'
      or jsonb_typeof(event->'invoiceEvidence') is distinct from 'array'
      or jsonb_array_length(event->'allocations') = 0 then
      raise exception 'ALLOWANCE_EVENT_INVALID' using errcode = '23514';
    end if;
    perform (event->>'date')::date;
    if event->>'id' = any(event_ids) or event->>'idempotencyKey' = any(intent_ids) then
      raise exception 'ALLOWANCE_DUPLICATE_OPERATION' using errcode = '23514';
    end if;
    if event->>'eventType' = 'reverse' then
      select value into prior from jsonb_array_elements(ledger)
        where value->>'id' = event->>'reverseOf' and value->>'eventType' = 'post';
      if prior is null or not (event->>'reverseOf' = any(event_ids))
        or event->>'reverseOf' = any(reversal_ids)
        or event->'allocations' is distinct from prior->'allocations'
        or event->'sourceBillingIds' is distinct from prior->'sourceBillingIds'
        or event->>'scope' is distinct from prior->>'scope'
        or event->>'externalDocumentId' is distinct from prior->>'externalDocumentId'
        or event->>'billingId' is distinct from prior->>'billingId'
        or event->'approvedGrossReduction' is distinct from prior->'approvedGrossReduction'
        or event->>'date' < prior->>'date' then
        raise exception 'ALLOWANCE_REVERSAL_INVALID' using errcode = '23514';
      end if;
      reversal_ids := array_append(reversal_ids,event->>'reverseOf');
    elsif coalesce(event->>'reverseOf','') <> '' then
      raise exception 'ALLOWANCE_REVERSAL_INVALID' using errcode = '23514';
    end if;
    event_ids := array_append(event_ids,event->>'id');
    intent_ids := array_append(intent_ids,event->>'idempotencyKey');
    source_ids := '{}'; total_reduction := 0;
    for allocation in select value from jsonb_array_elements(event->'allocations') loop
      source_id := allocation->>'billingId'; original := allocation->'original'; reduction := allocation->'reductions';
      if coalesce(source_id,'') = '' or source_id = any(source_ids)
        or jsonb_typeof(original) is distinct from 'object' or jsonb_typeof(reduction) is distinct from 'object'
        or coalesce(allocation->>'invoiceStage','') not in ('no_invoice','preinvoice','postinvoice') then
        raise exception 'ALLOWANCE_SOURCE_INVALID' using errcode = '23514';
      end if;
      source_ids := array_append(source_ids,source_id);
      foreach field in array array['untaxed','tax','grossTotal','retention','receivable'] loop
        if jsonb_typeof(original->field) is distinct from 'number'
          or jsonb_typeof(reduction->field) is distinct from 'number'
          or erp_allowance_internal.money(reduction->field) > erp_allowance_internal.money(original->field) then
          raise exception 'ALLOWANCE_ALLOCATION_INVALID' using errcode = '23514';
        end if;
      end loop;
      if erp_allowance_internal.money(original->'untaxed') + erp_allowance_internal.money(original->'tax') <> erp_allowance_internal.money(original->'grossTotal')
        or erp_allowance_internal.money(original->'grossTotal') - erp_allowance_internal.money(original->'retention') <> erp_allowance_internal.money(original->'receivable')
        or erp_allowance_internal.money(reduction->'untaxed') + erp_allowance_internal.money(reduction->'tax') <> erp_allowance_internal.money(reduction->'grossTotal')
        or erp_allowance_internal.money(reduction->'grossTotal') - erp_allowance_internal.money(reduction->'retention') <> erp_allowance_internal.money(reduction->'receivable') then
        raise exception 'ALLOWANCE_ALLOCATION_UNBALANCED' using errcode = '23514';
      end if;
      total_reduction := total_reduction + erp_allowance_internal.money(reduction->'grossTotal');
      select count(*), jsonb_agg(value)->0 into count_rows,billing
        from jsonb_array_elements(snapshot->'billings') where value->>'id'=source_id;
      if count_rows <> 1 then raise exception 'ALLOWANCE_BILLING_NOT_UNIQUE' using errcode = '23514'; end if;
      select count(*), jsonb_agg(value)->0 into count_rows,ar
        from jsonb_array_elements(snapshot->'receivables') where value->>'id'=allocation->>'receivableId';
      if count_rows <> 1 or ar->>'billingId' is distinct from source_id
        or billing->>'receivableId' is distinct from ar->>'id'
        or coalesce(billing->>'customer','') is distinct from coalesce(allocation->>'customerId','')
        or coalesce(billing->>'project','') is distinct from coalesce(allocation->>'projectId','')
        or coalesce(billing->>'number','') is distinct from coalesce(allocation->>'billingNo','') then
        raise exception 'ALLOWANCE_SOURCE_LINK_INVALID' using errcode = '23514';
      end if;
      if erp_allowance_internal.money(coalesce(billing->'preTaxAmount',billing->'amount')) <> erp_allowance_internal.money(original->'untaxed')
        or erp_allowance_internal.money(coalesce(billing->'taxAmount',billing->'tax')) <> erp_allowance_internal.money(original->'tax')
        or erp_allowance_internal.money(coalesce(billing->'grossTotal',billing->'taxIncludedAmount')) <> erp_allowance_internal.money(original->'grossTotal')
        or erp_allowance_internal.money(coalesce(billing->'retentionAmount',billing->'retention')) <> erp_allowance_internal.money(original->'retention')
        or erp_allowance_internal.money(billing->'total') <> erp_allowance_internal.money(original->'receivable')
        or erp_allowance_internal.money(ar->'amount') <> erp_allowance_internal.money(original->'receivable')
        or erp_allowance_internal.money(coalesce(ar->'retentionAmount',ar->'retention')) <> erp_allowance_internal.money(original->'retention') then
        raise exception 'ALLOWANCE_ORIGINAL_CHANGED' using errcode = '23514';
      end if;
      if allocation->>'invoiceStage' = 'postinvoice' then
        select count(*),jsonb_agg(value)->0 into count_rows,invoice from jsonb_array_elements(snapshot->'invoices')
          where value->>'id'=allocation->>'invoiceId';
        invoice_basis := allocation->'invoiceOriginal';
        if count_rows <> 1 or invoice->>'billingId' is distinct from source_id
          or jsonb_typeof(invoice_basis) is distinct from 'object'
          or coalesce(invoice->>'invoiceNumber',invoice->>'number','') is distinct from invoice_basis->>'invoiceNumber'
          or coalesce(invoice->>'invoiceDate',invoice->>'date','') is distinct from invoice_basis->>'invoiceDate'
          or erp_allowance_internal.money(coalesce(invoice->'netAmount',invoice->'amount')) <> erp_allowance_internal.money(invoice_basis->'untaxed')
          or erp_allowance_internal.money(coalesce(invoice->'taxAmount',invoice->'tax')) <> erp_allowance_internal.money(invoice_basis->'tax')
          or erp_allowance_internal.money(coalesce(invoice->'grossAmount',invoice->'total')) <> erp_allowance_internal.money(invoice_basis->'grossTotal')
          or not exists(select 1 from jsonb_array_elements(event->'invoiceEvidence') proof
            where proof->>'invoiceId'=allocation->>'invoiceId' and proof->'verified'='true'::jsonb
              and coalesce(btrim(proof->>'voucherReference'),'')<>''
              and coalesce(proof->>'voucherDate','') ~ '^\d{4}-\d{2}-\d{2}$') then
          raise exception 'ALLOWANCE_INVOICE_EVIDENCE_INVALID' using errcode = '23514';
        end if;
      end if;
      if not (source_id = any(seen_sources)) then seen_sources:=array_append(seen_sources,source_id); end if;
    end loop;
    select array_agg(value order by value) into recorded_sources from jsonb_array_elements_text(event->'sourceBillingIds');
    if recorded_sources is distinct from (select array_agg(s order by s) from unnest(source_ids) s)
      or total_reduction <= 0 or total_reduction <> erp_allowance_internal.money(event->'approvedGrossReduction') then
      raise exception 'ALLOWANCE_APPROVED_TOTAL_MISMATCH' using errcode = '23514';
    end if;
    if event->>'scope'='billing' and (array_length(source_ids,1)<>1 or event->>'billingId' is distinct from source_ids[1]) then
      raise exception 'ALLOWANCE_SCOPE_INVALID' using errcode = '23514';
    end if;
  end loop;
  -- Validate actual settlements against effective limits, including cheque holds.
  -- Bank fees are not settlements; customer deductions and employee cash are.
  foreach source_id in array seen_sources loop
    select value into billing from jsonb_array_elements(snapshot->'billings') where value->>'id'=source_id;
    select value into ar from jsonb_array_elements(snapshot->'receivables') where value->>'id'=billing->>'receivableId';
    select a into allocation from jsonb_array_elements(ledger) e,
      lateral jsonb_array_elements(e->'allocations') a where a->>'billingId'=source_id limit 1;
    original:=allocation->'original';
    select coalesce(sum(erp_allowance_internal.money(a->'reductions'->'untaxed')),0),
      coalesce(sum(erp_allowance_internal.money(a->'reductions'->'tax')),0),
      coalesce(sum(erp_allowance_internal.money(a->'reductions'->'grossTotal')),0),
      coalesce(sum(erp_allowance_internal.money(a->'reductions'->'retention')),0),
      coalesce(sum(erp_allowance_internal.money(a->'reductions'->'receivable')),0)
      into r_net,r_tax,r_gross,r_retention,r_receivable
      from jsonb_array_elements(ledger) e, lateral jsonb_array_elements(e->'allocations') a
      where e->>'eventType'='post' and not(e->>'id'=any(reversal_ids)) and a->>'billingId'=source_id;
    effective_net:=erp_allowance_internal.money(original->'untaxed')-r_net;
    effective_tax:=erp_allowance_internal.money(original->'tax')-r_tax;
    effective_gross:=erp_allowance_internal.money(original->'grossTotal')-r_gross;
    effective_retention:=erp_allowance_internal.money(original->'retention')-r_retention;
    effective_receivable:=erp_allowance_internal.money(original->'receivable')-r_receivable;
    if least(effective_net,effective_tax,effective_gross,effective_retention,effective_receivable)<0 then
      raise exception 'ALLOWANCE_EFFECTIVE_NEGATIVE' using errcode = '23514';
    end if;
    received:=erp_allowance_internal.money(coalesce(ar->'legacyReceived','0'::jsonb));
    retained:=erp_allowance_internal.money(coalesce(ar->'legacyRetentionReceived','0'::jsonb));
    pending:=0;
    for item in select value from jsonb_array_elements(snapshot->'receipts') where value->>'receivableId'=ar->>'id' loop
      cash:=erp_allowance_internal.money(coalesce(item->'cashAmount',item->'amount'));
      if item ? 'cashAmount' and item ? 'amount' and cash<>erp_allowance_internal.money(item->'amount') then
        raise exception 'ALLOWANCE_RECEIPT_MISMATCH' using errcode = '23514';
      end if;
      if item ? 'deductions' then
        if jsonb_typeof(item->'deductions')<>'array' then raise exception 'ALLOWANCE_RECEIPT_MISMATCH' using errcode='23514'; end if;
        select coalesce(sum(erp_allowance_internal.money(value->'amount')),0) into deduction from jsonb_array_elements(item->'deductions');
      else deduction:=erp_allowance_internal.money(coalesce(item->'deductionAmount','0'::jsonb)); end if;
      settlement:=cash+deduction;
      if settlement<=0 or (item ? 'deductionAmount' and erp_allowance_internal.money(item->'deductionAmount')<>deduction)
        or (item ? 'settlementAmount' and erp_allowance_internal.money(item->'settlementAmount')<>settlement) then
        raise exception 'ALLOWANCE_RECEIPT_MISMATCH' using errcode = '23514';
      end if;
      received:=received+settlement;
    end loop;
    for item in select value from jsonb_array_elements(snapshot->'retentionReceipts')
      where value->>'receivableId'=ar->>'id' or value->>'billingId'=source_id loop
      retained:=retained+erp_allowance_internal.money(item->'amount');
    end loop;
    if ar ? 'receivableCheques' and jsonb_typeof(ar->'receivableCheques')<>'array' then
      raise exception 'ALLOWANCE_CHEQUE_INVALID' using errcode = '23514';
    end if;
    for item in select value from jsonb_array_elements(coalesce(ar->'receivableCheques','[]'::jsonb)) loop
      if item->>'schema' is distinct from 'kushe-receivable-cheque-v1'
        or coalesce(item->>'status','') not in ('pending','cleared','cancelled') then
        raise exception 'ALLOWANCE_CHEQUE_INVALID' using errcode = '23514';
      end if;
      if item->>'status'='pending' then
        select coalesce(sum(erp_allowance_internal.money(value->'amount')),0) into deduction
          from jsonb_array_elements(coalesce(item->'deductions','[]'::jsonb));
        settlement:=erp_allowance_internal.money(item->'amount')+deduction;
        if settlement<>erp_allowance_internal.money(item->'reservedAmount') then
          raise exception 'ALLOWANCE_CHEQUE_INVALID' using errcode = '23514';
        end if;
        pending:=pending+settlement;
      end if;
    end loop;
    if erp_allowance_internal.money(coalesce(ar->'received','0'::jsonb))<>received
      or erp_allowance_internal.money(coalesce(ar->'retentionReceived','0'::jsonb))<>retained
      or received+pending>effective_receivable or retained>effective_retention then
      raise exception 'ALLOWANCE_COLLECTION_LIMIT' using errcode = '23514';
    end if;
  end loop;
end $$;

create or replace function erp_allowance_internal.guard_state_write()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare before_ledger jsonb; after_ledger jsonb; before_count integer; after_count integer;
  event jsonb; allocation jsonb; old_source jsonb; new_source jsonb; field text;
begin
  before_ledger:=case when tg_op='UPDATE' then old.data #> '{meta,billingAllowances}' else null end;
  after_ledger:=new.data #> '{meta,billingAllowances}';
  if before_ledger is null and after_ledger is null then return new; end if;
  if (before_ledger is not null and jsonb_typeof(before_ledger)<>'array')
    or (after_ledger is not null and jsonb_typeof(after_ledger)<>'array') then
    raise exception 'ALLOWANCE_LEDGER_INVALID' using errcode = '23514';
  end if;
  before_count:=coalesce(jsonb_array_length(before_ledger),0);
  after_count:=coalesce(jsonb_array_length(after_ledger),0);
  if before_count=0 and after_count=0 then return new; end if;
  if current_setting('kushe.erp_allowance_capability',true) is distinct from 'billing-allowances-v1' then
    raise exception 'ALLOWANCE_CLIENT_UPGRADE_REQUIRED' using errcode = '42501';
  end if;
  if tg_op='INSERT' or after_count<before_count or after_count>before_count+1
    or exists(select 1 from jsonb_array_elements(before_ledger) with ordinality p(value,n)
      where value is distinct from after_ledger->((n-1)::integer)) then
    raise exception 'ALLOWANCE_HISTORY_IMMUTABLE' using errcode = '23514';
  end if;
  perform erp_allowance_internal.validate_snapshot(new.data);
  -- Appending an allowance may change only metadata and the normal audit log.
  -- A same-request collection, invoice, payroll, or source rewrite is refused.
  if after_count>before_count then
    event:=after_ledger->(after_count-1);
    if event->>'createdBy' is distinct from auth.uid()::text then
      raise exception 'ALLOWANCE_AUTHOR_MISMATCH' using errcode = '42501';
    end if;
    if (new.data - 'meta' - 'audit') is distinct from (old.data - 'meta' - 'audit') then
      raise exception 'ALLOWANCE_POST_MUST_PRESERVE_BUSINESS_ROWS' using errcode = '23514';
    end if;
    if (new.data->'meta' - 'billingAllowances' - 'businessSnapshotRevision' - 'updatedAt' - 'receiptCommitVersion')
      is distinct from (old.data->'meta' - 'billingAllowances' - 'businessSnapshotRevision' - 'updatedAt' - 'receiptCommitVersion') then
      raise exception 'ALLOWANCE_POST_MUST_PRESERVE_OTHER_METADATA' using errcode = '23514';
    end if;
    if event->>'eventType'='reverse' and exists(select 1 from jsonb_array_elements(new.data->'invoices') i
      where coalesce(i#>'{invoiceIssueBasis,allowanceIds}','[]'::jsonb) ? (event->>'reverseOf')) then
      raise exception 'ALLOWANCE_INVOICE_CORRECTION_REQUIRED' using errcode = '23514';
    end if;
  end if;
  -- Existing sources may receive payments/invoice metadata but retain their
  -- original line items, identifiers, customer, project and financial anchors.
  for allocation in select a from jsonb_array_elements(coalesce(before_ledger,'[]'::jsonb)) e,
    lateral jsonb_array_elements(e->'allocations') a loop
    select value into old_source from jsonb_array_elements(old.data->'billings') where value->>'id'=allocation->>'billingId';
    select value into new_source from jsonb_array_elements(new.data->'billings') where value->>'id'=allocation->>'billingId';
    foreach field in array array['id','number','date','customer','project','receivableId','sourceType','sourceBatchIds','sourceItemRefs','sourceContractRefs','lines','amount','preTaxAmount','tax','taxAmount','taxIncludedAmount','grossTotal','retention','retentionAmount','retentionRate','retentionEnabled','retentionMode','retentionBase','total','taxMode'] loop
      if old_source->field is distinct from new_source->field then
        raise exception 'ALLOWANCE_ORIGINAL_CHANGED: %',field using errcode = '23514';
      end if;
    end loop;
  end loop;
  return new;
end $$;

create trigger erp_states_allowance_before_write before insert or update on public.erp_states
for each row execute function erp_allowance_internal.guard_state_write();

create or replace function public.erp_billing_allowance_capability()
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog as $$
begin
  if auth.uid() is null or (auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  return jsonb_build_object('capability','billing-allowances-v1','schema','kushe.billing.allowances.v1','guardVersion',1,
    'enabled',exists(select 1 from pg_trigger where tgrelid='public.erp_states'::regclass
      and tgname='erp_states_allowance_before_write' and tgenabled in ('O','A') and not tgisinternal)
      and to_regprocedure('public.erp_state_cas_write_v3(bigint,jsonb,text,text)') is not null);
end $$;

create or replace function public.erp_state_cas_write_v3(expected_sync_version bigint,new_data jsonb,writer_mode text,client_capability text)
returns table(status text,sync_version bigint,updated_at timestamptz,last_writer_mode text,last_base_sync_version bigint)
language plpgsql security invoker set search_path = pg_catalog as $$
declare prior_capability text;
begin
  if auth.uid() is null or (auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if client_capability is distinct from 'billing-allowances-v1' then
    raise exception 'ALLOWANCE_CLIENT_UPGRADE_REQUIRED' using errcode = '42501';
  end if;
  prior_capability:=current_setting('kushe.erp_allowance_capability',true);
  perform set_config('kushe.erp_allowance_capability',client_capability,true);
  return query select * from public.erp_state_cas_write_v2(expected_sync_version,new_data,writer_mode);
  perform set_config('kushe.erp_allowance_capability',coalesce(prior_capability,''),true);
exception when others then
  perform set_config('kushe.erp_allowance_capability',coalesce(prior_capability,''),true);
  raise;
end $$;

revoke all on all functions in schema erp_allowance_internal from public,anon;
grant execute on all functions in schema erp_allowance_internal to authenticated;
revoke all on function public.erp_billing_allowance_capability() from public,anon;
revoke all on function public.erp_state_cas_write_v3(bigint,jsonb,text,text) from public,anon;
grant execute on function public.erp_billing_allowance_capability() to authenticated;
grant execute on function public.erp_state_cas_write_v3(bigint,jsonb,text,text) to authenticated;
commit;
