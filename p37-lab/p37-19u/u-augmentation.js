(() => {
'use strict';
if(location.hostname!=='127.0.0.1'||location.protocol!=='http:'||
   location.pathname!=='/'||
   window.P37R?.scope!=='P37_19R_LOCALHOST_SYNTHETIC_READ_ONLY'||
   window.P37R.isolatedFixture!==true)
 throw Error('P37-19U ORIGINAL_SNAPSHOT_NOT_SYNTHETIC');
window.P37U=Object.freeze({
 scope:'P37_19U_LOCALHOST_SYNTHETIC_PROOF_ONLY',
 isolatedFixture:true,syntheticOwnerOnly:true,
 officialVoucherVerified:false,
 formalCompanyDataAccess:false,
 formalReleasePermitted:false
});
})();