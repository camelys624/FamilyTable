'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { guardRepository, checkText, checkAvatar } = require('../../cloudfunctions/vote/content-safety')

test('moderation sees validated text and trusted identity, and rejected content never reaches writes', async () => {
  const calls = []
  let writes = 0
  const cloud = { openapi: { security: { msgSecCheck: async (input) => { calls.push(input); return { errCode: 0, result: { suggest: 'risky' } } } } } }
  const repository = guardRepository({ create: async () => { writes++ } }, cloud, { create: { fields: ['name', 'ingredients.name'] } })
  await assert.rejects(repository.create('trusted-openid', { name: '菜名', familyId: 'private-family', ingredients: [{ name: '鸡蛋' }] }), { code: 'CONTENT_REJECTED' })
  assert.equal(writes, 0)
  assert.equal(calls[0].openid, 'trusted-openid')
  assert.equal(calls[0].content, '菜名\n鸡蛋')
  assert.equal(JSON.stringify(calls).includes('private-family'), false)
})

test('unavailable or inconclusive moderation does not pass through; long Unicode text is checked completely', async () => {
  await assert.rejects(checkText({}, 'openid', '菜名'), { code: 'FEATURE_UNAVAILABLE' })
  await assert.rejects(checkText({ openapi: { security: { msgSecCheck: async () => ({ errCode: 0 }) } } }, 'openid', '菜名'), { code: 'FEATURE_UNAVAILABLE' })
  const chunks = []
  const input = '🍲'.repeat(2001)
  await checkText({ openapi: { security: { msgSecCheck: async ({ content }) => { chunks.push(content); return { errCode: 0, result: { suggest: 'pass' } } } } } }, 'openid', input)
  assert.equal(chunks.length, 2)
  assert.equal(chunks.join(''), input)
})

test('avatars must be valid cloud images and pass a real check before profile writes', async () => {
  await assert.rejects(checkAvatar({}, 'https://example.com/avatar.png'), { code: 'VALIDATION_ERROR' })
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const cloud = { downloadFile: async () => ({ fileContent: png }), openapi: { security: { imgSecCheck: async () => ({ errCode: 87014 }) } } }
  await assert.rejects(checkAvatar(cloud, 'cloud://env/avatar.png'), { code: 'CONTENT_REJECTED' })
  cloud.openapi.security.imgSecCheck = async () => ({ errCode: 0 })
  await checkAvatar(cloud, 'cloud://env/avatar.png')
})

test('moderation diagnostics retain upstream codes without leaking user data or upstream messages', async () => {
  const cloud = { openapi: { security: { msgSecCheck: async () => { throw { errCode: -604101, errMsg: 'private-openid private-content secret-token' } } } } }
  await assert.rejects(checkText(cloud, 'private-openid', 'private-content'), (error) => {
    assert.equal(error.code, 'FEATURE_UNAVAILABLE')
    assert.deepEqual(error.details, { check: 'text', reason: 'api_failed', upstreamCode: -604101 })
    assert.equal(JSON.stringify(error).includes('private-'), false)
    assert.equal(JSON.stringify(error).includes('secret-token'), false)
    return true
  })
  cloud.openapi.security.msgSecCheck = async () => ({ errCode: '0', result: { suggest: 'pass' } })
  await checkText(cloud, 'openid', '菜名')
})

test('self-contained cloud packages have matching moderation and transaction helpers and permissions', () => {
  const root = path.resolve(__dirname, '../../cloudfunctions')
  const common = fs.readFileSync(path.join(root, 'vote/common.js'), 'utf8')
  for (const domain of ['shopping', 'preference', 'recipe', 'menu', 'fridge']) assert.equal(fs.readFileSync(path.join(root, domain, 'common.js'), 'utf8'), common)
  const safety = fs.readFileSync(path.join(root, 'vote/content-safety.js'), 'utf8')
  for (const domain of ['auth', 'family', 'recipe', 'shopping', 'fridge', 'vote']) {
    assert.equal(fs.readFileSync(path.join(root, domain, 'content-safety.js'), 'utf8'), safety)
    const config = JSON.parse(fs.readFileSync(path.join(root, domain, 'config.json'), 'utf8'))
    assert.ok(config.permissions.openapi.includes('security.msgSecCheck'))
    assert.ok(fs.readFileSync(path.join(root, domain, 'index.js'), 'utf8').includes('guardRepository('))
  }
})
