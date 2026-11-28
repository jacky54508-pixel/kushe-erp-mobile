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
    or btrim(value #>> '{}') !~ '^[0-9]+$' then
    raise exception 'ALLOWANCE_MONEY_INVALID' using errcode = '23514';
  end if;
  result := (value #>> '{}')::numeric;
  if result > 45035996273704 then
    raise exception 'ALLOWANCE_MONEY_INVALID' using errcode = '23514';
  end if;
  return result;
end $$;

create or replace function erp_allowance_internal.money_aliases(value jsonb,keys text[],required boolean default true)
returns numeric language plpgsql immutable security invoker set search_path = pg_catalog as $$
declare field text; amount numeric; result numeric;
begin
  foreach field in array keys loop
    if value ? field and (value->field) <> 'null'::jsonb and btrim(value->>field) <> '' then
      amount:=erp_allowance_internal.money(value->field);
      if result is not null and amount<>result then
        raise exception 'ALLOWANCE_ORIGINAL_CHANGED: alias %',field using errcode='23514';
      end if;
      result:=amount;
    end if;
  end loop;
  if result is null and required then
    raise exception 'ALLOWANCE_ORIGINAL_AMOUNT_MISSING' using errcode='23514';
  end if;
  return result;
end $$;

create or replace function erp_allowance_internal.verify_tax(amounts jsonb,basis jsonb)
returns void language plpgsql immutable security invoker set search_path = pg_catalog as $$
declare rate numeric; net numeric; tax numeric; gross numeric; expected_net numeric; expected_tax numeric;
begin
  if jsonb_typeof(basis) is distinct from 'object'
    or basis->'originalTaxVerified' is distinct from 'true'::jsonb
    or jsonb_typeof(basis->'rate') is distinct from 'number'
    or coalesce(basis->>'taxMode','') not in ('含稅','未稅') then
    raise exception 'ALLOWANCE_TAX_BASIS_REVIEW' using errcode='23514';
  end if;
  rate:=(basis->>'rate')::numeric;
  if rate<=0 or rate>100 then raise exception 'ALLOWANCE_TAX_BASIS_REVIEW' using errcode='23514'; end if;
  net:=erp_allowance_internal.money(amounts->'untaxed');
  tax:=erp_allowance_internal.money(amounts->'tax');
  gross:=erp_allowance_internal.money(amounts->'grossTotal');
  expected_net:=case when basis->>'taxMode'='含稅' then round(gross/(1+rate/100)) else net end;
  expected_tax:=case when basis->>'taxMode'='含稅' then gross-expected_net else round(expected_net*rate/100) end;
  if net<>expected_net or tax<>expected_tax or gross<>net+tax then
    raise exception 'ALLOWANCE_TAX_BASIS_REVIEW' using errcode='23514';
  end if;
end $$;

create or replace function erp_allowance_internal.validate_snapshot(snapshot jsonb)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare
  ledger jsonb := snapshot #> '{meta,billingAllowances}';
  event jsonb; allocation jsonb; original jsonb; reduction jsonb;
  billing jsonb; ar jsonb; invoice jsonb; prior jsonb; item jsonb; field text;
  document jsonb; proof jsonb; tax_basis jsonb; expected_amounts jsonb;
  event_ids text[] := '{}'; intent_ids text[] := '{}'; reversal_ids text[] := '{}';
  source_ids text[]; recorded_sources text[]; seen_sources text[] := '{}';
  count_rows integer; total_reduction numeric; received numeric; retained numeric;
  pending numeric; cash numeric; deduction numeric; settlement numeric;
  effective_net numeric; effective_tax numeric; effective_gross numeric;
  effective_retention numeric; effective_receivable numeric;
  r_net numeric; r_tax numeric; r_gross numeric; r_retention numeric; r_receivable numeric;
  source_id text; invoice_basis jsonb; billing_status text; invoice_status text; invoice_number text;
  active_preinvoice_ids text[]; basis_ids text[]; proof_ids text[]; needed_invoice_ids text[];
  prior_position integer; amount numeric;
begin
  if ledger is null then return; end if;
  if jsonb_typeof(ledger) <> 'array' then
    raise exception 'ALLOWANCE_LEDGER_INVALID' using errcode = '23514';
  end if;
  if jsonb_array_length(ledger)>10000 then raise exception 'ALLOWANCE_LEDGER_INVALID' using errcode='23514'; end if;
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
      or coalesce(event->>'sourceSnapshot','') = ''
      or coalesce(event->>'companyId','') = '' or coalesce(event->>'createdBy','') = ''
      or coalesce(event->>'createdAt','') = ''
      or coalesce(event->>'eventType','') not in ('post','reverse')
      or coalesce(event->>'scope','') not in ('billing','external-document')
      or coalesce(event->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(btrim(event->>'reason'),'') = '' or coalesce(btrim(event->>'reference'),'') = ''
      or jsonb_typeof(event->'allocations') is distinct from 'array'
      or jsonb_typeof(event->'sourceBillingIds') is distinct from 'array'
      or jsonb_typeof(event->'invoiceEvidence') is distinct from 'array'
      or jsonb_array_length(event->'allocations') = 0 or jsonb_array_length(event->'allocations')>30 then
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
      prior_position:=array_position(event_ids,event->>'reverseOf');
      if exists(select 1 from jsonb_array_elements(ledger) later
        where later->>'eventType'='post' and later->>'id'=any(event_ids)
          and array_position(event_ids,later->>'id')>prior_position
          and not(later->>'id'=any(reversal_ids))
          and exists(select 1 from jsonb_array_elements_text(later->'sourceBillingIds') s
            where (prior->'sourceBillingIds') ? s)) then
        raise exception 'ALLOWANCE_REVERSAL_DEPENDENCY' using errcode='23514';
      end if;
      reversal_ids := array_append(reversal_ids,event->>'reverseOf');
    elsif coalesce(event->>'reverseOf','') <> '' then
      raise exception 'ALLOWANCE_REVERSAL_INVALID' using errcode = '23514';
    end if;
    event_ids := array_append(event_ids,event->>'id');
    intent_ids := array_append(intent_ids,event->>'idempotencyKey');
    source_ids := '{}'; total_reduction := 0; needed_invoice_ids:='{}'; proof_ids:='{}';
    for allocation in select value from jsonb_array_elements(event->'allocations') loop
      source_id := allocation->>'billingId'; original := allocation->'original'; reduction := allocation->'reductions';
      if coalesce(source_id,'') = '' or source_id = any(source_ids)
        or coalesce(allocation->>'receivableId','')='' or coalesce(allocation->>'customerId','')=''
        or coalesce(allocation->>'projectId','')=''
        or jsonb_typeof(original) is distinct from 'object' or jsonb_typeof(reduction) is distinct from 'object'
        or coalesce(allocation->>'invoiceStage','') not in ('no_invoice','preinvoice','postinvoice') then
        raise exception 'ALLOWANCE_SOURCE_INVALID' using errcode = '23514';
      end if;
      if (select count(*) from jsonb_object_keys(original))<>5
        or (select count(*) from jsonb_object_keys(reduction))<>5 then
        raise exception 'ALLOWANCE_ALLOCATION_INVALID' using errcode='23514';
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
      if count_rows <> 1 or coalesce(ar->>'billingId','')<>'' and ar->>'billingId' is distinct from source_id
        or coalesce(billing->>'receivableId','')<>'' and billing->>'receivableId' is distinct from ar->>'id'
        or coalesce(billing->>'customer','') is distinct from coalesce(allocation->>'customerId','')
        or coalesce(billing->>'project','') is distinct from coalesce(allocation->>'projectId','')
        or coalesce(billing->>'number','') is distinct from coalesce(allocation->>'billingNo','') then
        raise exception 'ALLOWANCE_SOURCE_LINK_INVALID' using errcode = '23514';
      end if;
      select count(*) into count_rows from jsonb_array_elements(snapshot->'receivables') candidate
        where candidate->>'billingId'=source_id
          or (coalesce(billing->>'receivableId','')<>'' and candidate->>'id'=billing->>'receivableId')
          or (coalesce(billing->>'number','')<>'' and candidate->>'sourceNo'=billing->>'number');
      if count_rows<>1 then raise exception 'ALLOWANCE_SOURCE_LINK_INVALID' using errcode='23514'; end if;
      foreach field in array array['customer','project'] loop
        if coalesce(ar->>field,'')<>'' and (ar->>field) is distinct from (billing->>field) then
          raise exception 'ALLOWANCE_SOURCE_LINK_INVALID' using errcode='23514';
        end if;
      end loop;
      if erp_allowance_internal.money_aliases(billing,array['preTaxAmount','amount']) <> erp_allowance_internal.money(original->'untaxed')
        or erp_allowance_internal.money_aliases(billing,array['taxAmount','tax']) <> erp_allowance_internal.money(original->'tax')
        or erp_allowance_internal.money_aliases(billing,array['grossTotal','taxIncludedAmount']) <> erp_allowance_internal.money(original->'grossTotal')
        or erp_allowance_internal.money_aliases(billing,array['retentionAmount','retention']) <> erp_allowance_internal.money(original->'retention')
        or erp_allowance_internal.money(billing->'total') <> erp_allowance_internal.money(original->'receivable')
        or erp_allowance_internal.money(ar->'amount') <> erp_allowance_internal.money(original->'receivable')
        or erp_allowance_internal.money_aliases(ar,array['retentionAmount','retention'],false) <> erp_allowance_internal.money(original->'retention')
        or erp_allowance_internal.money_aliases(ar,array['untaxedAmount','preTaxAmount'],false) <> erp_allowance_internal.money(original->'untaxed')
        or erp_allowance_internal.money_aliases(ar,array['taxAmount','tax'],false) <> erp_allowance_internal.money(original->'tax')
        or erp_allowance_internal.money_aliases(ar,array['grossTotal','taxIncludedAmount'],false) <> erp_allowance_internal.money(original->'grossTotal') then
        raise exception 'ALLOWANCE_ORIGINAL_CHANGED' using errcode = '23514';
      end if;
      billing_status:=case when billing->>'invoiceStatus' in ('no_invoice','invoice_pending','invoiced') then billing->>'invoiceStatus'
        when coalesce(btrim(billing->>'invoiceNo'),'')<>'' then 'invoiced'
        when billing->'hasInvoice'='false'::jsonb then 'no_invoice' else 'invoice_pending' end;
      if allocation->>'invoiceStage'='no_invoice' then
        if billing_status<>'no_invoice' or erp_allowance_internal.money(original->'tax')<>0
          or erp_allowance_internal.money(reduction->'tax')<>0 or allocation->'taxBasis' is distinct from 'null'::jsonb then
          raise exception 'ALLOWANCE_INVOICE_STAGE_INVALID' using errcode='23514';
        end if;
      else
        select count(*),jsonb_agg(value)->0 into count_rows,invoice from jsonb_array_elements(snapshot->'invoices')
          where value->>'id'=allocation->>'invoiceId';
        if count_rows<>1 or billing_status='no_invoice'
          or (coalesce(invoice->>'billingId','')<>'' and invoice->>'billingId' is distinct from source_id)
          or (invoice->>'sourceType'='billing' and coalesce(invoice->>'sourceId','')<>'' and invoice->>'sourceId' is distinct from source_id)
          or (coalesce(invoice->>'invoiceType','')<>'' and invoice->>'invoiceType'<>'output')
          or coalesce(invoice->>'type','') like '%進項%' then
          raise exception 'ALLOWANCE_INVOICE_INVALID' using errcode='23514';
        end if;
        select count(*) into count_rows from jsonb_array_elements(snapshot->'invoices') candidate
          where candidate->>'billingId'=source_id or candidate->>'sourceType'='billing' and candidate->>'sourceId'=source_id
            or (coalesce(candidate->>'billingId','')='' and coalesce(candidate->>'sourceId','')=''
              and candidate->>'sourceNo'=billing->>'number' and coalesce(candidate->>'note','') ~ '請款單|新版請款');
        if count_rows<>1 then raise exception 'ALLOWANCE_INVOICE_INVALID' using errcode='23514'; end if;
        invoice_number:=coalesce(nullif(btrim(invoice->>'invoiceNumber'),''),btrim(invoice->>'number'),'');
        invoice_status:=case when lower(coalesce(invoice->>'status','')) in ('void','作廢','取消') then 'void'
          when lower(coalesce(invoice->>'status','')) in ('issued','invoiced','已開票','已開發票') or invoice_number<>'' then 'issued' else 'pending' end;
        if invoice_status='void' or (billing_status='invoiced' and (invoice_status<>'issued' or invoice_number=''))
          or (billing_status='invoice_pending' and invoice_status<>'pending')
          or exists(select 1 from unnest(array[billing->>'invoiceNo',ar->>'invoiceNo',invoice->>'invoiceNumber',invoice->>'number']) number
            where coalesce(btrim(number),'')<>'' and btrim(number)<>invoice_number) then
          raise exception 'ALLOWANCE_INVOICE_INVALID' using errcode='23514';
        end if;
        if allocation->>'invoiceStage'='preinvoice' then
          tax_basis:=allocation->'taxBasis';
          perform erp_allowance_internal.verify_tax(original,tax_basis);
          if tax_basis->>'taxMode' is distinct from (case when billing->>'taxMode'='含稅' then '含稅' else '未稅' end) then
            raise exception 'ALLOWANCE_TAX_BASIS_REVIEW' using errcode='23514';
          end if;
        else
          invoice_basis:=allocation->'invoiceOriginal';
          if billing_status<>'invoiced' or jsonb_typeof(invoice_basis) is distinct from 'object'
            or allocation->'taxBasis' is distinct from 'null'::jsonb
            or invoice_basis->>'invoiceId' is distinct from invoice->>'id'
            or invoice_number is distinct from invoice_basis->>'invoiceNumber'
            or coalesce(nullif(invoice->>'invoiceDate',''),invoice->>'date','') is distinct from invoice_basis->>'invoiceDate'
            or erp_allowance_internal.money_aliases(invoice,array['netAmount','amount'])<>erp_allowance_internal.money(invoice_basis->'untaxed')
            or erp_allowance_internal.money_aliases(invoice,array['taxAmount','tax'])<>erp_allowance_internal.money(invoice_basis->'tax')
            or erp_allowance_internal.money_aliases(invoice,array['grossAmount','total'])<>erp_allowance_internal.money(invoice_basis->'grossTotal') then
            raise exception 'ALLOWANCE_INVOICE_EVIDENCE_INVALID' using errcode='23514';
          end if;
          if erp_allowance_internal.money(reduction->'grossTotal')>0 then
            needed_invoice_ids:=array_append(needed_invoice_ids,allocation->>'invoiceId');
          end if;
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
    for proof in select value from jsonb_array_elements(event->'invoiceEvidence') loop
      if not(coalesce(proof->>'invoiceId','')=any(needed_invoice_ids))
        or proof->>'invoiceId'=any(proof_ids) or proof->'verified' is distinct from 'true'::jsonb
        or coalesce(btrim(proof->>'voucherReference'),'')='' or coalesce(proof->>'voucherDate','') !~ '^\d{4}-\d{2}-\d{2}$'
        or proof->>'voucherDate'>event->>'date' then
        raise exception 'ALLOWANCE_INVOICE_EVIDENCE_INVALID' using errcode='23514';
      end if;
      perform (proof->>'voucherDate')::date;
      proof_ids:=array_append(proof_ids,proof->>'invoiceId');
    end loop;
    if (select coalesce(array_agg(id order by id),'{}'::text[]) from unnest(proof_ids) id)
      is distinct from (select coalesce(array_agg(id order by id),'{}'::text[]) from unnest(needed_invoice_ids) id) then
      raise exception 'ALLOWANCE_INVOICE_EVIDENCE_INVALID' using errcode='23514';
    end if;
    if jsonb_typeof(coalesce(snapshot#>'{meta,externalBillingDocuments}','[]'::jsonb))<>'array' then
      raise exception 'ALLOWANCE_GROUP_INVALID' using errcode='23514';
    end if;
    if event->>'scope'='external-document' then
      select count(*),jsonb_agg(value)->0 into count_rows,document
        from jsonb_array_elements(coalesce(snapshot#>'{meta,externalBillingDocuments}','[]'::jsonb))
        where value->>'id'=event->>'externalDocumentId';
      if count_rows<>1 or document->>'status' is distinct from 'active'
        or coalesce(document->>'schema','') not in ('kushe-external-billing-group-v1','kushe-external-billing-group-v2')
        or coalesce(event->>'billingId','')<>'' or jsonb_typeof(document->'sourceIds') is distinct from 'array'
        or erp_allowance_internal.money(document->'revision')<>erp_allowance_internal.money(event->'externalDocumentRevision')
        or erp_allowance_internal.money(document->'revision')<1 then
        raise exception 'ALLOWANCE_GROUP_INVALID' using errcode='23514';
      end if;
      select array_agg(value order by value) into basis_ids from jsonb_array_elements_text(document->'sourceIds');
      if basis_ids is distinct from recorded_sources or cardinality(basis_ids)<2 or cardinality(basis_ids)>30 then
        raise exception 'ALLOWANCE_GROUP_INVALID' using errcode='23514';
      end if;
    elsif coalesce(event->>'externalDocumentId','')<>'' or exists(
      select 1 from jsonb_array_elements(coalesce(snapshot#>'{meta,externalBillingDocuments}','[]'::jsonb)) d
        where d->>'status'<>'archived' and (d->'sourceIds') ? source_ids[1]) then
      raise exception 'ALLOWANCE_GROUP_REQUIRED' using errcode='23514';
    end if;
  end loop;
  -- Validate actual settlements against effective limits, including cheque holds.
  -- Bank fees are not settlements; customer deductions and employee cash are.
  foreach source_id in array seen_sources loop
    select value into billing from jsonb_array_elements(snapshot->'billings') where value->>'id'=source_id;
    select a into allocation from jsonb_array_elements(ledger) e,
      lateral jsonb_array_elements(e->'allocations') a where a->>'billingId'=source_id limit 1;
    select value into ar from jsonb_array_elements(snapshot->'receivables') where value->>'id'=allocation->>'receivableId';
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
    -- A pending placeholder retains original amounts. Issuance freezes every
    -- active preinvoice allocation, including a zero share in a merged group.
    billing_status:=case when billing->>'invoiceStatus' in ('no_invoice','invoice_pending','invoiced') then billing->>'invoiceStatus'
      when coalesce(btrim(billing->>'invoiceNo'),'')<>'' then 'invoiced'
      when billing->'hasInvoice'='false'::jsonb then 'no_invoice' else 'invoice_pending' end;
    if billing_status<>'no_invoice' then
      select value into invoice from jsonb_array_elements(snapshot->'invoices') where value->>'id'=allocation->>'invoiceId';
      if invoice is null then raise exception 'ALLOWANCE_INVOICE_INVALID' using errcode='23514'; end if;
      select coalesce(array_agg(e->>'id' order by e->>'id'),'{}'::text[]) into active_preinvoice_ids
        from jsonb_array_elements(ledger) e,lateral jsonb_array_elements(e->'allocations') a
        where e->>'eventType'='post' and not(e->>'id'=any(reversal_ids))
          and a->>'billingId'=source_id and a->>'invoiceStage'='preinvoice';
      invoice_basis:=nullif(invoice->'invoiceIssueBasis','null'::jsonb);
      expected_amounts:=original;
      if billing_status='invoice_pending' then
        if invoice_basis is not null then raise exception 'ALLOWANCE_INVOICE_BASIS_INVALID' using errcode='23514'; end if;
      elsif cardinality(active_preinvoice_ids)>0 or invoice_basis is not null then
        if jsonb_typeof(invoice_basis) is distinct from 'object'
          or invoice_basis->>'schema' is distinct from 'kushe.billing.invoice-issue-basis.v1'
          or invoice_basis->>'billingId' is distinct from source_id
          or invoice_basis->>'invoiceId' is distinct from invoice->>'id'
          or invoice_basis->'original' is distinct from original
          or jsonb_typeof(invoice_basis->'allowanceIds') is distinct from 'array'
          or coalesce(invoice_basis->>'issuedAt','')='' then
          raise exception 'ALLOWANCE_INVOICE_BASIS_INVALID' using errcode='23514';
        end if;
        select coalesce(array_agg(value order by value),'{}'::text[]) into basis_ids
          from jsonb_array_elements_text(invoice_basis->'allowanceIds');
        if cardinality(basis_ids)=0 or basis_ids is distinct from active_preinvoice_ids then
          raise exception 'ALLOWANCE_INVOICE_BASIS_INVALID' using errcode='23514';
        end if;
        tax_basis:=invoice_basis->'taxBasis';
        if exists(select 1 from jsonb_array_elements(ledger) e,lateral jsonb_array_elements(e->'allocations') a
          where e->>'id'=any(active_preinvoice_ids) and a->>'billingId'=source_id
            and a->'taxBasis' is distinct from tax_basis) then
          raise exception 'ALLOWANCE_TAX_BASIS_REVIEW' using errcode='23514';
        end if;
        select jsonb_build_object(
          'untaxed',erp_allowance_internal.money(original->'untaxed')-coalesce(sum(erp_allowance_internal.money(a->'reductions'->'untaxed')),0),
          'tax',erp_allowance_internal.money(original->'tax')-coalesce(sum(erp_allowance_internal.money(a->'reductions'->'tax')),0),
          'grossTotal',erp_allowance_internal.money(original->'grossTotal')-coalesce(sum(erp_allowance_internal.money(a->'reductions'->'grossTotal')),0),
          'retention',erp_allowance_internal.money(original->'retention')-coalesce(sum(erp_allowance_internal.money(a->'reductions'->'retention')),0),
          'receivable',erp_allowance_internal.money(original->'receivable')-coalesce(sum(erp_allowance_internal.money(a->'reductions'->'receivable')),0))
          into expected_amounts from jsonb_array_elements(ledger) e,lateral jsonb_array_elements(e->'allocations') a
          where e->>'id'=any(active_preinvoice_ids) and a->>'billingId'=source_id;
        if invoice_basis->'amounts' is distinct from expected_amounts then
          raise exception 'ALLOWANCE_INVOICE_BASIS_INVALID' using errcode='23514';
        end if;
        perform erp_allowance_internal.verify_tax(original,tax_basis);
        perform erp_allowance_internal.verify_tax(expected_amounts,tax_basis);
      end if;
      if erp_allowance_internal.money_aliases(invoice,array['netAmount','amount'])<>erp_allowance_internal.money(expected_amounts->'untaxed')
        or erp_allowance_internal.money_aliases(invoice,array['taxAmount','tax'])<>erp_allowance_internal.money(expected_amounts->'tax')
        or erp_allowance_internal.money_aliases(invoice,array['grossAmount','total'])<>erp_allowance_internal.money(expected_amounts->'grossTotal') then
        raise exception 'ALLOWANCE_INVOICE_AMOUNT_INVALID' using errcode='23514';
      end if;
      -- Check the effective preinvoice result against its saved tax rule even
      -- before the invoice is issued; current settings never reinterpret it.
      if billing_status='invoice_pending' then
        if (select count(distinct a->'taxBasis') from jsonb_array_elements(ledger) e,lateral jsonb_array_elements(e->'allocations') a
          where e->>'id'=any(active_preinvoice_ids) and a->>'billingId'=source_id)>1 then
          raise exception 'ALLOWANCE_TAX_BASIS_REVIEW' using errcode='23514';
        end if;
        for tax_basis in select a->'taxBasis' from jsonb_array_elements(ledger) e,lateral jsonb_array_elements(e->'allocations') a
          where e->>'id'=any(active_preinvoice_ids) and a->>'billingId'=source_id loop
          perform erp_allowance_internal.verify_tax(jsonb_build_object('untaxed',effective_net,'tax',effective_tax,'grossTotal',effective_gross),tax_basis);
        end loop;
      end if;
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

-- Explicit future-work commission agreements. These helpers only validate the
-- submitted JSON and never rewrite existing business records.
create or replace function erp_allowance_internal.commission_log_content(value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = pg_catalog as $$
declare result jsonb;
begin
  result:=value-array['billingId','billingIds','billingNo','billingStatus','updatedAt'];
  return jsonb_set(result,'{items}',coalesce((select jsonb_agg(item-array['billingId','billingNo','billingStatus'] order by n)
    from jsonb_array_elements(coalesce(value->'items','[]'::jsonb)) with ordinality p(item,n)),'[]'::jsonb));
end $$;

create or replace function erp_allowance_internal.commission_billing_scopes(snapshot jsonb,billing jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare grouped jsonb:='{}'; seen text[]:='{}'; refs jsonb; ref jsonb; matches jsonb;
  first_match jsonb; scope_key text; item_key text; amount numeric; manual jsonb; count_rows integer;
begin
  refs:=coalesce(billing->'sourceItemRefs','[]'::jsonb)||coalesce((select jsonb_agg(scope_ref) from jsonb_array_elements(coalesce(billing->'lines','[]'::jsonb)) line,
    lateral jsonb_array_elements(coalesce(line->'sourceRefs','[]'::jsonb)) scope_ref),'[]'::jsonb);
  for ref in select value from jsonb_array_elements(refs) loop
    select jsonb_agg(jsonb_build_object('groupId',coalesce(nullif(log->>'groupId',''),log->>'id'),'item',item)) into matches
      from jsonb_array_elements(coalesce(snapshot->'dailyLogs','[]'::jsonb)) log,
      lateral jsonb_array_elements(coalesce(log->'items','[]'::jsonb)) with ordinality p(item,n)
      where (coalesce(ref->>'sourceGroupKey','')='' or ref->>'sourceGroupKey'=coalesce(nullif(log->>'groupId',''),log->>'id'))
        and (case when nullif(ref->'sourceItemIndex','null'::jsonb) is not null
          then (ref->>'sourceItemIndex')::numeric=n-1 else coalesce(ref->>'workItemId','')<>'' and ref->>'workItemId'=item->>'workItemId' end);
    if matches is null or (select count(distinct value->>'groupId') from jsonb_array_elements(matches))<>1
      or (select count(distinct value->'item') from jsonb_array_elements(matches))<>1 then
      raise exception 'COMMISSION_SOURCE_ALLOCATION_UNRESOLVED' using errcode='23514';
    end if;
    first_match:=matches->0;scope_key:='daily:'||(first_match->>'groupId');
    item_key:=scope_key||':'||(first_match#>>'{item,workItemId}');
    if item_key is null then raise exception 'COMMISSION_SOURCE_ALLOCATION_UNRESOLVED' using errcode='23514'; end if;
    if item_key=any(seen) then continue; end if;seen:=array_append(seen,item_key);
    amount:=greatest(0,coalesce((first_match#>>'{item,untaxedSubtotal}')::numeric,0));
    grouped:=jsonb_set(grouped,array[scope_key],to_jsonb(coalesce((grouped->>scope_key)::numeric,0)+amount));
  end loop;
  select count(*),jsonb_agg(value)->0 into count_rows,manual
    from jsonb_array_elements(coalesce(snapshot#>'{meta,commissionAgreements}','[]'::jsonb))
    where value->>'kind'='manual' and (value->'billingIds') ? (billing->>'id');
  if count_rows>0 then
    if count_rows<>1 or grouped<>'{}'::jsonb then raise exception 'COMMISSION_DUPLICATE_SOURCE_CLAIM' using errcode='23514'; end if;
    return jsonb_build_array(jsonb_build_object('scopeKey',manual->>'scopeKey','originalUntaxed',erp_allowance_internal.money_aliases(billing,array['preTaxAmount','amount'])));
  end if;
  for ref in select value from jsonb_array_elements(coalesce(billing->'sourceContractRefs','[]'::jsonb)) loop
    if coalesce(ref->>'contractKey','')='' then raise exception 'COMMISSION_SOURCE_ALLOCATION_UNRESOLVED' using errcode='23514'; end if;
    scope_key:='contract:'||(ref->>'contractKey');amount:=greatest(0,coalesce((ref->>'billingAmount')::numeric,0));
    grouped:=jsonb_set(grouped,array[scope_key],to_jsonb(coalesce((grouped->>scope_key)::numeric,0)+amount));
  end loop;
  if grouped='{}'::jsonb then
    grouped:=jsonb_build_object('billing:'||(billing->>'id')||':remainder',erp_allowance_internal.money_aliases(billing,array['preTaxAmount','amount']));
  end if;
  return (select jsonb_agg(jsonb_build_object('scopeKey',key,'originalUntaxed',round(value::text::numeric)) order by key) from jsonb_each(grouped));
end $$;

create or replace function erp_allowance_internal.commission_unbilled_ceiling(event jsonb,agreement jsonb)
returns numeric language plpgsql security invoker set search_path = pg_catalog as $$
declare frozen jsonb; refs jsonb; result numeric;
begin
  if agreement->>'kind'='manual' then
    return case when jsonb_array_length(agreement->'billingIds')=0 then erp_allowance_internal.money(agreement->'originalUntaxedAmount') else 0 end;
  end if;
  select value->'content' into frozen from jsonb_array_elements(event->'sourceSnapshots') where value#>>'{content,commissionAgreementId}'=agreement->>'id' limit 1;
  if frozen is null then raise exception 'COMMISSION_FINALIZATION_SOURCE_INVALID' using errcode='23514'; end if;
  select coalesce(jsonb_agg(r),'[]'::jsonb) into refs from jsonb_array_elements(event->'billingSnapshots') b,
    lateral jsonb_array_elements(coalesce(b#>'{originalSource,sourceItemRefs}','[]'::jsonb)||coalesce((select jsonb_agg(lr) from jsonb_array_elements(coalesce(b#>'{originalSource,lines}','[]'::jsonb)) l,
      lateral jsonb_array_elements(coalesce(l->'sourceRefs','[]'::jsonb)) lr),'[]'::jsonb)) r;
  select floor(coalesce(sum(greatest(0,(i->>'untaxedSubtotal')::numeric)),0)) into result
    from jsonb_array_elements(frozen->'items') with ordinality p(i,n)
    where not exists(select 1 from jsonb_array_elements(refs) r where
      ((coalesce(r->>'sourceGroupKey','')='' or r->>'sourceGroupKey'=agreement->>'groupId') and coalesce(r->>'workItemId','')<>'' and r->>'workItemId'=i->>'workItemId')
      or (r->>'sourceGroupKey'=agreement->>'groupId' and nullif(r->'sourceItemIndex','null'::jsonb) is not null and (r->>'sourceItemIndex')::numeric=n-1));
  return result;
end $$;

create or replace function erp_allowance_internal.validate_commission_policy(snapshot jsonb,before_snapshot jsonb)
returns boolean language plpgsql security invoker set search_path = pg_catalog as $$
declare
  field text; records jsonb; previous jsonb; entry jsonb; agreement jsonb; person jsonb; lifecycle jsonb;
  agreements jsonb:=coalesce(snapshot#>'{meta,commissionAgreements}','[]'::jsonb);
  finalizations jsonb:=coalesce(snapshot#>'{meta,commissionFinalizations}','[]'::jsonb);
  terms jsonb:=coalesce(snapshot#>'{meta,commissionPaymentTerms}','[]'::jsonb);
  allowances jsonb:=coalesce(snapshot#>'{meta,billingAllowances}','[]'::jsonb);
  log jsonb; original_log jsonb; item jsonb; event jsonb; source jsonb; billing jsonb; result jsonb;
  allocation jsonb; row_value jsonb; row_snapshot jsonb; expected_source jsonb; expected_scopes jsonb;
  participant_ids text[]; agreement_ids text[]:='{}'; scope_ids text[]:='{}'; final_ids text[]:='{}'; intent_ids text[]:='{}'; claimed text[]:='{}';
  term_ids text[]:='{}'; commission_ids text[]:='{}'; expected_ids text[]; actual_ids text[];
  id text; scope_key text; rate numeric; pool numeric; base numeric; allocated numeric; original_amount numeric; effective_amount numeric;
  count_rows integer; before_count integer; row_index integer; history_length integer; policy_present boolean:=false; is_new boolean;
  allowance_prefix jsonb; scope_snapshot jsonb; old_anchor jsonb;
  allowed_bill_keys text[]:=array['id','date','number','customer','project','taxMode','lines','amount','preTaxAmount','tax','taxAmount','grossTotal','taxIncludedAmount','total','retention','retentionAmount','retentionRate','retentionBase','retentionMode','sourceType','sourceItemRefs','sourceContractRefs','receivableId'];
begin
  foreach field in array array['commissionAgreements','commissionFinalizations','commissionPaymentTerms'] loop
    records:=snapshot#>array['meta',field];previous:=before_snapshot#>array['meta',field];
    if (records is not null and jsonb_typeof(records)<>'array') or (previous is not null and jsonb_typeof(previous)<>'array') then
      raise exception 'COMMISSION_POLICY_LEDGER_INVALID' using errcode='23514';
    end if;
    before_count:=coalesce(jsonb_array_length(previous),0);
    if before_count>0 or coalesce(jsonb_array_length(records),0)>0 then policy_present:=true; end if;
    if coalesce(jsonb_array_length(records),0)<before_count or coalesce(jsonb_array_length(records),0)>10000
      or exists(select 1 from jsonb_array_elements(coalesce(previous,'[]'::jsonb)) with ordinality p(value,n)
        where value is distinct from records->((n-1)::integer)) then
      raise exception 'COMMISSION_POLICY_HISTORY_IMMUTABLE' using errcode='23514';
    end if;
    for entry in select value from jsonb_array_elements(coalesce(records,'[]'::jsonb)) with ordinality p(value,n) where n>before_count loop
      if entry->>'createdBy' is distinct from auth.uid()::text or coalesce(entry->>'companyId','')='' or coalesce(entry->>'createdAt','')='' then
        raise exception 'COMMISSION_POLICY_AUTHOR_INVALID' using errcode='42501';
      end if;
    end loop;
  end loop;
  if not policy_present then
    if exists(select 1 from jsonb_array_elements(coalesce(snapshot->'dailyLogs','[]'::jsonb)) d where coalesce(d->>'commissionAgreementId','')<>'' or coalesce(d->>'commissionPolicy','')<>'')
      or exists(select 1 from jsonb_array_elements(coalesce(snapshot->'commissions','[]'::jsonb)) c where coalesce(c->>'commissionAgreementId','')<>'' or c->>'sourceType'='commission-finalization') then
      raise exception 'COMMISSION_POLICY_LEDGER_INVALID' using errcode='23514'; end if;
    return false;
  end if;
  if before_snapshot is null then raise exception 'COMMISSION_POLICY_INITIAL_IMPORT_FORBIDDEN' using errcode='23514'; end if;
  if current_setting('kushe.erp_allowance_capability',true) is distinct from 'billing-allowances-v2' then
    raise exception 'ALLOWANCE_CLIENT_UPGRADE_REQUIRED' using errcode='42501';
  end if;
  foreach field in array array['dailyLogs','commissions','billings','employees','projects'] loop
    if jsonb_typeof(snapshot->field) is distinct from 'array' then raise exception 'COMMISSION_POLICY_COLLECTION_INVALID: %',field using errcode='23514'; end if;
  end loop;
  for agreement in select value from jsonb_array_elements(agreements) loop
    id:=agreement->>'id';scope_key:=agreement->>'scopeKey';
    if agreement->>'schema' is distinct from 'kushe.commission.agreement.v1' or coalesce(id,'')='' or id=any(agreement_ids)
      or coalesce(scope_key,'')='' or scope_key=any(scope_ids) or agreement->>'policy' is distinct from 'discounted-pretax-v1'
      or coalesce(agreement->>'kind','') not in ('daily','manual') or agreement->'futureNewAgreementConfirmed' is distinct from 'true'::jsonb
      or coalesce(btrim(agreement->>'reference'),'')='' or coalesce(btrim(agreement->>'workScope'),'')=''
      or coalesce(agreement->>'projectId','')='' or coalesce(agreement->>'customerId','')=''
      or jsonb_typeof(agreement->'participants') is distinct from 'array' or jsonb_typeof(agreement->'billingIds') is distinct from 'array'
      or coalesce(agreement->>'agreedDate','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(agreement->>'startDate','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(agreement->>'workDate','') !~ '^\d{4}-\d{2}-\d{2}$'
      or (agreement->>'agreedDate')::date<date '2026-11-28' or (agreement->>'startDate')::date<(agreement->>'agreedDate')::date
      or (agreement->>'workDate')::date<(agreement->>'startDate')::date then
      raise exception 'COMMISSION_AGREEMENT_INVALID' using errcode='23514';
    end if;
    perform erp_allowance_internal.money(agreement->'originalUntaxedAmount');
    if scope_key is distinct from (case when agreement->>'kind'='daily' then 'daily:'||(agreement->>'groupId') else 'manual:'||id end)
      or (agreement->>'kind'='daily' and (coalesce(agreement->>'groupId','')='' or jsonb_array_length(agreement->'billingIds')<>0)) then
      raise exception 'COMMISSION_AGREEMENT_SCOPE_INVALID' using errcode='23514';
    end if;
    agreement_ids:=array_append(agreement_ids,id);scope_ids:=array_append(scope_ids,scope_key);participant_ids:='{}';pool:=0;
    for person in select value from jsonb_array_elements(agreement->'participants') loop
      if coalesce(person->>'employeeId','')='' or person->>'employeeId'=any(participant_ids)
        or jsonb_typeof(person->'rate') is distinct from 'number' or coalesce(person->>'agreedDueDate','') !~ '^\d{4}-\d{2}-\d{2}$'
        or (person->>'agreedDueDate')::date<(agreement->>'agreedDate')::date or coalesce(btrim(person->>'paymentTerms'),'')='' then
        raise exception 'COMMISSION_AGREEMENT_PARTICIPANTS_INVALID' using errcode='23514';
      end if;
      rate:=(person->>'rate')::numeric;
      if rate<0 or rate>50 or rate*100<>round(rate*100) then raise exception 'COMMISSION_AGREEMENT_PARTICIPANTS_INVALID' using errcode='23514'; end if;
      participant_ids:=array_append(participant_ids,person->>'employeeId');pool:=pool+rate;
    end loop;
    if pool<>50 then raise exception 'COMMISSION_POOL_NOT_50' using errcode='23514'; end if;
    select value into lifecycle from jsonb_array_elements(finalizations) where (value->'agreementIds') ? id;
    is_new:=not exists(select 1 from jsonb_array_elements(coalesce(before_snapshot#>'{meta,commissionAgreements}','[]'::jsonb)) where value->>'id'=id);
    if agreement->>'kind'='daily' and lifecycle->>'eventType' is distinct from 'cancel' then
      select count(*),jsonb_agg(value)->0 into count_rows,original_log from jsonb_array_elements(snapshot->'dailyLogs') where value->>'commissionAgreementId'=id;
      if count_rows<>cardinality(participant_ids) then raise exception 'COMMISSION_AGREEMENT_SOURCE_INVALID' using errcode='23514'; end if;
      for log in select value from jsonb_array_elements(snapshot->'dailyLogs') where value->>'commissionAgreementId'=id or value->>'groupId'=agreement->>'groupId' loop
        select value into person from jsonb_array_elements(agreement->'participants') where value->>'employeeId'=log->>'employee';
        if person is null or log->>'commissionAgreementId' is distinct from id or log->>'commissionPolicy' is distinct from 'discounted-pretax-v1'
          or log->>'groupId' is distinct from agreement->>'groupId' or log->>'project' is distinct from agreement->>'projectId'
          or log->>'date' is distinct from agreement->>'workDate' or log->'rate' is distinct from person->'rate'
          or erp_allowance_internal.money(log->'commission')<>0 or log->'commissionEnabled'='false'::jsonb
          or log->'items' is distinct from original_log->'items'
          or (is_new and exists(select 1 from jsonb_array_elements(coalesce(before_snapshot->'dailyLogs','[]'::jsonb)) old_log
            where old_log->>'id'=log->>'id' or old_log->>'groupId'=log->>'groupId')) then
          raise exception 'COMMISSION_AGREEMENT_RETROFIT_FORBIDDEN' using errcode='23514';
        end if;
      end loop;
      if (select count(distinct value->>'employee') from jsonb_array_elements(snapshot->'dailyLogs') where value->>'commissionAgreementId'=id)<>cardinality(participant_ids)
        or jsonb_typeof(original_log->'items') is distinct from 'array' or jsonb_array_length(original_log->'items')=0 then
        raise exception 'COMMISSION_AGREEMENT_SOURCE_INVALID' using errcode='23514';
      end if;
    elsif agreement->>'kind'='manual' then
      if coalesce(agreement->>'manualSourceIdentity','')='' or (agreement->>'manualSourceIdentity')::jsonb is distinct from jsonb_build_array(agreement->>'projectId',agreement->>'workDate',lower(regexp_replace(btrim(agreement->>'workScope'),'\s+',' ','g')))
        or (select count(*) from jsonb_array_elements(agreements) a where a->>'kind'='manual' and a->>'manualSourceIdentity'=agreement->>'manualSourceIdentity')<>1 then
        raise exception 'COMMISSION_DUPLICATE_SOURCE_CLAIM' using errcode='23514'; end if;
      for item in select value from jsonb_array_elements(agreement->'billingIds') loop
        select count(*),jsonb_agg(value)->0 into count_rows,billing from jsonb_array_elements(snapshot->'billings') where value->>'id'=item#>>'{}';
        if count_rows<>1 or billing->>'project' is distinct from agreement->>'projectId'
          or billing->>'date'<agreement->>'agreedDate'
          or exists(select 1 from jsonb_array_elements(snapshot->'dailyLogs') d,lateral jsonb_array_elements(coalesce(d->'items','[]'::jsonb)) i where i->>'billingId'=billing->>'id')
          or (select count(*) from jsonb_array_elements(agreements) a where (a->'billingIds') ? (billing->>'id'))<>1
          or (is_new and exists(select 1 from jsonb_array_elements(coalesce(before_snapshot->'commissions','[]'::jsonb)) c
            where c->>'billingId'=billing->>'id' or c->>'sourceId'=billing->>'id' or (coalesce(billing->>'number','')<>'' and c->>'sourceNo'=billing->>'number'))) then
          raise exception 'COMMISSION_DUPLICATE_SOURCE_CLAIM' using errcode='23514';
        end if;
        perform erp_allowance_internal.commission_billing_scopes(snapshot,billing);
      end loop;
    end if;
  end loop;
  for log in select value from jsonb_array_elements(snapshot->'dailyLogs') where coalesce(value->>'commissionAgreementId','')<>'' loop
    if not(log->>'commissionAgreementId'=any(agreement_ids)) then raise exception 'COMMISSION_AGREEMENT_SOURCE_INVALID' using errcode='23514'; end if;
  end loop;
  for event in select value from jsonb_array_elements(finalizations) loop
    if event->>'schema' is distinct from 'kushe.commission.finalization.v1' or coalesce(event->>'id','')='' or event->>'id'=any(final_ids)
      or coalesce(event->>'eventType','') not in ('finalize','cancel') or coalesce(event->>'idempotencyKey','')='' or event->>'idempotencyKey'=any(intent_ids)
      or coalesce(event->>'sourceSnapshot','')='' or coalesce(event->>'intentFingerprint','')=''
      or coalesce(btrim(event->>'reference'),'')='' or coalesce(btrim(event->>'reason'),'')='' or coalesce(event->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'COMMISSION_FINALIZATION_INVALID' using errcode='23514';
    end if;
    perform (event->>'date')::date;
    foreach field in array array['agreementIds','allocations','billingSnapshots','sourceSnapshots','results','commissionRows'] loop
      if jsonb_typeof(event->field) is distinct from 'array' then raise exception 'COMMISSION_FINALIZATION_INVALID' using errcode='23514'; end if;
    end loop;
    if jsonb_array_length(event->'agreementIds')=0 then raise exception 'COMMISSION_FINALIZATION_INVALID' using errcode='23514'; end if;
    final_ids:=array_append(final_ids,event->>'id');intent_ids:=array_append(intent_ids,event->>'idempotencyKey');
    is_new:=not exists(select 1 from jsonb_array_elements(coalesce(before_snapshot#>'{meta,commissionFinalizations}','[]'::jsonb)) where value->>'id'=event->>'id');
    for id in select value from jsonb_array_elements_text(event->'agreementIds') loop
      if not(id=any(agreement_ids)) or id=any(claimed) then raise exception 'COMMISSION_DUPLICATE_SOURCE_CLAIM' using errcode='23514'; end if;
      claimed:=array_append(claimed,id);
    end loop;
    if event->>'eventType'='cancel' then
      if jsonb_array_length(event->'results')<>0 or jsonb_array_length(event->'commissionRows')<>0 or jsonb_array_length(event->'allocations')<>0
        or (is_new and exists(select 1 from jsonb_array_elements(agreements) a where (event->'agreementIds') ? (a->>'id') and jsonb_array_length(a->'billingIds')>0))
        or (is_new and exists(select 1 from jsonb_array_elements(snapshot->'dailyLogs') d,lateral jsonb_array_elements(coalesce(d->'items','[]'::jsonb)) i
          where (event->'agreementIds') ? (d->>'commissionAgreementId') and coalesce(i->>'billingId','')<>'')) then
        raise exception 'COMMISSION_CANCELLATION_INVALID' using errcode='23514';
      end if;
      continue;
    end if;
    if jsonb_array_length(event->'results')<>jsonb_array_length(event->'agreementIds') then raise exception 'COMMISSION_FINALIZATION_INVALID' using errcode='23514'; end if;
    if is_new then
      -- Whole work scopes are finalized exactly once, with every already linked
      -- invoice represented. Future invoice attachment to approved unbilled work
      -- is permitted because this check only applies on the original append.
      expected_ids:='{}';
      for agreement in select value from jsonb_array_elements(agreements) where (event->'agreementIds') ? (value->>'id') loop
        if event->>'date'<agreement->>'workDate' then raise exception 'COMMISSION_FINALIZATION_DATE_INVALID' using errcode='23514'; end if;
        for billing in select value from jsonb_array_elements(snapshot->'billings') loop
          scope_snapshot:=snapshot;
          if not exists(select 1 from jsonb_array_elements(event->'billingSnapshots') bs where bs->>'billingId'=billing->>'id') then
            scope_snapshot:=before_snapshot;
            select value into old_anchor from jsonb_array_elements(coalesce(before_snapshot->'billings','[]'::jsonb)) ob where ob->>'id'=billing->>'id';
            if old_anchor is null then continue; end if;
            billing:=old_anchor;
          end if;
          if (agreement->>'kind'='manual' and (agreement->'billingIds') ? (billing->>'id'))
            or (agreement->>'kind'='daily' and (
              exists(select 1 from jsonb_array_elements(coalesce(scope_snapshot->'dailyLogs','[]'::jsonb)) d,lateral jsonb_array_elements(coalesce(d->'items','[]'::jsonb)) i
                where d->>'commissionAgreementId'=agreement->>'id' and i->>'billingId'=billing->>'id')
              or exists(select 1 from jsonb_array_elements(coalesce(billing->'sourceItemRefs','[]'::jsonb)||coalesce((select jsonb_agg(r) from jsonb_array_elements(coalesce(billing->'lines','[]'::jsonb)) l,lateral jsonb_array_elements(coalesce(l->'sourceRefs','[]'::jsonb)) r),'[]'::jsonb)) r,
                lateral jsonb_array_elements(coalesce(scope_snapshot->'dailyLogs','[]'::jsonb)) d,lateral jsonb_array_elements(coalesce(d->'items','[]'::jsonb)) with ordinality p(i,n)
                where d->>'commissionAgreementId'=agreement->>'id' and (coalesce(r->>'sourceGroupKey','')='' or r->>'sourceGroupKey'=coalesce(nullif(d->>'groupId',''),d->>'id'))
                  and (case when nullif(r->'sourceItemIndex','null'::jsonb) is not null then (r->>'sourceItemIndex')::numeric=n-1 else coalesce(r->>'workItemId','')<>'' and r->>'workItemId'=i->>'workItemId' end)))) then
            if not(billing->>'id'=any(expected_ids)) then expected_ids:=array_append(expected_ids,billing->>'id'); end if;
          end if;
        end loop;
      end loop;
      select coalesce(array_agg(x order by x),'{}') into expected_ids from unnest(expected_ids) x;
      select coalesce(array_agg(value->>'billingId' order by value->>'billingId'),'{}') into actual_ids from jsonb_array_elements(event->'billingSnapshots');
      if actual_ids is distinct from expected_ids then raise exception 'COMMISSION_ALLOCATION_INCOMPLETE' using errcode='23514'; end if;
    end if;
    for source in select value from jsonb_array_elements(event->'sourceSnapshots') loop
      select count(*),jsonb_agg(value)->0 into count_rows,log from jsonb_array_elements(snapshot->'dailyLogs') where value->>'id'=source->>'dailyLogId';
      if count_rows<>1 or not((event->'agreementIds') ? (log->>'commissionAgreementId'))
        or erp_allowance_internal.commission_log_content(log) is distinct from source->'content' then
        raise exception 'COMMISSION_FINALIZED_SOURCE_IMMUTABLE' using errcode='23514';
      end if;
      if is_new then
        select value into old_anchor from jsonb_array_elements(coalesce(before_snapshot->'dailyLogs','[]'::jsonb)) d where d->>'id'=source->>'dailyLogId';
        if old_anchor is not null and erp_allowance_internal.commission_log_content(old_anchor) is distinct from source->'content' then
          raise exception 'COMMISSION_FIRST_SOURCE_CHANGED' using errcode='23514'; end if;
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(snapshot->'dailyLogs') d where (event->'agreementIds') ? (d->>'commissionAgreementId'))<>jsonb_array_length(event->'sourceSnapshots')
      or (select count(distinct value->>'dailyLogId') from jsonb_array_elements(event->'sourceSnapshots'))<>jsonb_array_length(event->'sourceSnapshots') then
      raise exception 'COMMISSION_FINALIZED_SOURCE_IMMUTABLE' using errcode='23514';
    end if;
    if (select count(distinct value->>'billingId') from jsonb_array_elements(event->'billingSnapshots'))<>jsonb_array_length(event->'billingSnapshots') then
      raise exception 'COMMISSION_FINALIZATION_INVALID' using errcode='23514';
    end if;
    for source in select value from jsonb_array_elements(event->'billingSnapshots') loop
      select count(*),jsonb_agg(value)->0 into count_rows,billing from jsonb_array_elements(snapshot->'billings') where value->>'id'=source->>'billingId';
      select jsonb_object_agg(key,value) into expected_source from jsonb_each(billing) where key=any(allowed_bill_keys);
      if count_rows<>1 or expected_source is distinct from source->'originalSource' then raise exception 'COMMISSION_FINALIZED_BILLING_IMMUTABLE' using errcode='23514'; end if;
      if is_new then
        select value into old_anchor from jsonb_array_elements(coalesce(before_snapshot->'billings','[]'::jsonb)) b where b->>'id'=source->>'billingId';
        if old_anchor is not null then
          select jsonb_object_agg(key,value) into expected_source from jsonb_each(old_anchor) where key=any(allowed_bill_keys);
          if expected_source is distinct from source->'originalSource' then raise exception 'COMMISSION_FIRST_SOURCE_CHANGED' using errcode='23514'; end if;
        end if;
      end if;
      original_amount:=erp_allowance_internal.money_aliases(billing,array['preTaxAmount','amount']);
      if erp_allowance_internal.money(source->'originalUntaxed')<>original_amount then raise exception 'COMMISSION_FINALIZATION_BASE_INVALID' using errcode='23514'; end if;
      expected_scopes:=erp_allowance_internal.commission_billing_scopes(snapshot,billing);
      if (select coalesce(jsonb_agg(value order by value->>'scopeKey'),'[]'::jsonb) from jsonb_array_elements(expected_scopes))
        is distinct from (select coalesce(jsonb_agg(value order by value->>'scopeKey'),'[]'::jsonb) from jsonb_array_elements(source->'sourceScopes'))
        or (select sum(erp_allowance_internal.money(value->'originalUntaxed')) from jsonb_array_elements(expected_scopes))<>original_amount then
        raise exception 'COMMISSION_SOURCE_ALLOCATION_UNRESOLVED' using errcode='23514';
      end if;
      select coalesce(array_agg(value order by value),'{}') into actual_ids from jsonb_array_elements_text(source->'allowanceIds');
      if cardinality(actual_ids)<>(select count(distinct value) from jsonb_array_elements_text(source->'allowanceIds')) then raise exception 'COMMISSION_FINALIZATION_BASE_INVALID' using errcode='23514'; end if;
      select original_amount-coalesce(sum(erp_allowance_internal.money(a#>'{reductions,untaxed}')),0) into effective_amount
        from jsonb_array_elements(allowances) e,lateral jsonb_array_elements(e->'allocations') a
        where e->>'eventType'='post' and e->>'id'=any(actual_ids) and a->>'billingId'=billing->>'id';
      if exists(select 1 from unnest(actual_ids) allowed_id where not exists(select 1 from jsonb_array_elements(allowances) e where e->>'eventType'='post' and e->>'id'=allowed_id and (e->'sourceBillingIds') ? (billing->>'id')))
        or effective_amount<0 or effective_amount<>erp_allowance_internal.money(source->'effectiveUntaxed') then raise exception 'COMMISSION_FINALIZATION_BASE_INVALID' using errcode='23514'; end if;
      history_length:=erp_allowance_internal.money(source->'allowanceHistoryLength')::integer;
      if history_length>jsonb_array_length(allowances)
        or (is_new and history_length<coalesce(jsonb_array_length(before_snapshot#>'{meta,billingAllowances}'),0)) then
        raise exception 'COMMISSION_FINALIZATION_STALE' using errcode='23514'; end if;
      select coalesce(jsonb_agg(value order by n),'[]'::jsonb) into allowance_prefix from jsonb_array_elements(allowances) with ordinality p(value,n) where n<=history_length;
      select coalesce(array_agg(e->>'id' order by e->>'id'),'{}') into expected_ids from jsonb_array_elements(allowance_prefix) e
        where e->>'eventType'='post' and (e->'sourceBillingIds') ? (billing->>'id')
          and not exists(select 1 from jsonb_array_elements(allowance_prefix) r where r->>'eventType'='reverse' and r->>'reverseOf'=e->>'id');
      if expected_ids is distinct from actual_ids then raise exception 'COMMISSION_FINALIZATION_STALE' using errcode='23514'; end if;
      if (select count(*) from jsonb_array_elements(event->'allocations') a where a->>'billingId'=billing->>'id')<>jsonb_array_length(expected_scopes)
        or (select coalesce(sum(erp_allowance_internal.money(a->'untaxedAmount')),0) from jsonb_array_elements(event->'allocations') a where a->>'billingId'=billing->>'id')<>effective_amount then
        raise exception 'COMMISSION_ALLOCATION_UNBALANCED' using errcode='23514'; end if;
      for allocation in select value from jsonb_array_elements(event->'allocations') where value->>'billingId'=billing->>'id' loop
        select count(*),jsonb_agg(value)->0 into count_rows,item from jsonb_array_elements(expected_scopes) where value->>'scopeKey'=allocation->>'scopeKey';
        if count_rows<>1 or (select count(*) from jsonb_array_elements(event->'allocations') a where a->>'billingId'=billing->>'id' and a->>'scopeKey'=allocation->>'scopeKey')<>1
          or erp_allowance_internal.money(allocation->'untaxedAmount')>erp_allowance_internal.money(item->'originalUntaxed') then
          raise exception 'COMMISSION_ALLOCATION_INVALID' using errcode='23514'; end if;
        if exists(select 1 from jsonb_array_elements(finalizations) prior,lateral jsonb_array_elements(prior->'allocations') a
          where prior->>'eventType'='finalize' and prior->>'id'=any(final_ids) and prior->>'id'<>event->>'id'
            and a->>'billingId'=billing->>'id' and a->>'scopeKey'=allocation->>'scopeKey'
            and exists(select 1 from jsonb_array_elements(agreements) ag where ag->>'scopeKey'=a->>'scopeKey' and (prior->'agreementIds') ? (ag->>'id'))
            and erp_allowance_internal.money(a->'untaxedAmount')<>erp_allowance_internal.money(allocation->'untaxedAmount')) then
          raise exception 'COMMISSION_FINALIZED_ALLOCATION_IMMUTABLE' using errcode='23514'; end if;
      end loop;
    end loop;
    for allocation in select value from jsonb_array_elements(event->'allocations') loop
      if coalesce(allocation->>'scopeKey','')='' or (coalesce(allocation->>'billingId','')<>'' and not exists(select 1 from jsonb_array_elements(event->'billingSnapshots') s where s->>'billingId'=allocation->>'billingId')) then
        raise exception 'COMMISSION_ALLOCATION_INVALID' using errcode='23514'; end if;
      if coalesce(allocation->>'billingId','')='' then
        select count(*),jsonb_agg(value)->0 into count_rows,agreement from jsonb_array_elements(agreements) a where a->>'scopeKey'=allocation->>'scopeKey' and (event->'agreementIds') ? (a->>'id');
        if count_rows<>1 or coalesce(btrim(allocation->>'approvalReference'),'')='' then raise exception 'COMMISSION_UNBILLED_APPROVAL_REQUIRED' using errcode='23514'; end if;
        original_amount:=erp_allowance_internal.commission_unbilled_ceiling(event,agreement);
        if erp_allowance_internal.money(allocation->'untaxedAmount')>floor(original_amount)
          or (select count(*) from jsonb_array_elements(event->'allocations') a where coalesce(a->>'billingId','')='' and a->>'scopeKey'=allocation->>'scopeKey')<>1 then
          raise exception 'COMMISSION_UNBILLED_BASE_INVALID' using errcode='23514'; end if;
      end if;
    end loop;
    for result in select value from jsonb_array_elements(event->'results') loop
      select value into agreement from jsonb_array_elements(agreements) where value->>'id'=result->>'agreementId';
      if agreement is null or not((event->'agreementIds') ? (agreement->>'id')) or result->>'scopeKey' is distinct from agreement->>'scopeKey'
        or (select count(*) from jsonb_array_elements(event->'results') r where r->>'agreementId'=agreement->>'id')<>1
        or jsonb_typeof(result->'participants') is distinct from 'array'
        or jsonb_array_length(result->'participants')<>jsonb_array_length(agreement->'participants') then raise exception 'COMMISSION_FINALIZATION_INVALID' using errcode='23514'; end if;
      original_amount:=erp_allowance_internal.commission_unbilled_ceiling(event,agreement);
      if original_amount>0 and (select count(*) from jsonb_array_elements(event->'allocations') a where coalesce(a->>'billingId','')='' and a->>'scopeKey'=agreement->>'scopeKey')<>1 then
        raise exception 'COMMISSION_UNBILLED_APPROVAL_REQUIRED' using errcode='23514'; end if;
      base:=erp_allowance_internal.money(result->'base');
      select coalesce(sum(erp_allowance_internal.money(a->'untaxedAmount')),0) into allocated from jsonb_array_elements(event->'allocations') a where a->>'scopeKey'=agreement->>'scopeKey';
      if base<>allocated then raise exception 'COMMISSION_FINALIZATION_BASE_INVALID' using errcode='23514'; end if;
      for person in select value from jsonb_array_elements(result->'participants') loop
        select value into item from jsonb_array_elements(agreement->'participants') where value->>'employeeId'=person->>'employeeId';
        if item is null or (person-array['commission','commissionId']) is distinct from item or erp_allowance_internal.money(person->'commission')<>round(base*(item->>'rate')::numeric/100)
          or (select count(*) from jsonb_array_elements(result->'participants') p where p->>'employeeId'=person->>'employeeId')<>1 then raise exception 'COMMISSION_FINALIZATION_RATE_INVALID' using errcode='23514'; end if;
        select count(*),jsonb_agg(value)->0 into count_rows,row_snapshot from jsonb_array_elements(event->'commissionRows') where value->>'id'=person->>'commissionId';
        select count(*),jsonb_agg(value)->0 into row_index,row_value from jsonb_array_elements(snapshot->'commissions') where value->>'id'=person->>'commissionId';
        if count_rows<>1 or row_index<>1 or row_snapshot is distinct from row_value
          or row_value->>'sourceType' is distinct from 'commission-finalization' or row_value->>'sourceId' is distinct from (event->>'id')||':'||(agreement->>'id')
          or row_value->>'commissionPolicy' is distinct from 'discounted-pretax-v1' or row_value->>'commissionAgreementId' is distinct from agreement->>'id'
          or row_value->>'commissionFinalizationId' is distinct from event->>'id' or row_value->>'employee' is distinct from person->>'employeeId'
          or row_value->>'project' is distinct from agreement->>'projectId' or row_value->>'date' is distinct from agreement->>'workDate'
          or row_value->>'commissionBasis' is distinct from 'preTax' or row_value->>'status' is distinct from '已列入薪資'
          or erp_allowance_internal.money(row_value->'untaxedAmount')<>base or erp_allowance_internal.money(row_value->'commissionBaseAmount')<>base
          or row_value->'rate' is distinct from person->'rate' or row_value->'commission' is distinct from person->'commission'
          or row_value->'paymentTerms' is distinct from jsonb_build_object('mode','agreed-date','dueDate',person->>'agreedDueDate','terms',person->>'paymentTerms','reference',agreement->>'reference')
          or (is_new and exists(select 1 from jsonb_array_elements(coalesce(before_snapshot->'commissions','[]'::jsonb)) c where c->>'id'=row_value->>'id')) then
          raise exception 'COMMISSION_FINALIZED_ROW_IMMUTABLE' using errcode='23514'; end if;
      end loop;
    end loop;
    if jsonb_array_length(event->'commissionRows')<>(select coalesce(sum(jsonb_array_length(r->'participants')),0) from jsonb_array_elements(event->'results') r) then
      raise exception 'COMMISSION_FINALIZATION_INVALID' using errcode='23514'; end if;
  end loop;
  for row_value in select value from jsonb_array_elements(snapshot->'commissions') where value->>'sourceType'='commission-finalization' or coalesce(value->>'commissionAgreementId','')<>'' loop
    if (select count(*) from jsonb_array_elements(finalizations) e,lateral jsonb_array_elements(e->'commissionRows') c where c=row_value)<>1 then
      raise exception 'COMMISSION_FINALIZED_ROW_IMMUTABLE' using errcode='23514'; end if;
  end loop;
  for entry in select value from jsonb_array_elements(terms) loop
    if entry->>'schema' is distinct from 'kushe.commission.payment-terms.v1' or coalesce(entry->>'id','')='' or entry->>'id'=any(term_ids)
      or coalesce(entry->>'commissionId','')='' or entry->>'commissionId'=any(commission_ids) or coalesce(entry->>'mode','') not in ('agreed-date','effective-collection')
      or coalesce(btrim(entry->>'reference'),'')='' or coalesce(entry->>'allowanceEventId','')='' then raise exception 'COMMISSION_PAYMENT_TERMS_INVALID' using errcode='23514'; end if;
    if (entry->>'mode'='agreed-date' and coalesce(entry->>'agreedDueDate','') !~ '^\d{4}-\d{2}-\d{2}$')
      or (entry->>'mode'='effective-collection' and coalesce(entry->>'agreedDueDate','')<>'') then raise exception 'COMMISSION_PAYMENT_TERMS_INVALID' using errcode='23514'; end if;
    if entry->>'mode'='agreed-date' then perform (entry->>'agreedDueDate')::date; end if;
    term_ids:=array_append(term_ids,entry->>'id');commission_ids:=array_append(commission_ids,entry->>'commissionId');
    select count(*),jsonb_agg(value)->0 into count_rows,row_value from jsonb_array_elements(snapshot->'commissions') where value->>'id'=entry->>'commissionId';
    if count_rows<>1 or row_value is distinct from entry->'commissionSnapshot' or coalesce(row_value->>'commissionAgreementId','')<>''
      or not exists(select 1 from jsonb_array_elements(allowances) e where e->>'id'=entry->>'allowanceEventId' and (e->'commissionPaymentTermIds') ? (entry->>'id')) then
      raise exception 'COMMISSION_PAYMENT_TERMS_SOURCE_INVALID' using errcode='23514'; end if;
    if not exists(select 1 from jsonb_array_elements(coalesce(before_snapshot#>'{meta,commissionPaymentTerms}','[]'::jsonb)) p where p->>'id'=entry->>'id')
      and not exists(select 1 from jsonb_array_elements(coalesce(before_snapshot->'commissions','[]'::jsonb)) c where c=row_value) then
      raise exception 'COMMISSION_LEGACY_AMOUNT_CHANGED' using errcode='23514'; end if;
  end loop;
  for event in select value from jsonb_array_elements(allowances) loop
    if event ? 'commissionPaymentTermIds' and (jsonb_typeof(event->'commissionPaymentTermIds')<>'array' or exists(select 1 from jsonb_array_elements_text(event->'commissionPaymentTermIds') p where not(p=any(term_ids)))) then
      raise exception 'COMMISSION_PAYMENT_TERMS_INVALID' using errcode='23514'; end if;
  end loop;
  return true;
end $$;

create or replace function erp_allowance_internal.guard_state_write()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare before_ledger jsonb; after_ledger jsonb; before_count integer; after_count integer;
  event jsonb; allocation jsonb; old_source jsonb; new_source jsonb; field text;
  old_ar jsonb; new_ar jsonb; old_invoice jsonb; new_invoice jsonb;
  old_document jsonb; new_document jsonb; count_rows integer; old_invoice_status text;
  commission_row jsonb; payment_term jsonb; linked_log_ids text[]; linked_bill jsonb;
  checked_sources text[]:='{}'; checked_documents text[]:='{}'; old_tax_rate numeric; policy_present boolean;
begin
  policy_present:=erp_allowance_internal.validate_commission_policy(new.data,case when tg_op='UPDATE' then old.data else null end);
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
  if current_setting('kushe.erp_allowance_capability',true) is distinct from 'billing-allowances-v2' then
    raise exception 'ALLOWANCE_CLIENT_UPGRADE_REQUIRED' using errcode = '42501';
  end if;
  if tg_op='INSERT' or after_count<before_count or after_count>before_count+1
    or exists(select 1 from jsonb_array_elements(before_ledger) with ordinality p(value,n)
      where value is distinct from after_ledger->((n-1)::integer)) then
    raise exception 'ALLOWANCE_HISTORY_IMMUTABLE' using errcode = '23514';
  end if;
  perform erp_allowance_internal.validate_snapshot(new.data);
  -- A cloud CAS aggregates independently atomic local transactions. A receipt
  -- or valid pending-invoice issuance may follow a post before the debounce
  -- uploads it. Preserve source anchors, not the entire intervening snapshot.
  -- Exact post/reversal preservation of every unrelated business collection is
  -- enforced by the Store transaction and its byte-for-byte acceptance tests.
  if after_count>before_count then
    event:=after_ledger->(after_count-1);
    if event->>'createdBy' is distinct from auth.uid()::text then
      raise exception 'ALLOWANCE_AUTHOR_MISMATCH' using errcode = '42501';
    end if;
    -- An allowance preserves legacy amounts and requires explicit verified
    -- payment terms for affected old commissions. A customer's discounted
    -- receivable is never silently re-used as a new wage gate.
    for allocation in select value from jsonb_array_elements(event->'allocations') where erp_allowance_internal.money(value#>'{reductions,grossTotal}')>0 loop
      select value into linked_bill from jsonb_array_elements(new.data->'billings') where value->>'id'=allocation->>'billingId';
      select coalesce(array_agg(d->>'id'),'{}') into linked_log_ids from jsonb_array_elements(coalesce(new.data->'dailyLogs','[]'::jsonb)) d
        where d->>'billingId'=linked_bill->>'id'
          or exists(select 1 from jsonb_array_elements(coalesce(d->'items','[]'::jsonb)) i where i->>'billingId'=linked_bill->>'id')
          or exists(select 1 from jsonb_array_elements(coalesce(linked_bill->'sourceItemRefs','[]'::jsonb)||coalesce((select jsonb_agg(r) from jsonb_array_elements(coalesce(linked_bill->'lines','[]'::jsonb)) l,lateral jsonb_array_elements(coalesce(l->'sourceRefs','[]'::jsonb)) r),'[]'::jsonb)) r
            where r->>'sourceGroupKey'=d->>'groupId' or r->>'sourceId'=d->>'id' or r->>'dailyLogId'=d->>'id' or r->>'logId'=d->>'id' or (r->'dailyLogIds') ? (d->>'id'));
      for commission_row in select value from jsonb_array_elements(coalesce(new.data->'commissions','[]'::jsonb)) c
        where coalesce((c->>'commission')::numeric,0)>0 and coalesce(c->>'commissionPolicy','')<>'discounted-pretax-v1'
          and (c->>'billingId'=linked_bill->>'id' or (c->>'sourceType' is distinct from 'daily-log' and c->>'sourceId'=linked_bill->>'id')
            or (c->>'sourceType'='daily-log' and c->>'sourceId'=any(linked_log_ids))
            or (coalesce(linked_bill->>'number','')<>'' and c->>'sourceNo'=linked_bill->>'number')) loop
        select count(*),jsonb_agg(value)->0 into count_rows,payment_term from jsonb_array_elements(coalesce(new.data#>'{meta,commissionPaymentTerms}','[]'::jsonb)) where value->>'commissionId'=commission_row->>'id';
        if count_rows<>1 or not(coalesce(event->'commissionPaymentTermIds','[]'::jsonb) ? (payment_term->>'id')) then
          raise exception 'COMMISSION_PAYMENT_TERMS_REQUIRED' using errcode='23514'; end if;
      end loop;
      if exists(select 1 from jsonb_array_elements(coalesce(new.data->'dailyLogs','[]'::jsonb)) d
        where d->>'id'=any(linked_log_ids) and coalesce(d->>'commissionPolicy','')<>'discounted-pretax-v1' and d->'commissionEnabled' is distinct from 'false'::jsonb
          and (coalesce((d->>'commission')::numeric,0)>0 or coalesce((d->>'rate')::numeric,0)>0 or coalesce((d->>'commissionRate')::numeric,0)>0)
          and not exists(select 1 from jsonb_array_elements(coalesce(new.data->'commissions','[]'::jsonb)) c where c->>'sourceType'='daily-log' and c->>'sourceId'=d->>'id')) then
        raise exception 'COMMISSION_POLICY_REVIEW' using errcode='23514'; end if;
    end loop;
    if event->>'eventType'='reverse' and exists(select 1 from jsonb_array_elements(new.data->'invoices') i
      where coalesce(i#>'{invoiceIssueBasis,allowanceIds}','[]'::jsonb) ? (event->>'reverseOf')) then
      raise exception 'ALLOWANCE_INVOICE_CORRECTION_REQUIRED' using errcode = '23514';
    end if;
    if event->>'eventType'='post' then
      for allocation in select value from jsonb_array_elements(event->'allocations') loop
        if allocation->>'invoiceStage'='preinvoice' then
          old_tax_rate:=coalesce(nullif((old.data#>>'{settings,defaultTax}')::numeric,0),5);
          if (allocation#>>'{taxBasis,rate}')::numeric<>old_tax_rate then
            raise exception 'ALLOWANCE_TAX_BASIS_REVIEW' using errcode='23514';
          end if;
        end if;
      end loop;
      if event->>'scope'='billing' and exists(select 1 from jsonb_array_elements(coalesce(old.data#>'{meta,externalBillingDocuments}','[]'::jsonb)) d
        where d->>'status'<>'archived' and (d->'sourceIds') ? (event->>'billingId')) then
        raise exception 'ALLOWANCE_GROUP_REQUIRED' using errcode='23514';
      end if;
    end if;
  end if;
  -- Include the first newly posted event: its original anchors must already
  -- exist in OLD, so a first-post rewrite cannot redefine its own evidence.
  for allocation in select a from jsonb_array_elements(after_ledger) e,
    lateral jsonb_array_elements(e->'allocations') a loop
    if allocation->>'billingId'=any(checked_sources) then continue; end if;
    checked_sources:=array_append(checked_sources,allocation->>'billingId');
    select count(*),jsonb_agg(value)->0 into count_rows,old_source
      from jsonb_array_elements(old.data->'billings') where value->>'id'=allocation->>'billingId';
    if count_rows<>1 then raise exception 'ALLOWANCE_ORIGINAL_MISSING' using errcode='23514'; end if;
    select value into new_source from jsonb_array_elements(new.data->'billings') where value->>'id'=allocation->>'billingId';
    foreach field in array array['id','number','date','customer','project','receivableId','sourceType','sourceBatchIds','sourceItemRefs','sourceContractRefs','lines','amount','preTaxAmount','tax','taxAmount','taxIncludedAmount','grossTotal','retention','retentionAmount','retentionRate','retentionEnabled','retentionMode','retentionBase','total','taxMode'] loop
      if old_source->field is distinct from new_source->field then
        raise exception 'ALLOWANCE_ORIGINAL_CHANGED: %',field using errcode = '23514';
      end if;
    end loop;
    select count(*),jsonb_agg(value)->0 into count_rows,old_ar
      from jsonb_array_elements(old.data->'receivables') where value->>'id'=allocation->>'receivableId';
    if count_rows<>1 then raise exception 'ALLOWANCE_ORIGINAL_MISSING' using errcode='23514'; end if;
    select value into new_ar from jsonb_array_elements(new.data->'receivables') where value->>'id'=allocation->>'receivableId';
    foreach field in array array['id','billingId','sourceNo','date','customer','customerId','project','projectId','amount','untaxedAmount','preTaxAmount','tax','taxAmount','taxIncludedAmount','grossTotal','retention','retentionAmount','retentionRate','retentionEnabled','retentionBase','taxMode','legacyReceived','legacyRetentionReceived'] loop
      if (old_ar->field) is distinct from (new_ar->field) then
        raise exception 'ALLOWANCE_ORIGINAL_CHANGED: ar.%',field using errcode='23514';
      end if;
    end loop;
    if coalesce(allocation->>'invoiceId','')<>'' then
      select count(*),jsonb_agg(value)->0 into count_rows,old_invoice
        from jsonb_array_elements(old.data->'invoices') where value->>'id'=allocation->>'invoiceId';
      if count_rows<>1 then raise exception 'ALLOWANCE_ORIGINAL_INVOICE_MISSING' using errcode='23514'; end if;
      select count(*),jsonb_agg(value)->0 into count_rows,new_invoice
        from jsonb_array_elements(new.data->'invoices') where value->>'id'=allocation->>'invoiceId';
      if count_rows<>1 then raise exception 'ALLOWANCE_ORIGINAL_INVOICE_MISSING' using errcode='23514'; end if;
      old_invoice_status:=case when lower(coalesce(old_invoice->>'status','')) in ('void','作廢','取消') then 'void'
        when lower(coalesce(old_invoice->>'status','')) in ('issued','invoiced','已開票','已開發票')
          or coalesce(nullif(btrim(old_invoice->>'invoiceNumber'),''),btrim(old_invoice->>'number'),'')<>'' then 'issued' else 'pending' end;
      if (old_invoice_status='issued' or nullif(old_invoice->'invoiceIssueBasis','null'::jsonb) is not null)
        and old_invoice is distinct from new_invoice then
        raise exception 'ALLOWANCE_ISSUED_INVOICE_IMMUTABLE' using errcode='23514';
      end if;
    end if;
  end loop;
  for event in select value from jsonb_array_elements(after_ledger) where value->>'scope'='external-document' loop
    if event->>'externalDocumentId'=any(checked_documents) then continue; end if;
    checked_documents:=array_append(checked_documents,event->>'externalDocumentId');
    select count(*),jsonb_agg(value)->0 into count_rows,old_document
      from jsonb_array_elements(coalesce(old.data#>'{meta,externalBillingDocuments}','[]'::jsonb))
      where value->>'id'=event->>'externalDocumentId';
    if count_rows<>1 then raise exception 'ALLOWANCE_GROUP_INVALID' using errcode='23514'; end if;
    select value into new_document from jsonb_array_elements(coalesce(new.data#>'{meta,externalBillingDocuments}','[]'::jsonb))
      where value->>'id'=event->>'externalDocumentId';
    if old_document is distinct from new_document then raise exception 'ALLOWANCE_GROUP_IMMUTABLE' using errcode='23514'; end if;
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
  return jsonb_build_object('capability','billing-allowances-v2','schema','kushe.billing.allowances.v1','guardVersion',2,
    'enabled',exists(select 1 from pg_trigger where tgrelid='public.erp_states'::regclass
      and tgname='erp_states_allowance_before_write' and tgenabled in ('O','A') and not tgisinternal)
      and to_regprocedure('public.erp_state_cas_write_v3(bigint,jsonb,text,text)') is not null
      and to_regprocedure('erp_allowance_internal.validate_commission_policy(jsonb,jsonb)') is not null);
end $$;

create or replace function public.erp_state_cas_write_v3(expected_sync_version bigint,new_data jsonb,writer_mode text,client_capability text)
returns table(status text,sync_version bigint,updated_at timestamptz,last_writer_mode text,last_base_sync_version bigint)
language plpgsql security invoker set search_path = pg_catalog as $$
declare prior_capability text;
begin
  if auth.uid() is null or (auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if client_capability is distinct from 'billing-allowances-v2' then
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
