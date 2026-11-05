'use strict';
// P37-19F release blocker. Observations are NEVER authority to post transactions.
const EXPECTED_LAB='ldktrfgzzzmklhsnfrol';
const SCHEMA='kushe-p37-19f-database-evidence-v1';
const REQUIRED = [
  'realAuthenticatedHttpClientsTested',
  'concurrentAuthorizedRpcAgainstSameCaseTested',
  'realProductionCloudCasTested',
  'formalVoucherIndependentlyVerified',
  'settlementWritersFullyIntegrated',
  'productionPostingApproved'
];
function inspect(evidence){
 if(!evidence||evidence.schema!==SCHEMA||evidence.labProjectRef!==EXPECTED_LAB||
   evidence.productionTouched!==false||evidence.labCasesAfter!==0||
   evidence.labAllowancesAfter!==0)throw new Error('P37-19F UNKNOWN_LAB_OR_NONZERO_FIXTURES');
 const realDbPassed=evidence.realPostgresRollbackTransactionPassed===true&&
   evidence.realRlsAnonymousDenialPassed===true&&
   evidence.rpcSecurityInvoker===true&&evidence.rpcAnonExecuteGranted===false;
 return Object.freeze({
  schema:'kushe-p37-19f-release-blocker-v1',
  labOnly:true,realDatabaseRollbackVerified:realDbPassed,
  realTwoClientRpcConcurrencyVerified:Boolean(
    evidence.realAuthenticatedHttpClientsTested &&
    evidence.concurrentAuthorizedRpcAgainstSameCaseTested &&
    evidence.sqlLockContentionActuallyObserved
  ),
  pending:REQUIRED.filter(k=>evidence[k]!==true),
  status:'REVIEW_ONLY_POSTING_DISABLED',
  canPost:false,allowanceWriterRegistered:false,formalDataChanged:false,
  cloudWrites:0,bankTransactionsAdded:0
 });
}
module.exports=Object.freeze({inspect,EXPECTED_LAB,SCHEMA,REQUIRED});
