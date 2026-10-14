'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { CloudBaseFamilyRepository, hash } = require('../../cloudfunctions/family/repository')
const { createFamilyHandler } = require('../../cloudfunctions/family/handler')
const { guardRepository } = require('../../cloudfunctions/family/content-safety')

// Optimistic transactions: doc access only, staged writes, rollback, and retries
// on read/write conflicts. Concurrent requests really interleave before commit.
const { fakeCloud } = require('../helpers/fake-cloud')

async function setup() {
  const cloud = fakeCloud()
  for (const name of ['owner', 'alice', 'bob', 'other']) cloud.seed('users', name, { openid: name, status: 'active', displayName: name })
  const repository = new CloudBaseFamilyRepository(cloud)
  const created = await repository.create('owner', { name: '真实饭桌', displayName: '妈妈', timezone: 'Asia/Shanghai' }, 'req_create_owner')
  return { cloud, repository, familyId: created.family.id }
}

test('owner renames legacy families and members read the new name without changing invitations', async () => {
  const { cloud, repository } = await setup()
  const invite = await repository.invite('owner', { expiresInHours: 72 }, 'req_name_invite')
  await repository.join('alice', { inviteCode: invite.inviteCode, displayName: '爸爸' }, 'req_name_join')
  const before = cloud.all('families')[0]
  assert.equal((await repository.current('owner')).family.infoVersion, 0)
  const input = { name: '一起吃饭', expectedVersion: 0 }
  const results = await Promise.all([repository.update('owner', input, 'req_name_update'), repository.update('owner', input, 'req_name_update')])
  assert.deepEqual(results[0], results[1])
  assert.equal((await repository.current('alice')).family.name, '一起吃饭')
  assert.equal(results[0].family.infoVersion, 1)
  const after = cloud.all('families')[0]
  assert.equal(after.inviteCodeHash, before.inviteCodeHash)
  assert.deepEqual(after.inviteExpiresAt, before.inviteExpiresAt)
  assert.equal(after.memberCount, 2)
  assert.equal(after.timezone, before.timezone)
  assert.equal(after.updatedBy, 'owner')
  assert.equal(cloud.all('operation_logs').filter((row) => row.action === 'family.update').length, 1)
  await assert.rejects(repository.update('owner', { ...input, name: '不同名称' }, 'req_name_update'), { code: 'IDEMPOTENCY_CONFLICT' })
})

test('rename revalidates membership and owner role, including receipt replays', async () => {
  const { cloud, repository, familyId } = await setup()
  cloud.seed('family_members', 'legacy-alice', { familyId, userId: 'alice', displayName: '家人', role: 'member', status: 'active' })
  await assert.rejects(repository.update('alice', { name: '不允许', expectedVersion: 0 }, 'req_name_member'), { code: 'FORBIDDEN' })
  await assert.rejects(repository.update('bob', { name: '不允许', expectedVersion: 0 }, 'req_name_unjoined'), { code: 'FAMILY_REQUIRED' })
  const input = { name: '更新名称', expectedVersion: 0 }
  await repository.update('owner', input, 'req_name_owner')
  cloud.beforeTransaction(() => {
    const owner = cloud.all('family_members').find((member) => member.userId === 'owner')
    cloud.seed('family_members', owner._id, { ...owner, role: 'member' })
  })
  await assert.rejects(repository.update('owner', input, 'req_name_owner'), { code: 'FORBIDDEN' })
  assert.equal(cloud.all('families')[0].name, '更新名称')
  assert.equal(cloud.all('operation_logs').filter((row) => row.action === 'family.update').length, 1)
})

test('concurrent renames cannot overwrite a newer name and audit failures roll back the change', async () => {
  const { cloud, repository } = await setup()
  const changes = await Promise.allSettled([
    repository.update('owner', { name: '名称甲', expectedVersion: 0 }, 'req_name_a'),
    repository.update('owner', { name: '名称乙', expectedVersion: 0 }, 'req_name_b'),
  ])
  assert.equal(changes.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(changes.find((result) => result.status === 'rejected').reason.code, 'VERSION_CONFLICT')
  const before = cloud.all('families')[0]
  cloud.failWrite((name) => name === 'operation_logs')
  await assert.rejects(repository.update('owner', { name: '不能保存', expectedVersion: 1 }, 'req_name_rollback'), /injected/)
  assert.deepEqual(cloud.all('families')[0], before)
  assert.equal(cloud.all('idempotency_records').some((row) => row.requestId === 'req_name_rollback'), false)
})

test('rename validation and moderation reject changes before any write', async () => {
  const { cloud, repository } = await setup()
  const moderation = { openapi: { security: { msgSecCheck: async () => ({ errCode: 0, result: { suggest: 'risky' } }) } } }
  const handler = createFamilyHandler(guardRepository(repository, moderation, { update: { fields: ['name'] } }), { error() {} })
  const base = { action: 'family.update', requestId: 'req_name_handler', payload: { name: '新名称', expectedVersion: 0 } }
  assert.equal((await handler(base, { openid: 'owner' })).error.code, 'CONTENT_REJECTED')
  for (const payload of [{ name: '  ', expectedVersion: 0 }, { name: '字'.repeat(41), expectedVersion: 0 }, { name: '新名称', expectedVersion: -1 }, { ...base.payload, familyId: 'other-family' }, { ...base.payload, role: 'owner' }]) {
    assert.equal((await handler({ ...base, payload }, { openid: 'owner' })).error.code, 'VALIDATION_ERROR')
  }
  assert.equal((await handler({ ...base, requestId: '' }, { openid: 'owner' })).error.code, 'VALIDATION_ERROR')
  assert.equal(cloud.all('families')[0].name, '真实饭桌')
  moderation.openapi.security.msgSecCheck = async () => ({ errCode: 0, result: { suggest: 'pass' } })
  const result = await handler({ ...base, payload: { name: ' 新名称 ', expectedVersion: 0 } }, { openid: 'owner' })
  assert.equal(result.ok, true)
  assert.equal(result.data.family.name, '新名称')
})

test('real family invite and join expose members without exposing hashes or identities', async () => {
  const { cloud, repository, familyId } = await setup()
  const invite = await repository.invite('owner', { expiresInHours: 72 }, 'req_invite_1')
  assert.match(invite.inviteCode, /^[A-HJ-NP-Z2-9]{8}$/)
  const family = cloud.all('families')[0]
  assert.equal(family.inviteCodeHash, hash(invite.inviteCode))
  assert.equal(family.inviteCode, undefined)
  assert.equal(family.inviteExpiresAt.toISOString(), invite.expiresAt)
  const joined = await repository.join('alice', { inviteCode: invite.inviteCode, displayName: '爸爸' }, 'req_join_alice')
  assert.equal(joined.family.id, familyId)
  assert.equal(joined.member.role, 'member')
  const current = await repository.current('alice')
  assert.deepEqual(current.members.map((member) => member.displayName), ['妈妈', '爸爸'])
  assert.equal(current.currentMember.id, joined.member.id)
  const result = JSON.stringify(current)
  for (const secret of ['openid', 'userId', 'inviteCodeHash', invite.inviteCode]) assert.equal(result.includes(secret), false)
  assert.equal(cloud.all('users').find((user) => user._id === 'alice').displayName, '爸爸')
})

test('inviting requires an active owner, and legacy member IDs are revalidated', async () => {
  const { cloud, repository, familyId } = await setup()
  await assert.rejects(repository.invite('bob', { expiresInHours: 72 }, 'req_invite_bob'), { code: 'FAMILY_REQUIRED' })
  cloud.seed('family_members', 'legacy-alice', { familyId, userId: 'alice', displayName: '家人', role: 'member', status: 'active' })
  await assert.rejects(repository.invite('alice', { expiresInHours: 72 }, 'req_invite_alice'), { code: 'FORBIDDEN' })
  cloud.beforeTransaction(async () => {
    const owner = cloud.all('family_members').find((member) => member.userId === 'owner')
    cloud.seed('family_members', owner._id, { ...owner, status: 'removed' })
  })
  await assert.rejects(repository.invite('owner', { expiresInHours: 72 }, 'req_removed_owner'), { code: 'FAMILY_REQUIRED' })
  assert.equal(cloud.all('families')[0].inviteCodeHash, undefined)
})

test('rotation, expiry, and changes between lookup and transaction reject joins without writes', async () => {
  const { cloud, repository, familyId } = await setup()
  const first = await repository.invite('owner', { expiresInHours: 72 }, 'req_invite_first')
  const second = await repository.invite('owner', { expiresInHours: 72 }, 'req_invite_second')
  await assert.rejects(repository.join('alice', { inviteCode: first.inviteCode, displayName: '家人' }, 'req_join_old'), { code: 'INVITE_INVALID' })
  await assert.rejects(repository.invite('owner', { expiresInHours: 72 }, 'req_invite_first'), { code: 'INVITE_INVALID' })
  cloud.beforeTransaction(async () => {
    const family = cloud.all('families')[0]
    cloud.seed('families', familyId, { ...family, inviteExpiresAt: new Date(0) })
  })
  await assert.rejects(repository.join('alice', { inviteCode: second.inviteCode, displayName: '家人' }, 'req_join_expired'), { code: 'INVITE_EXPIRED' })
  const third = await repository.invite('owner', { expiresInHours: 72 }, 'req_invite_third')
  cloud.beforeTransaction(async () => {
    const family = cloud.all('families')[0]
    cloud.seed('families', familyId, { ...family, inviteCodeHash: hash('ABCD2345') })
  })
  await assert.rejects(repository.join('alice', { inviteCode: third.inviteCode, displayName: '家人' }, 'req_join_rotated'), { code: 'INVITE_INVALID' })
  assert.equal(cloud.all('family_members').length, 1)
  assert.equal(cloud.all('idempotency_records').filter((row) => row.action === 'family.join').length, 0)
})

test('duplicate requests replay once, parameter changes conflict, and concurrent joins stay unique', async () => {
  const { cloud, repository } = await setup()
  const invites = await Promise.all(Array.from({ length: 3 }, () => repository.invite('owner', { expiresInHours: 72 }, 'req_same_invite')))
  assert.deepEqual(invites[0], invites[1])
  await assert.rejects(repository.invite('owner', { expiresInHours: 24 }, 'req_same_invite'), { code: 'IDEMPOTENCY_CONFLICT' })
  const input = { inviteCode: invites[0].inviteCode, displayName: '爸爸' }
  const joins = await Promise.all(Array.from({ length: 3 }, () => repository.join('alice', input, 'req_same_join')))
  assert.deepEqual(joins[0], joins[1])
  await repository.join('alice', input, 'req_another_join')
  await assert.rejects(repository.join('alice', { ...input, displayName: '新名字' }, 'req_same_join'), { code: 'IDEMPOTENCY_CONFLICT' })
  assert.equal(cloud.all('family_members').length, 2)
  assert.equal(cloud.all('families')[0].memberCount, 2)
  assert.equal(cloud.all('operation_logs').filter((row) => row.requestId === 'req_same_join').length, 1)
  assert.equal(cloud.all('operation_logs').filter((row) => row.requestId === 'req_same_invite').length, 1)
})

test('joining two families concurrently or creating while joining cannot leave duplicate memberships', async () => {
  const { cloud, repository } = await setup()
  await repository.create('other', { name: '另一个饭桌', displayName: '管理员', timezone: 'Asia/Shanghai' }, 'req_create_other')
  const a = await repository.invite('owner', { expiresInHours: 72 }, 'req_invite_a')
  const b = await repository.invite('other', { expiresInHours: 72 }, 'req_invite_b')
  const results = await Promise.allSettled([
    repository.join('alice', { inviteCode: a.inviteCode, displayName: '家人' }, 'req_join_a'),
    repository.join('alice', { inviteCode: b.inviteCode, displayName: '家人' }, 'req_join_b'),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'FORBIDDEN')
  const race = await Promise.allSettled([
    repository.create('bob', { name: '自己的饭桌', displayName: '家人', timezone: 'Asia/Shanghai' }, 'req_create_bob'),
    repository.join('bob', { inviteCode: a.inviteCode, displayName: '家人' }, 'req_join_bob'),
  ])
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(cloud.all('family_members').filter((member) => member.userId === 'bob').length, 1)
  assert.equal(cloud.all('family_members').filter((member) => member.userId === 'alice').length, 1)
})

test('member limit and rollback leave user, member count, receipt, and logs unchanged', async () => {
  const { cloud, repository, familyId } = await setup()
  const invite = await repository.invite('owner', { expiresInHours: 72 }, 'req_invite_limit')
  const original = cloud.all('families')[0]
  cloud.seed('families', familyId, { ...original, memberCount: 20 })
  const input = { inviteCode: invite.inviteCode, displayName: '爸爸' }
  await assert.rejects(repository.join('alice', input, 'req_join_limit'), { code: 'FAMILY_FULL' })
  cloud.seed('families', familyId, original)
  cloud.failWrite((name) => name === 'operation_logs')
  await assert.rejects(repository.join('alice', input, 'req_join_rollback'), /injected/)
  assert.equal(cloud.all('family_members').length, 1)
  assert.equal(cloud.all('users').find((user) => user._id === 'alice').displayName, 'alice')
  assert.equal(cloud.all('families')[0].memberCount, 1)
  assert.equal(cloud.all('idempotency_records').some((row) => row.requestId === 'req_join_rollback'), false)
})

test('handler validates invite payloads, rejects forged identity and normalizes join input', async () => {
  let received
  const handler = createFamilyHandler({
    async join(...args) { received = args; return {} },
    async invite() { return {} },
  }, { error() {} })
  const base = { action: 'family.join', requestId: 'req_handler_join', payload: { inviteCode: ' abcd2345 ', displayName: ' 爸爸 ' } }
  assert.equal((await handler(base, { openid: 'trusted' })).ok, true)
  assert.deepEqual(received, ['trusted', { inviteCode: 'ABCD2345', displayName: '爸爸' }, base.requestId])
  for (const payload of [{ ...base.payload, familyId: 'forged' }, { ...base.payload, role: 'owner' }, { ...base.payload, openid: 'forged' }, { ...base.payload, inviteCode: '00001111' }]) {
    assert.equal((await handler({ ...base, payload }, { openid: 'trusted' })).error.code, 'VALIDATION_ERROR')
  }
  assert.equal((await handler({ ...base, requestId: '' }, { openid: 'trusted' })).error.code, 'VALIDATION_ERROR')
  for (const hours of [0, 169, 1.5, '72']) {
    assert.equal((await handler({ action: 'family.invite', requestId: base.requestId, payload: { expiresInHours: hours } }, { openid: 'trusted' })).error.code, 'VALIDATION_ERROR')
  }
  assert.equal((await handler(base, {})).error.code, 'UNAUTHENTICATED')
})
