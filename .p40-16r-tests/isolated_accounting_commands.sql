-- P40-16R: PostgreSQL 16 one-time CI schema, NOT a production migration.
-- All IDs SYNTH-* and every value fictitious. No Supabase Auth / live data.
CREATE ROLE p40r_viewer LOGIN PASSWORD 'p40r-fake-viewer-ci' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE p40r_operator LOGIN PASSWORD 'p40r-fake-operator-ci' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE SCHEMA p40r_lab AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA p40r_lab FROM PUBLIC;
CREATE TABLE p40r_lab.fake_summary (
  doc_id text PRIMARY KEY CHECK(doc_id='SYNTH-R-BILL'),
  original_gross integer NOT NULL DEFAULT 632100 CHECK(original_gross=632100),
  effective_gross integer NOT NULL DEFAULT 632100 CHECK(effective_gross>=0),
  invoice_gross integer NOT NULL DEFAULT 0 CHECK(invoice_gross>=0),
  credit_note_total integer NOT NULL DEFAULT 0 CHECK(credit_note_total>=0),
  discount_total integer NOT NULL DEFAULT 0 CHECK(discount_total>=0),
  ar_received integer NOT NULL DEFAULT 0 CHECK(ar_received>=0),
  retention_hold integer NOT NULL DEFAULT 0 CHECK(retention_hold>=0),
  retention_received integer NOT NULL DEFAULT 0 CHECK(retention_received>=0),
  vendor_due integer NOT NULL DEFAULT 0 CHECK(vendor_due>=0),
  vendor_paid integer NOT NULL DEFAULT 0 CHECK(vendor_paid>=0),
  payroll_due integer NOT NULL DEFAULT 0 CHECK(payroll_due>=0),
  payroll_paid integer NOT NULL DEFAULT 0 CHECK(payroll_paid>=0),
  commission_accrued integer NOT NULL DEFAULT 0 CHECK(commission_accrued>=0),
  bank_in integer NOT NULL DEFAULT 0 CHECK(bank_in>=0),
  bank_out integer NOT NULL DEFAULT 0 CHECK(bank_out>=0),
  sync_version bigint NOT NULL DEFAULT 1 CHECK(sync_version>=1),
  ledger_version bigint NOT NULL DEFAULT 0 CHECK(ledger_version>=0),
  CHECK(effective_gross=original_gross-discount_total),
  CHECK(ar_received+retention_received<=effective_gross),
  CHECK(retention_hold<=effective_gross),
  CHECK(retention_received<=retention_hold),
  CHECK(vendor_paid<=vendor_due),
  CHECK(payroll_paid<=payroll_due),
  CHECK(bank_in=ar_received+retention_received),
  CHECK(bank_out=vendor_paid+payroll_paid)
);
CREATE TABLE p40r_lab.fake_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_key text UNIQUE NOT NULL CHECK(operation_key LIKE 'SYNTH-%'),
  doc_id text NOT NULL REFERENCES p40r_lab.fake_summary(doc_id),
  kind text NOT NULL CHECK(kind IN (
    'RECORD_DAILY','RECORD_MATERIAL','APPROVE_DISCOUNT','ISSUE_INVOICE',
    'CREDIT_NOTE_DISCOUNT','SET_RETENTION','RECEIVE_AR','RECEIVE_RETENTION',
    'REGISTER_PAYABLE','PAY_VENDOR','REGISTER_PAYROLL','PAY_SALARY',
    'ACCRUE_COMMISSION')),
  source_key text NOT NULL CHECK(source_key LIKE 'SYNTH-%'),
  amount integer NOT NULL CHECK(amount>0),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(evidence)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO p40r_lab.fake_summary(doc_id) VALUES('SYNTH-R-BILL');
CREATE FUNCTION p40r_lab.ref_exists(p_key text,p_kind text)
RETURNS boolean LANGUAGE SQL SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM p40r_lab.fake_events
    WHERE operation_key=p_key AND kind=p_kind)
$$;
CREATE FUNCTION p40r_lab.ref_amount(p_key text,p_kind text)
RETURNS integer LANGUAGE SQL SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT amount FROM p40r_lab.fake_events
    WHERE operation_key=p_key AND kind=p_kind
$$;
CREATE FUNCTION p40r_lab.immutable_event()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'SYNTHETIC_EVENT_IMMUTABLE'; END $$;
CREATE TRIGGER fake_events_no_update_delete BEFORE UPDATE OR DELETE
ON p40r_lab.fake_events FOR EACH ROW EXECUTE FUNCTION p40r_lab.immutable_event();

-- Operator access is controlled by distinct CI-only PostgreSQL LOGIN roles;
-- this is NOT equivalent to Supabase's shared 'authenticated' role. The
-- SECURITY DEFINER routine must NEVER be copied into a real exposed schema.
CREATE FUNCTION p40r_lab.post_action(
  p_doc text, p_key text, p_kind text, p_source text, p_amount integer,
  p_expected_sync bigint, p_expected_ledger bigint,
  p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(outcome text,new_sync bigint,new_ledger bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s p40r_lab.fake_summary%ROWTYPE;
        existing p40r_lab.fake_events%ROWTYPE;
        prior_amount integer;
        paid_for_source integer;
        approved_base bigint;
        approved_rate bigint;
BEGIN
 IF p_doc IS DISTINCT FROM 'SYNTH-R-BILL'
    OR p_key IS NULL OR p_key NOT LIKE 'SYNTH-%'
    OR p_source IS NULL OR p_source NOT LIKE 'SYNTH-%'
    OR p_amount IS NULL OR p_amount<=0
    OR p_evidence IS NULL OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object'
    OR p_kind NOT IN ('RECORD_DAILY','RECORD_MATERIAL','APPROVE_DISCOUNT',
    'ISSUE_INVOICE','CREDIT_NOTE_DISCOUNT','SET_RETENTION','RECEIVE_AR',
    'RECEIVE_RETENTION','REGISTER_PAYABLE','PAY_VENDOR','REGISTER_PAYROLL',
    'PAY_SALARY','ACCRUE_COMMISSION') THEN
   RAISE EXCEPTION 'INVALID_SYNTHETIC_REQUEST';
 END IF;
 -- Lock is held across verification, event append and all derived balances.
 SELECT * INTO STRICT s FROM p40r_lab.fake_summary
  WHERE doc_id=p_doc FOR UPDATE;
 SELECT * INTO existing FROM p40r_lab.fake_events WHERE operation_key=p_key;
 IF FOUND THEN
   IF existing.doc_id IS DISTINCT FROM p_doc
      OR existing.kind IS DISTINCT FROM p_kind
      OR existing.source_key IS DISTINCT FROM p_source
      OR existing.amount IS DISTINCT FROM p_amount
      OR existing.evidence IS DISTINCT FROM p_evidence THEN
       RAISE EXCEPTION 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH';
   END IF;
   RETURN QUERY SELECT 'REPLAY'::text,s.sync_version,s.ledger_version;
   RETURN;
 END IF;
 IF p_expected_sync IS DISTINCT FROM s.sync_version
    OR p_expected_ledger IS DISTINCT FROM s.ledger_version THEN
   RETURN QUERY SELECT 'CAS_CONFLICT'::text,s.sync_version,s.ledger_version;
   RETURN;
 END IF;
 IF p_kind IN ('RECORD_DAILY','RECORD_MATERIAL') THEN
   -- Synthetic work record, no financial projection mutation. Real ERP daily
   -- pricing, inventory, and salary rules are NOT represented here.
   NULL;
 ELSIF p_kind IN ('APPROVE_DISCOUNT','CREDIT_NOTE_DISCOUNT') THEN
   IF coalesce(p_evidence->>'approval_ref','') NOT LIKE 'SYNTH-APPROVAL-%'
      THEN RAISE EXCEPTION 'APPROVAL_EVIDENCE_REQUIRED';END IF;
   IF s.discount_total<>0 OR s.ar_received<>0 OR s.retention_received<>0
      THEN RAISE EXCEPTION 'HISTORIC_SETTLEMENT_REVIEW_REQUIRED';END IF;
   IF p_amount>=s.effective_gross THEN RAISE EXCEPTION 'DISCOUNT_OUT_OF_RANGE';END IF;
   IF p_kind='APPROVE_DISCOUNT' THEN
     IF s.invoice_gross<>0 THEN RAISE EXCEPTION 'ISSUED_INVOICE_CREDIT_NOTE_REQUIRED';END IF;
   ELSE
     IF s.invoice_gross=0 OR NOT p40r_lab.ref_exists(p_source,'ISSUE_INVOICE')
        THEN RAISE EXCEPTION 'ISSUED_INVOICE_REFERENCE_REQUIRED';END IF;
     IF coalesce(p_evidence->>'credit_evidence_ref','') NOT LIKE 'SYNTH-CREDIT-%'
        THEN RAISE EXCEPTION 'CREDIT_NOTE_EVIDENCE_REQUIRED';END IF;
     s.credit_note_total:=s.credit_note_total+p_amount;
   END IF;
   s.discount_total:=s.discount_total+p_amount;
   s.effective_gross:=s.effective_gross-p_amount;
   IF s.retention_hold>s.effective_gross
      THEN RAISE EXCEPTION 'RETENTION_NEEDS_ACCOUNTING_REVIEW';END IF;
 ELSIF p_kind='ISSUE_INVOICE' THEN
   IF s.invoice_gross<>0 OR p_amount<>s.effective_gross
      OR p_source<>'SYNTH-R-BILL'
      THEN RAISE EXCEPTION 'INVOICE_AMOUNT_OR_DUPLICATE';END IF;
   s.invoice_gross:=p_amount;
 ELSIF p_kind='SET_RETENTION' THEN
   IF s.retention_hold<>0 OR s.ar_received<>0 OR s.retention_received<>0
      OR p_amount>=s.effective_gross THEN
      RAISE EXCEPTION 'RETENTION_CHANGE_AFTER_SETTLEMENT_BLOCKED';END IF;
   s.retention_hold:=p_amount;
 ELSIF p_kind='RECEIVE_AR' THEN
   IF s.invoice_gross=0 OR
      NOT p40r_lab.ref_exists(p_source,'ISSUE_INVOICE')
      THEN RAISE EXCEPTION 'RECEIPT_SOURCE_INVOICE_REQUIRED';END IF;
   IF s.ar_received+p_amount > s.effective_gross-s.retention_hold
      THEN RAISE EXCEPTION 'RECEIPT_OVERPAYMENT';END IF;
   s.ar_received:=s.ar_received+p_amount;
   s.bank_in:=s.bank_in+p_amount;
 ELSIF p_kind='RECEIVE_RETENTION' THEN
   IF s.invoice_gross=0 OR NOT p40r_lab.ref_exists(p_source,'SET_RETENTION')
      THEN RAISE EXCEPTION 'RETENTION_SOURCE_REQUIRED';END IF;
   IF s.retention_received+p_amount>s.retention_hold
      THEN RAISE EXCEPTION 'RETENTION_OVERPAYMENT';END IF;
   s.retention_received:=s.retention_received+p_amount;
   s.bank_in:=s.bank_in+p_amount;
 ELSIF p_kind='REGISTER_PAYABLE' THEN
   IF p_source<>'SYNTH-VENDOR' THEN RAISE EXCEPTION 'VENDOR_REFERENCE_INVALID';END IF;
   s.vendor_due:=s.vendor_due+p_amount;
 ELSIF p_kind='PAY_VENDOR' THEN
   IF NOT p40r_lab.ref_exists(p_source,'REGISTER_PAYABLE')
      THEN RAISE EXCEPTION 'VENDOR_BILL_REFERENCE_REQUIRED';END IF;
   SELECT coalesce(sum(amount),0) INTO paid_for_source FROM p40r_lab.fake_events
      WHERE kind='PAY_VENDOR' AND source_key=p_source;
   prior_amount:=p40r_lab.ref_amount(p_source,'REGISTER_PAYABLE');
   IF paid_for_source+p_amount>prior_amount
      THEN RAISE EXCEPTION 'VENDOR_OVERPAYMENT';END IF;
   s.vendor_paid:=s.vendor_paid+p_amount;
   s.bank_out:=s.bank_out+p_amount;
 ELSIF p_kind='REGISTER_PAYROLL' THEN
   IF p_source<>'SYNTH-EMPLOYEE' THEN RAISE EXCEPTION 'EMPLOYEE_REFERENCE_INVALID';END IF;
   s.payroll_due:=s.payroll_due+p_amount;
 ELSIF p_kind='PAY_SALARY' THEN
   IF NOT p40r_lab.ref_exists(p_source,'REGISTER_PAYROLL')
      THEN RAISE EXCEPTION 'PAYROLL_REFERENCE_REQUIRED';END IF;
   SELECT coalesce(sum(amount),0) INTO paid_for_source FROM p40r_lab.fake_events
      WHERE kind='PAY_SALARY' AND source_key=p_source;
   prior_amount:=p40r_lab.ref_amount(p_source,'REGISTER_PAYROLL');
   IF paid_for_source+p_amount>prior_amount
      THEN RAISE EXCEPTION 'SALARY_OVERPAYMENT';END IF;
   s.payroll_paid:=s.payroll_paid+p_amount;
   s.bank_out:=s.bank_out+p_amount;
 ELSIF p_kind='ACCRUE_COMMISSION' THEN
   IF p_source<>'SYNTH-EMPLOYEE' OR
      coalesce(p_evidence->>'review_ref','') NOT LIKE 'SYNTH-REVIEW-%'
      OR coalesce(p_evidence->>'untaxed_base','') !~ '^[0-9]{1,9}$'
      OR coalesce(p_evidence->>'rate_bps','') !~ '^[0-9]{1,4}$'
      THEN RAISE EXCEPTION 'COMMISSION_REVIEW_AND_BASIS_REQUIRED';END IF;
   approved_base:=(p_evidence->>'untaxed_base')::bigint;
   approved_rate:=(p_evidence->>'rate_bps')::bigint;
   IF approved_rate>10000 OR
      (approved_base*approved_rate)%10000<>0 OR
      approved_base*approved_rate/10000<>p_amount THEN
      RAISE EXCEPTION 'COMMISSION_UNTAXED_RATE_MISMATCH';END IF;
   -- No automatic payroll update: commission is separate explicit accrual.
   s.commission_accrued:=s.commission_accrued+p_amount;
 END IF;
 INSERT INTO p40r_lab.fake_events(
   operation_key,doc_id,kind,source_key,amount,evidence)
 VALUES(p_key,p_doc,p_kind,p_source,p_amount,p_evidence);
 UPDATE p40r_lab.fake_summary SET
   effective_gross=s.effective_gross,invoice_gross=s.invoice_gross,
   credit_note_total=s.credit_note_total,discount_total=s.discount_total,
   ar_received=s.ar_received,retention_hold=s.retention_hold,
   retention_received=s.retention_received,vendor_due=s.vendor_due,
   vendor_paid=s.vendor_paid,payroll_due=s.payroll_due,
   payroll_paid=s.payroll_paid,commission_accrued=s.commission_accrued,
   bank_in=s.bank_in,bank_out=s.bank_out,
   sync_version=sync_version+1,ledger_version=ledger_version+1
 WHERE doc_id=p_doc RETURNING * INTO s;
 RETURN QUERY SELECT 'SYNTHETIC_APPLIED'::text,s.sync_version,s.ledger_version;
END $$;
ALTER TABLE p40r_lab.fake_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40r_lab.fake_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY fake_viewer_summary ON p40r_lab.fake_summary
  FOR SELECT TO p40r_viewer,p40r_operator USING(doc_id='SYNTH-R-BILL');
REVOKE ALL ON ALL TABLES IN SCHEMA p40r_lab FROM PUBLIC,p40r_viewer,p40r_operator;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA p40r_lab FROM PUBLIC,p40r_viewer,p40r_operator;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA p40r_lab FROM PUBLIC,p40r_viewer,p40r_operator;
GRANT USAGE ON SCHEMA p40r_lab TO p40r_viewer,p40r_operator;
GRANT SELECT ON p40r_lab.fake_summary TO p40r_viewer,p40r_operator;
GRANT EXECUTE ON FUNCTION
 p40r_lab.post_action(text,text,text,text,integer,bigint,bigint,jsonb)
 TO p40r_operator;
-- Revoke all other function EXECUTE. PRIVATE schema and fake accounts, no live
-- PostgREST / JWT verification. Forbidden as Supabase migration.
