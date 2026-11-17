-- P40-16S DISPOSABLE CI LAB ONLY, not a Supabase migration.
-- Single imaginary construction group; every ID begins SYNTH-.
-- Do NOT execute on existing real data or expose the SECURITY DEFINER RPC.
CREATE ROLE p40s_clerk LOGIN PASSWORD 'synthetic-s-clerk-ci' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE p40s_public LOGIN PASSWORD 'synthetic-s-viewer-ci' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE SCHEMA p40s_lab AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA p40s_lab FROM PUBLIC;

CREATE TABLE p40s_lab.fake_group (
 id text PRIMARY KEY CHECK(id='SYNTH-GROUP-1'),
 display_source text NOT NULL CHECK(display_source IN ('SYNTH-L','SYNTH-M')),
 original_untaxed integer NOT NULL DEFAULT 602000 CHECK(original_untaxed=602000),
 original_tax integer NOT NULL DEFAULT 30100 CHECK(original_tax=30100),
 original_gross integer NOT NULL DEFAULT 632100 CHECK(original_gross=632100),
 bank_in integer NOT NULL DEFAULT 0 CHECK(bank_in>=0),
 sync_version bigint NOT NULL DEFAULT 1 CHECK(sync_version>=1),
 ledger_version bigint NOT NULL DEFAULT 0 CHECK(ledger_version>=0),
 CHECK(original_untaxed+original_tax=original_gross)
);
CREATE TABLE p40s_lab.fake_sources (
 id text PRIMARY KEY CHECK(id IN ('SYNTH-L','SYNTH-M')),
 group_id text NOT NULL REFERENCES p40s_lab.fake_group(id),
 area text NOT NULL CHECK(area IN ('SYNTH-L-Area','SYNTH-M-Area')),
 original_untaxed integer NOT NULL CHECK(original_untaxed>0),
 original_tax integer NOT NULL CHECK(original_tax>0),
 original_gross integer NOT NULL CHECK(original_gross>0),
 CHECK(original_untaxed+original_tax=original_gross)
);
CREATE TABLE p40s_lab.fake_invoices (
 id text PRIMARY KEY CHECK(id LIKE 'SYNTH-INV-%'),
 source_id text NOT NULL UNIQUE REFERENCES p40s_lab.fake_sources(id),
 invoice_number text NOT NULL UNIQUE CHECK(invoice_number LIKE 'SYNTH-INVOICE-%'),
 invoice_month text NOT NULL CHECK(invoice_month IN ('2026-08','2026-10')),
 original_gross integer NOT NULL CHECK(original_gross>0)
);
CREATE TABLE p40s_lab.fake_source_balance (
 source_id text PRIMARY KEY REFERENCES p40s_lab.fake_sources(id),
 credit_untaxed integer NOT NULL DEFAULT 0 CHECK(credit_untaxed>=0),
 credit_tax integer NOT NULL DEFAULT 0 CHECK(credit_tax>=0),
 retention_hold integer NOT NULL DEFAULT 0 CHECK(retention_hold>=0),
 ar_received integer NOT NULL DEFAULT 0 CHECK(ar_received>=0),
 retention_received integer NOT NULL DEFAULT 0 CHECK(retention_received>=0),
 commission_accrued integer NOT NULL DEFAULT 0 CHECK(commission_accrued>=0)
);
CREATE TABLE p40s_lab.fake_paid_salary_history (
 id text PRIMARY KEY CHECK(id='SYNTH-HISTORIC-PAID-SALARY'),
 source_employee text NOT NULL CHECK(source_employee LIKE 'SYNTH-EMP-%'),
 amount integer NOT NULL CHECK(amount>0)
);
CREATE TABLE p40s_lab.fake_event (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 operation_key text NOT NULL UNIQUE CHECK(operation_key LIKE 'SYNTH-%'),
 source_id text NOT NULL REFERENCES p40s_lab.fake_sources(id),
 invoice_id text NOT NULL REFERENCES p40s_lab.fake_invoices(id),
 kind text NOT NULL CHECK(kind IN ('CREDIT','RETENTION_SET','AR_RECEIPT',
            'RETENTION_RECEIPT','COMMISSION_ACCRUAL')),
 amount integer NOT NULL CHECK(amount>0),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO p40s_lab.fake_group(id,display_source) VALUES('SYNTH-GROUP-1','SYNTH-M');
INSERT INTO p40s_lab.fake_sources(id,group_id,area,original_untaxed,original_tax,original_gross)
 VALUES ('SYNTH-L','SYNTH-GROUP-1','SYNTH-L-Area',380952,19048,400000),
        ('SYNTH-M','SYNTH-GROUP-1','SYNTH-M-Area',221048,11052,232100);
INSERT INTO p40s_lab.fake_invoices(id,source_id,invoice_number,invoice_month,original_gross)
 VALUES ('SYNTH-INV-AUG','SYNTH-L','SYNTH-INVOICE-202608','2026-08',400000),
        ('SYNTH-INV-OCT','SYNTH-M','SYNTH-INVOICE-202610','2026-10',232100);
INSERT INTO p40s_lab.fake_source_balance(source_id) VALUES('SYNTH-L'),('SYNTH-M');
INSERT INTO p40s_lab.fake_paid_salary_history(id,source_employee,amount)
 VALUES('SYNTH-HISTORIC-PAID-SALARY','SYNTH-EMP-A',4000);

CREATE FUNCTION p40s_lab.reject_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'HISTORIC_SOURCE_IMMUTABLE';END $$;
CREATE TRIGGER source_immutable BEFORE UPDATE OR DELETE ON p40s_lab.fake_sources
 FOR EACH ROW EXECUTE FUNCTION p40s_lab.reject_mutation();
CREATE TRIGGER invoice_immutable BEFORE UPDATE OR DELETE ON p40s_lab.fake_invoices
 FOR EACH ROW EXECUTE FUNCTION p40s_lab.reject_mutation();
CREATE TRIGGER salary_immutable BEFORE UPDATE OR DELETE ON p40s_lab.fake_paid_salary_history
 FOR EACH ROW EXECUTE FUNCTION p40s_lab.reject_mutation();
CREATE TRIGGER event_immutable BEFORE UPDATE OR DELETE ON p40s_lab.fake_event
 FOR EACH ROW EXECUTE FUNCTION p40s_lab.reject_mutation();

-- Only this tiny SAFE public projection is available to the fake viewer.
-- Original grouped source IDs, 8/10 invoice details, credit-note evidence,
-- receipt allocations, and historical salary MUST stay internal.
CREATE FUNCTION p40s_lab.public_document(p_group text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE h p40s_lab.fake_group%ROWTYPE;
        selected p40s_lab.fake_sources%ROWTYPE;
BEGIN
 IF p_group IS DISTINCT FROM 'SYNTH-GROUP-1' THEN
   RAISE EXCEPTION 'UNSUPPORTED_SYNTHETIC_GROUP';END IF;
 SELECT * INTO STRICT h FROM p40s_lab.fake_group WHERE id=p_group;
 SELECT * INTO STRICT selected FROM p40s_lab.fake_sources WHERE id=h.display_source
    AND group_id=h.id;
 RETURN jsonb_build_object(
   'schema','p40s-customer-pdf-projection-v1',
   'project',selected.area,
   'mergedBillingProjects',jsonb_build_array(selected.area),
   'taxMode','未稅',
   'lines',jsonb_build_array(jsonb_build_object(
     'house','', 'item','SYNTHETIC-CONSTRUCTION',
     'unit','式','qty',1,'price',h.original_untaxed,
     'amount',h.original_untaxed)),
   'untaxed',h.original_untaxed,
   'tax',h.original_tax,
   'grossTotal',h.original_gross,
   'invoiceStatus','invoice_pending',
   'publicNote',''
 );
END $$;

-- Only admin changes selected public target; unissued original invoices remain
-- untouched. Selection is NOT an automatic financial adjustment.
CREATE FUNCTION p40s_lab.admin_choose_target(
 p_key text,p_target text,p_sync bigint,p_ledger bigint
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE g p40s_lab.fake_group%ROWTYPE;
BEGIN
 IF p_key IS NULL OR p_key NOT LIKE 'SYNTH-%'
    OR p_target NOT IN ('SYNTH-L','SYNTH-M') THEN
    RAISE EXCEPTION 'TARGET_NOT_IN_GROUP';END IF;
 SELECT * INTO STRICT g FROM p40s_lab.fake_group WHERE id='SYNTH-GROUP-1' FOR UPDATE;
 IF g.sync_version IS DISTINCT FROM p_sync OR g.ledger_version IS DISTINCT FROM p_ledger
    THEN RETURN 'CAS_CONFLICT';END IF;
 IF g.display_source=p_target THEN RETURN 'NO_CHANGE';END IF;
 UPDATE p40s_lab.fake_group SET display_source=p_target,
   sync_version=sync_version+1 WHERE id=g.id;
 RETURN 'TARGET_CHANGED_WITH_NO_ORIGINAL_MUTATION';
END $$;

-- Every fake accounting action MUST name a source original and its own
-- issued invoice. Group is a presentation view, not a third receivable.
CREATE FUNCTION p40s_lab.post_operation(
 p_operation jsonb,p_expected_sync bigint,p_expected_ledger bigint
) RETURNS TABLE(outcome text,next_sync bigint,next_ledger bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g p40s_lab.fake_group%ROWTYPE;
        source_doc p40s_lab.fake_sources%ROWTYPE;
        source_invoice p40s_lab.fake_invoices%ROWTYPE;
        balance p40s_lab.fake_source_balance%ROWTYPE;
        prior p40s_lab.fake_event%ROWTYPE;
        k text; kind text; src text; inv text; raw_amount text; amount integer;
        effective integer; max_ar integer;
        rate integer; net integer; tax integer; base integer; bps integer;
        worker text; total_worker integer;
BEGIN
 IF p_operation IS NULL OR jsonb_typeof(p_operation)<>'object'
    THEN RAISE EXCEPTION 'INVALID_FAKE_OPERATION';END IF;
 k:=p_operation->>'key';kind:=p_operation->>'kind';
 src:=p_operation->>'source';inv:=p_operation->>'invoice';
 raw_amount:=p_operation->>'amount';
 IF k IS NULL OR k NOT LIKE 'SYNTH-%' OR
    src NOT IN ('SYNTH-L','SYNTH-M') OR
    inv NOT LIKE 'SYNTH-INV-%' OR
    kind NOT IN ('CREDIT','RETENTION_SET','AR_RECEIPT',
                 'RETENTION_RECEIPT','COMMISSION_ACCRUAL') OR
    raw_amount IS NULL OR raw_amount !~ '^[0-9]{1,8}$'
    THEN RAISE EXCEPTION 'INVALID_FAKE_OPERATION'; END IF;
 amount:=raw_amount::integer;
 IF amount<=0 THEN RAISE EXCEPTION 'POSITIVE_FAKE_AMOUNT_REQUIRED'; END IF;
 SELECT * INTO STRICT g FROM p40s_lab.fake_group
   WHERE id='SYNTH-GROUP-1' FOR UPDATE;
 SELECT * INTO prior FROM p40s_lab.fake_event WHERE operation_key=k;
 IF FOUND THEN
   IF prior.payload IS DISTINCT FROM p_operation THEN
      RAISE EXCEPTION 'OPERATION_KEY_REUSED_WITH_DIFFERENT_SOURCE_OR_PAYLOAD';END IF;
   RETURN QUERY SELECT 'DUPLICATE'::text,g.sync_version,g.ledger_version;
   RETURN;
 END IF;
 IF p_expected_sync IS DISTINCT FROM g.sync_version
    OR p_expected_ledger IS DISTINCT FROM g.ledger_version THEN
   RETURN QUERY SELECT 'CAS_CONFLICT'::text,g.sync_version,g.ledger_version;
   RETURN;
 END IF;
 SELECT * INTO STRICT source_doc FROM p40s_lab.fake_sources
  WHERE id=src AND group_id=g.id;
 SELECT * INTO STRICT source_invoice FROM p40s_lab.fake_invoices
  WHERE id=inv AND source_id=source_doc.id;
 SELECT * INTO STRICT balance FROM p40s_lab.fake_source_balance
  WHERE source_id=src FOR UPDATE;
 effective:=source_doc.original_gross-balance.credit_untaxed-balance.credit_tax;
 max_ar:=effective-balance.retention_hold;
 IF kind='CREDIT' THEN
   IF balance.credit_untaxed<>0 OR balance.credit_tax<>0
      OR balance.ar_received<>0 OR balance.retention_received<>0
      OR balance.retention_hold<>0 THEN
      RAISE EXCEPTION 'EXISTING_CREDIT_OR_SETTLEMENT_NEEDS_HUMAN_REVIEW';END IF;
   IF coalesce(p_operation->>'approval','') NOT LIKE 'SYNTH-APPROVAL-%'
      OR coalesce(p_operation->>'credit','') NOT LIKE 'SYNTH-CREDIT-%'
      THEN RAISE EXCEPTION 'ISSUED_INVOICE_CREDIT_EVIDENCE_REQUIRED';END IF;
   IF coalesce(p_operation->>'net','') !~ '^[0-9]{1,8}$'
      OR coalesce(p_operation->>'tax','') !~ '^[0-9]{1,8}$'
      THEN RAISE EXCEPTION 'CREDIT_TAX_SPLIT_REQUIRED';END IF;
   net:=(p_operation->>'net')::integer;
   tax:=(p_operation->>'tax')::integer;
   IF net<=0 OR tax<0 OR net+tax<>amount OR
      round(net::numeric*0.05)::integer<>tax OR
      amount>=effective THEN
      RAISE EXCEPTION 'CREDIT_NET_TAX_INCONSISTENT';END IF;
   balance.credit_untaxed:=net;balance.credit_tax:=tax;
 ELSIF kind='RETENTION_SET' THEN
   IF balance.retention_hold<>0 OR balance.ar_received<>0
      OR balance.retention_received<>0 THEN
       RAISE EXCEPTION 'RETENTION_EDIT_AFTER_SETTLEMENT_BLOCKED';END IF;
   IF coalesce(p_operation->>'rate','') !~ '^(5|10)$'
      THEN RAISE EXCEPTION 'RETENTION_RATE_UNSUPPORTED';END IF;
   rate:=(p_operation->>'rate')::integer;
   IF amount<>round(effective::numeric*rate/100)::integer OR amount>=effective
      THEN RAISE EXCEPTION 'RETENTION_INCONSISTENT'; END IF;
   balance.retention_hold:=amount;
 ELSIF kind='AR_RECEIPT' THEN
   IF balance.ar_received+amount>max_ar OR max_ar<=0
      THEN RAISE EXCEPTION 'AR_OVERPAYMENT_OR_SOURCE_EXHAUSTED';END IF;
   balance.ar_received:=balance.ar_received+amount;
   g.bank_in:=g.bank_in+amount;
 ELSIF kind='RETENTION_RECEIPT' THEN
   IF balance.retention_hold=0 OR
      balance.ar_received<>max_ar OR
      balance.retention_received+amount>balance.retention_hold THEN
      RAISE EXCEPTION 'RETENTION_RELEASE_BLOCKED_OR_OVERPAYMENT';END IF;
   balance.retention_received:=balance.retention_received+amount;
   g.bank_in:=g.bank_in+amount;
 ELSIF kind='COMMISSION_ACCRUAL' THEN
   -- Release only after the source's normal receivable is fully paid;
   -- retention may remain outstanding, subject to separate accounting review.
   IF balance.ar_received<>max_ar THEN
      RAISE EXCEPTION 'COMMISSION_LOCKED_UNTIL_SOURCE_AR_PAID';END IF;
   worker:=p_operation->>'worker';
   IF worker NOT IN ('SYNTH-EMP-A','SYNTH-EMP-B') OR
      coalesce(p_operation->>'review','') NOT LIKE 'SYNTH-REVIEW-%' OR
      coalesce(p_operation->>'untaxedBase','') !~ '^[0-9]{1,8}$' OR
      coalesce(p_operation->>'rateBps','') !~ '^[0-9]{1,4}$'
      THEN RAISE EXCEPTION 'COMMISSION_SOURCE_REVIEW_REQUIRED';END IF;
   IF EXISTS (SELECT 1 FROM p40s_lab.fake_event e WHERE
       e.source_id=src AND e.kind='COMMISSION_ACCRUAL'
       AND e.payload->>'worker'=worker) THEN
       RAISE EXCEPTION 'SAME_WORKER_SOURCE_ALREADY_ACCRUED';END IF;
   base:=(p_operation->>'untaxedBase')::integer;
   bps:=(p_operation->>'rateBps')::integer;
   IF base<=0 OR bps>10000 OR
      base::bigint*bps%10000<>0 OR base::bigint*bps/10000<>amount THEN
      RAISE EXCEPTION 'COMMISSION_UNTAXED_BASIS_OR_RATE_INVALID';END IF;
   SELECT coalesce(sum((e.payload->>'rateBps')::integer),0)
     INTO total_worker FROM p40s_lab.fake_event e
     WHERE e.source_id=src AND e.kind='COMMISSION_ACCRUAL';
   IF total_worker+bps>10000 THEN
      RAISE EXCEPTION 'COMMISSION_SOURCE_RATE_OVER_ALLOCATED';END IF;
   balance.commission_accrued:=balance.commission_accrued+amount;
 END IF;
 UPDATE p40s_lab.fake_source_balance SET
   credit_untaxed=balance.credit_untaxed,credit_tax=balance.credit_tax,
   retention_hold=balance.retention_hold,ar_received=balance.ar_received,
   retention_received=balance.retention_received,
   commission_accrued=balance.commission_accrued WHERE source_id=src;
 INSERT INTO p40s_lab.fake_event(operation_key,source_id,invoice_id,kind,amount,payload)
   VALUES(k,src,inv,kind,amount,p_operation);
 UPDATE p40s_lab.fake_group SET bank_in=g.bank_in,
   sync_version=sync_version+1, ledger_version=ledger_version+1
   WHERE id=g.id RETURNING * INTO g;
 RETURN QUERY SELECT 'SYNTHETIC_APPLIED'::text,g.sync_version,g.ledger_version;
END $$;

ALTER TABLE p40s_lab.fake_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40s_lab.fake_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40s_lab.fake_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40s_lab.fake_source_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40s_lab.fake_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40s_lab.fake_paid_salary_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA p40s_lab FROM PUBLIC,p40s_clerk,p40s_public;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA p40s_lab FROM PUBLIC,p40s_clerk,p40s_public;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA p40s_lab FROM PUBLIC,p40s_clerk,p40s_public;
GRANT USAGE ON SCHEMA p40s_lab TO p40s_clerk,p40s_public;
GRANT EXECUTE ON FUNCTION p40s_lab.post_operation(jsonb,bigint,bigint)
 TO p40s_clerk;
GRANT EXECUTE ON FUNCTION p40s_lab.public_document(text) TO p40s_public;
COMMENT ON SCHEMA p40s_lab IS 'P40-16S disposable synthetic linked invoice/privacy lab; never copy to production';
