const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');
const { redactDiagnostics } = mobileModules()('src/lib/redact.ts');
test('diagnostics redact encoded query credentials, bearer headers and structured secrets', () => {
  const value = 'https://server/hub?%61ccess_token=secret-query&sig=secret-sig&path=music Bearer secret.jwt.value {"refreshToken":"secret-refresh","password":"secret-password"}';
  const safe = redactDiagnostics(value);
  assert.equal(safe.includes('secret'), false);
  assert.equal(safe.includes('path=music'), true);
  assert.equal(redactDiagnostics('/public/mixtapes/secret-public-token/artwork'), '/public/mixtapes/[redacted]/artwork');
});
