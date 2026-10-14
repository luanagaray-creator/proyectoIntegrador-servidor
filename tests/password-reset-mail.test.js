const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../index');

async function withServer(options, run) {
  const server = createApp({}, options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/auth/password-reset/request`;
  try { await run(email => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('si SMTP está caído, no genera códigos y avisa igual para cualquier email', async () => {
  let requests = 0;
  await withServer({ resetService: { request: async () => { requests++; } }, verifyRecoveryMail: async () => { throw Object.assign(new Error('test'), { code: 'SMTP_TEST_FAILURE' }); } }, async request => {
    const known = await request('ana@example.com');
    const unknown = await request('no-existe@example.com');
    assert.equal(known.status, 503);
    assert.equal(unknown.status, 503);
    assert.deepEqual(await known.json(), await unknown.json());
    assert.equal(requests, 0);
  });
});

test('el fallo al enviar el código no hace avanzar como si estuviera enviado', async () => {
  await withServer({ resetService: { request: async () => ({ requestId: 'test', delivery: { email: 'ana@example.com', code: '012345' } }) }, verifyRecoveryMail: async () => {}, sendRecoveryEmail: async () => { throw Object.assign(new Error('test'), { code: 'SMTP_TEST_FAILURE' }); } }, async request => {
    const result = await request('ana@example.com');
    assert.equal(result.status, 503);
    const body = await result.json();
    assert.equal(body.requestId, undefined);
    assert.match(body.error, /No se pudo enviar/);
  });
});

test('responde con requestId después de que SMTP acepta el envío', async () => {
  let accepted = false;
  await withServer({ resetService: { request: async () => ({ requestId: 'test', delivery: { email: 'ana@example.com', code: '012345' } }) }, verifyRecoveryMail: async () => {}, sendRecoveryEmail: async () => { await new Promise(resolve => setTimeout(resolve, 20)); accepted = true; } }, async request => {
    const result = await request('ana@example.com');
    assert.equal(accepted, true);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).requestId, 'test');
  });
});
