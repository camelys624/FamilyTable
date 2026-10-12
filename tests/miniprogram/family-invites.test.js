'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../../miniprogram')
const { AppError, toAppError } = require(path.join(root, 'utils/app-error.js'))
const { CloudSessionAdapter } = require(path.join(root, 'modules/session/cloud-session-adapter.js'))

function currentFamily(role = 'owner') {
  return {
    family: { id: 'family-real', name: '云端真实家庭' },
    currentMember: { id: 'member-real', displayName: '妈妈', role },
    members: [
      { id: 'member-real', displayName: '妈妈', role },
      { id: 'member-2', displayName: '妈妈', role: 'member' },
    ],
    invitation: { active: false, expiresAt: '' },
  }
}

function pageHarness(route, overrides = {}) {
  let definition
  const toasts = [], copied = [], nav = [], modals = []
  let sequence = 0
  const session = { ensureSession: async () => ({ onboarded: true, source: 'cloud' }), clearSession() {}, ...overrides.session }
  const family = { getCurrentFamily: async () => currentFamily(), createInvitation: async () => ({ familyId: 'family-real', inviteCode: 'ABCD2345', expiresAt: new Date(Date.now() + 72 * 3600000).toISOString() }), ...overrides.family }
  const mocks = {
    '../../services/store': { getState: () => ({ familyName: '本地假家庭', members: ['假妈妈'], spicyLevel: 1, avoidFood: '' }), updatePreferences() {}, resetDemo() {} },
    '../../config/runtime': { runtimeConfig: { repositoryMode: 'cloud' } },
    '../../modules/session/index': session,
    '../../modules/family/index': { familyModule: family },
    '../../utils/app-error': { toAppError },
    '../../utils/request-id': { createRequestId: () => `req_page_${++sequence}` },
  }
  const wx = {
    showToast: (options) => toasts.push(options),
    setClipboardData: (options) => { copied.push(options.data); options.success?.() },
    showModal: (options) => modals.push(options),
    reLaunch: (options) => nav.push(options.url),
    switchTab: (options) => nav.push(options.url),
    cloud: {},
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, route), 'utf8'), {
    require: (id) => { assert.ok(mocks[id], `unexpected dependency ${id}`); return mocks[id] },
    exports: {}, Page: (options) => { definition = options }, wx,
  })
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch) } }
  return { page, wx, family, toasts, copied, nav, modals }
}

test('profile shows actual cloud members and marks me by member ID even with duplicate names', async () => {
  const { page } = pageHarness('pages/profile/index.js')
  await page.onShow()
  assert.equal(page.data.familyName, '云端真实家庭')
  assert.deepEqual(Array.from(page.data.members, (member) => member.isMe), [true, false])
  assert.equal(page.data.canInvite, true)
  assert.equal(page.data.inviteCode, '')
  assert.equal(page.data.isLocal, false)
})

test('profile cloud failure does not show demo data and can retry loading', async () => {
  const harness = pageHarness('pages/profile/index.js', { family: { getCurrentFamily: async () => { throw new AppError('NETWORK_ERROR', '连接失败') } } })
  await harness.page.onShow()
  assert.equal(harness.page.data.familyName, '')
  assert.equal(harness.page.data.members.length, 0)
  assert.equal(harness.page.data.canInvite, false)
  assert.equal(harness.page.data.familyError, '连接失败')
  harness.family.getCurrentFamily = async () => currentFamily()
  await harness.page.loadFamily()
  assert.equal(harness.page.data.familyName, '云端真实家庭')
  assert.equal(harness.page.data.familyError, '')
})

test('profile generates and copies a real code; expired codes are not copied', async () => {
  const { page, copied } = pageHarness('pages/profile/index.js')
  await page.onShow()
  await page.addMember()
  assert.equal(page.data.inviteCode, 'ABCD2345')
  assert.match(page.data.inviteExpiryLabel, /前有效/)
  page.copyInviteCode()
  assert.deepEqual(copied, ['ABCD2345'])
  page.data.inviteExpiresAt = new Date(0).toISOString()
  page.copyInviteCode()
  assert.deepEqual(copied, ['ABCD2345'])
  assert.equal(page.data.inviteCode, '')
})

test('ordinary members cannot generate codes and code rotation requires confirmation', async () => {
  let calls = 0
  const member = pageHarness('pages/profile/index.js', { family: {
    getCurrentFamily: async () => currentFamily('member'),
    createInvitation: async () => { calls++; throw new Error('should not call') },
  } })
  await member.page.onShow()
  await member.page.addMember()
  member.page.rotateInvitation()
  assert.equal(calls, 0)
  assert.equal(member.modals.length, 0)
  const owner = pageHarness('pages/profile/index.js')
  await owner.page.onShow()
  owner.page.data.invitationActive = true
  await owner.page.addMember()
  assert.equal(owner.modals.length, 1)
  owner.modals[0].success({ confirm: false })
  assert.equal(owner.page.data.inviteCode, '')
})

test('invite prevents duplicate submits and retries a lost response using the same request ID', async () => {
  const requests = []
  let rejectFirst
  const harness = pageHarness('pages/profile/index.js', { family: {
    createInvitation: async (requestId) => {
      requests.push(requestId)
      if (requests.length === 1) return new Promise((_, reject) => { rejectFirst = reject })
      return { familyId: 'family-real', inviteCode: 'ABCD2345', expiresAt: new Date(Date.now() + 72 * 3600000).toISOString() }
    },
  } })
  await harness.page.onShow()
  const pending = harness.page.addMember()
  await harness.page.addMember()
  assert.equal(requests.length, 1)
  assert.equal(harness.page.data.inviteCode, '')
  rejectFirst(new AppError('NETWORK_ERROR', '连接中断'))
  await pending
  await harness.page.addMember()
  assert.deepEqual(requests, ['req_page_1', 'req_page_1'])
  assert.equal(harness.page.data.inviteCode, 'ABCD2345')
})

test('cloud onboarding joins by code and recovers from a lost response without creating another request', async () => {
  const requests = []
  let joined = false
  const adapter = new CloudSessionAdapter({
    async call(domain, action, payload, requestId) {
      if (action === 'family.join') {
        requests.push({ action, payload, requestId })
        joined = true
        if (requests.length === 1) throw new AppError('NETWORK_ERROR', '响应丢失')
        return {}
      }
      if (action === 'auth.login') return { user: { displayName: '爸爸' }, family: joined ? { name: '真实饭桌' } : null, onboardingRequired: !joined }
      if (action === 'family.current') return { family: { name: '真实饭桌' }, currentMember: { displayName: '爸爸' }, members: [{ displayName: '妈妈' }, { displayName: '爸爸' }] }
      assert.fail(`unexpected ${action}`)
    },
  })
  const input = { mode: 'join', userName: ' 爸爸 ', inviteCode: ' abcd2345 ' }
  await assert.rejects(adapter.completeOnboarding(input), { code: 'NETWORK_ERROR' })
  const session = await adapter.completeOnboarding(input)
  assert.equal(requests[0].requestId, requests[1].requestId)
  assert.deepEqual(requests[0].payload, { inviteCode: 'ABCD2345', displayName: '爸爸' })
  assert.equal(session.onboarded, true)
  assert.equal(session.source, 'cloud')
  assert.equal(session.familyName, '真实饭桌')
  assert.deepEqual(session.members, ['妈妈', '爸爸'])
})

test('onboarding freezes pending form input, preserves server errors and navigates only after joining', async () => {
  let rejectJoin
  let calls = 0
  const harness = pageHarness('pages/onboarding/index.js', { session: {
    completeOnboarding: async () => { calls++; return new Promise((_, reject) => { rejectJoin = reject }) },
  } })
  harness.page.data.mode = 'join'
  harness.page.data.inviteCode = 'ABCD2345'
  const pending = harness.page.continue()
  harness.page.onInviteCode({ detail: { value: 'ZZZZ9999' } })
  harness.page.setMode({ currentTarget: { dataset: { mode: 'create' } } })
  await harness.page.continue()
  assert.equal(calls, 1)
  assert.equal(harness.page.data.mode, 'join')
  assert.equal(harness.page.data.inviteCode, 'ABCD2345')
  assert.equal(harness.nav.length, 0)
  rejectJoin(new AppError('INVITE_EXPIRED', '邀请码已过期'))
  await pending
  assert.equal(harness.page.data.errorMessage, '邀请码已过期')
  assert.equal(harness.page.data.submitting, false)
  harness.page.onInviteCode({ detail: { value: ' wxyz6789 ' } })
  assert.equal(harness.page.data.inviteCode, 'WXYZ6789')
  assert.equal(harness.page.data.errorMessage, '')
})
