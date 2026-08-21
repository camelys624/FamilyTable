'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createAuthHandler } = require('../../cloudfunctions/auth/handler')
const { createFamilyHandler } = require('../../cloudfunctions/family/handler')
const { hash, stableValue } = require('../../cloudfunctions/family/repository')

const silentLogger = { error() {} }

test('auth.login only trusts the server identity', async () => {
  let receivedOpenid = ''
  const handler = createAuthHandler({
    async login(openid) {
      receivedOpenid = openid
      return { onboardingRequired: true }
    },
  }, silentLogger)

  const result = await handler(
    { action: 'auth.login', payload: { openid: 'forged-openid' }, requestId: 'req_auth_001' },
    { openid: 'trusted-openid' },
  )

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'VALIDATION_ERROR')
  assert.equal(receivedOpenid, '')

  const success = await handler({ action: 'auth.login', payload: {}, requestId: 'req_auth_002' }, { openid: 'trusted-openid' })
  assert.equal(success.ok, true)
  assert.equal(receivedOpenid, 'trusted-openid')
})

test('auth handler rejects missing identity and invalid profile fields', async () => {
  const handler = createAuthHandler({ login() {}, updateProfile() {} }, silentLogger)
  const unauthenticated = await handler({ action: 'auth.login' }, {})
  assert.equal(unauthenticated.error.code, 'UNAUTHENTICATED')

  const invalid = await handler(
    { action: 'auth.updateProfile', payload: { displayName: '', openid: 'forged' } },
    { openid: 'trusted' },
  )
  assert.equal(invalid.error.code, 'VALIDATION_ERROR')
})

test('auth.updateProfile passes a valid avatarUrl and rejects unsafe ones', async () => {
  const calls = []
  const handler = createAuthHandler({
    async updateProfile(openid, profile) {
      calls.push({ openid, profile })
      return { user: { id: 'u1', displayName: profile.displayName, avatarUrl: profile.avatarUrl || null } }
    },
  }, silentLogger)

  const ok = await handler(
    {
      action: 'auth.updateProfile',
      requestId: 'req_profile_001',
      payload: { displayName: '小满', avatarUrl: 'cloud://env.bucket/avatars/a.jpg' },
    },
    { openid: 'trusted' },
  )
  assert.equal(ok.ok, true)
  assert.deepEqual(calls[0], {
    openid: 'trusted',
    profile: { displayName: '小满', avatarUrl: 'cloud://env.bucket/avatars/a.jpg' },
  })

  const https = await handler(
    {
      action: 'auth.updateProfile',
      requestId: 'req_profile_002',
      payload: { displayName: '小满', avatarUrl: 'https://example.com/a.jpg' },
    },
    { openid: 'trusted' },
  )
  assert.equal(https.ok, true)

  const cleared = await handler(
    {
      action: 'auth.updateProfile',
      requestId: 'req_profile_003',
      payload: { displayName: '小满', avatarUrl: '' },
    },
    { openid: 'trusted' },
  )
  assert.equal(cleared.ok, true)

  const badScheme = await handler(
    {
      action: 'auth.updateProfile',
      requestId: 'req_profile_004',
      payload: { displayName: '小满', avatarUrl: 'javascript:alert(1)' },
    },
    { openid: 'trusted' },
  )
  assert.equal(badScheme.ok, false)
  assert.equal(badScheme.error.code, 'VALIDATION_ERROR')

  const forgedOpenid = await handler(
    {
      action: 'auth.updateProfile',
      requestId: 'req_profile_005',
      payload: { displayName: '小满', avatarUrl: 'https://example.com/a.jpg', openid: 'forged' },
    },
    { openid: 'trusted' },
  )
  assert.equal(forgedOpenid.ok, false)
  assert.equal(forgedOpenid.error.code, 'VALIDATION_ERROR')
})

test('family.create requires requestId and passes normalized input', async () => {
  const calls = []
  const handler = createFamilyHandler({
    async create(openid, input, requestId) {
      calls.push({ openid, input, requestId })
      return { family: { id: 'family-1', name: input.name } }
    },
  }, silentLogger)

  const missingRequestId = await handler(
    { action: 'family.create', payload: { name: '林家饭桌', displayName: '小满' } },
    { openid: 'trusted' },
  )
  assert.equal(missingRequestId.error.code, 'VALIDATION_ERROR')

  const success = await handler(
    {
      action: 'family.create',
      requestId: 'req_family_001',
      payload: { name: '  林家饭桌  ', displayName: '  小满 ', timezone: 'Asia/Shanghai' },
    },
    { openid: 'trusted' },
  )
  assert.equal(success.ok, true)
  assert.deepEqual(calls[0], {
    openid: 'trusted',
    input: { name: '林家饭桌', displayName: '小满', timezone: 'Asia/Shanghai' },
    requestId: 'req_family_001',
  })
})

test('family.current maps repository errors to stable responses', async () => {
  const handler = createFamilyHandler({
    async current() {
      throw Object.assign(new Error('你还没有创建或加入家庭'), { code: 'FAMILY_REQUIRED' })
    },
  }, silentLogger)
  const result = await handler({ action: 'family.current', payload: {} }, { openid: 'trusted' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'FAMILY_REQUIRED')
  assert.equal(result.error.message, '你还没有创建或加入家庭')
})
test('database setup failures return an actionable error', async () => {
  const auth = createAuthHandler({
    async login() {
      throw new Error('collection users does not exist')
    },
  }, silentLogger)
  const authResult = await auth({ action: 'auth.login', payload: {} }, { openid: 'trusted' })
  assert.equal(authResult.error.code, 'DATABASE_NOT_INITIALIZED')
  assert.equal(authResult.error.message, '数据库尚未初始化，请联系管理员')

  const family = createFamilyHandler({
    async create() {
      throw new Error('database collection family_members not found')
    },
  }, silentLogger)
  const familyResult = await family(
    {
      action: 'family.create',
      requestId: 'req_family_database_001',
      payload: { name: '林家饭桌', displayName: '小满', timezone: 'Asia/Shanghai' },
    },
    { openid: 'trusted' },
  )
  assert.equal(familyResult.error.code, 'DATABASE_NOT_INITIALIZED')
  assert.equal(familyResult.error.message, '数据库尚未初始化，请联系管理员')
})

test('idempotency request hash is stable across object key order', () => {
  const first = hash(JSON.stringify(stableValue({ name: '林家', timezone: 'Asia/Shanghai' })))
  const second = hash(JSON.stringify(stableValue({ timezone: 'Asia/Shanghai', name: '林家' })))
  assert.equal(first, second)
})
