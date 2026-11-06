(() => {
'use strict';
if(window.location?.hostname!=='127.0.0.1'||
   window.location?.protocol!=='http:'||
   window.location?.pathname!=='/'||
   window.P37R?.scope!=='P37_19R_LOCALHOST_SYNTHETIC_READ_ONLY'||
   window.P37R?.isolatedFixture!==true)
 throw Error('P37-19S REQUIRE_APPROVED_LOCALHOST_SYNTHETIC_R_FIXTURE');
window.P37S=Object.freeze({
 scope:'P37_19S_SYNTHETIC_READ_ONLY_NAV_AND_TRENDS',
 isolatedFixture:true,approvedToPost:false,
 genuineTaxVoucherVerified:false,realCloudAccessAllowed:false,
 ownerSimulationOnly:true
});
})();