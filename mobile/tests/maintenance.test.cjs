const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');
const { isMaintenanceResponse } = mobileModules()('src/lib/maintenance.ts');
test('explicit maintenance is distinct from generic outages and authentication failures', () => {
  assert.equal(isMaintenanceResponse({status:503,data:{code:'maintenance'}}),true);
  assert.equal(isMaintenanceResponse({status:503,headers:{'x-resonance-maintenance':'true'}}),true);
  for(const response of [undefined,{status:503},{status:401,data:{code:'maintenance'}},{status:502}]) assert.equal(isMaintenanceResponse(response),false);
});
