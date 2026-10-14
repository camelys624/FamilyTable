'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../../miniprogram')
const { AppError, toAppError } = require(path.join(root, 'utils/app-error.js'))
const { CloudSessionAdapter } = require(path.join(root, 'modules/session/cloud-session-adapter.js'))
const { CloudFamilyAdapter } = require(path.join(root, 'modules/family/cloud-adapter.js'))

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
    '../../modules/preference/index': { preferenceModule: { getMine: async () => ({ spicyLevel: 1, avoidFoods: [], notes: '' }) } },
    '../../utils/write-intent': require(path.join(root, 'utils/write-intent.js')),
    '../../utils/app-error': { toAppError },
    '../../utils/request-id': { createRequestId: () => `req_page_${++sequence}` },
  }
  const wx = {
    showToast: (options) => toasts.push(options),
    setClipboardData: (options) => { copied.push(options.data); options.success?.() },
    showModal: (options) => modals.push(options),
    reLaunch: (options) => nav.push(options.url),
    switchTab: (options) => nav.push(options.url),
    navigateTo: (options) => nav.push(options.url),
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
  const { page, family } = pageHarness('pages/profile/index.js')
  await page.onShow()
  assert.equal(page.data.familyName, '云端真实家庭')
  assert.deepEqual(Array.from(page.data.members, (member) => member.isMe), [true, false])
  assert.equal(page.data.canInvite, true)
  assert.equal(page.data.members[0].role, '家长')
  assert.equal(page.data.members[1].role, '家庭成员')
  assert.equal(page.data.inviteCode, '')
  assert.equal(page.data.isLocal, false)
  family.getCurrentFamily = async () => {
    const current = currentFamily()
    current.members[1].displayName = '🐑'
    return current
  }
  await page.loadFamily()
  assert.equal(page.data.members[1].initial, '🐑')
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
      if (action === 'auth.acceptTerms') return {}
      if (action === 'family.current') return { family: { name: '真实饭桌' }, currentMember: { displayName: '爸爸' }, members: [{ displayName: '妈妈' }, { displayName: '爸爸' }] }
      assert.fail(`unexpected ${action}`)
    },
  })
  const input = { mode: 'join', userName: ' 爸爸 ', inviteCode: ' abcd2345 ', termsAccepted: true }
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
  harness.page.data.termsAccepted = true
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

test('owner edits the shared name, validates input and waits for the server before updating it', async () => {
  const writes = []
  let finish
  let current = currentFamily()
  const h = pageHarness('pages/settings/index.js', { family: {
    getCurrentFamily: async () => current,
    updateFamily: (name, expectedVersion, requestId) => {
      writes.push({ name, expectedVersion, requestId })
      return new Promise((resolve) => { finish = resolve })
    },
  } })
  await h.page.onShow()
  h.page.openFamilyEditor()
  h.page.onFamilyNameInput({ detail: { value: '   ' } })
  await h.page.saveFamilyName()
  assert.equal(writes.length, 0)
  assert.match(h.page.data.familyEditError, /1～40/)
  h.page.onFamilyNameInput({ detail: { value: ' 周末饭桌 ' } })
  const pending = h.page.saveFamilyName()
  await h.page.saveFamilyName()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].name, '周末饭桌')
  assert.equal(writes[0].expectedVersion, 0)
  assert.equal(h.page.data.familyName, '云端真实家庭')
  current = { ...current, family: { ...current.family, name: '周末饭桌', infoVersion: 1 } }
  finish({ family: current.family })
  await pending
  assert.equal(h.page.data.familyName, '周末饭桌')
  assert.equal(h.page.data.familyInfoVersion, 1)
  assert.equal(h.page.data.familyEditorOpen, false)
  assert.equal(h.toasts.at(-1).title, '饭桌名称已更新')
})

test('ordinary member cannot open or submit the family editor even if a stale form is present', async () => {
  let writes = 0
  const h = pageHarness('pages/settings/index.js', { family: {
    getCurrentFamily: async () => currentFamily('member'),
    updateFamily: async () => { writes++ },
  } })
  await h.page.onShow()
  h.page.openFamilyEditor()
  assert.equal(h.page.data.familyEditorOpen, false)
  h.page.data.familyEditorOpen = true
  h.page.data.familyDraftName = '不能修改'
  await h.page.saveFamilyName()
  assert.equal(writes, 0)
})

test('lost rename response freezes the original name and version and reuses the request on retry', async () => {
  const writes = []
  let current = currentFamily()
  const h = pageHarness('pages/settings/index.js', { family: {
    getCurrentFamily: async () => current,
    updateFamily: async (name, expectedVersion, requestId) => {
      writes.push({ name, expectedVersion, requestId })
      if (writes.length === 1) throw new AppError('NETWORK_ERROR', '响应丢失')
      current = { ...current, family: { ...current.family, name, infoVersion: 1 } }
      return { family: current.family }
    },
  } })
  await h.page.onShow()
  h.page.openFamilyEditor()
  h.page.onFamilyNameInput({ detail: { value: '家人饭桌' } })
  await h.page.saveFamilyName()
  assert.equal(h.page.data.familyPending, true)
  h.page.onFamilyNameInput({ detail: { value: '另一个名称' } })
  h.page.closeFamilyEditor()
  assert.equal(h.page.data.familyDraftName, '家人饭桌')
  assert.equal(h.page.data.familyEditorOpen, true)
  await h.page.saveFamilyName()
  assert.deepEqual(writes[0], writes[1])
  assert.equal(h.page.data.familyName, '家人饭桌')
  assert.equal(h.page.data.familyPending, false)
})

test('rename conflict refreshes the version while preserving the draft for an explicit next save', async () => {
  let writes = 0
  const h = pageHarness('pages/settings/index.js', { family: {
    getCurrentFamily: async () => ({ ...currentFamily(), family: { id: 'family-real', name: writes ? '家人最新名称' : '原名称', infoVersion: writes ? 8 : 2 } }),
    updateFamily: async () => { writes++; throw new AppError('VERSION_CONFLICT', '名称已更新，请确认后重新保存') },
  } })
  await h.page.onShow()
  h.page.openFamilyEditor()
  h.page.onFamilyNameInput({ detail: { value: '我的草稿' } })
  await h.page.saveFamilyName()
  assert.equal(writes, 1)
  assert.equal(h.page.data.familyName, '家人最新名称')
  assert.equal(h.page.data.familyInfoVersion, 8)
  assert.equal(h.page.data.familyDraftName, '我的草稿')
  assert.equal(h.page.data.familyEditorOpen, true)
  assert.equal(h.page.data.familyPending, false)
  assert.match(h.page.data.familyEditError, /重新保存/)
})

test('revoked administrator rights refresh the member role and disable further saves', async () => {
  let writes = 0
  const h = pageHarness('pages/settings/index.js', { family: {
    getCurrentFamily: async () => currentFamily(writes ? 'member' : 'owner'),
    updateFamily: async () => { writes++; throw new AppError('FORBIDDEN', '仅管理员可修改') },
  } })
  await h.page.onShow()
  h.page.openFamilyEditor()
  h.page.onFamilyNameInput({ detail: { value: '新饭桌' } })
  await h.page.saveFamilyName()
  await h.page.saveFamilyName()
  assert.equal(writes, 1)
  assert.equal(h.page.data.canEditFamily, false)
})

test('family adapter sends only the name and version, and normalizes legacy version zero', async () => {
  const calls = []
  const adapter = new CloudFamilyAdapter({ call: async (...args) => { calls.push(args); return calls.length === 1 ? currentFamily() : { family: { id: 'family-real', name: '新饭桌', infoVersion: 1 } } } })
  assert.equal((await adapter.getCurrentFamily()).family.infoVersion, 0)
  await adapter.updateFamily('新饭桌', 0, 'req_rename_1')
  assert.deepEqual(calls[1], ['family', 'family.update', { name: '新饭桌', expectedVersion: 0 }, 'req_rename_1'])
})

test('profile settings entrance opens a registered page and settings retains the privacy link', async () => {
  const h = pageHarness('pages/profile/index.js')
  h.page.openSettings()
  assert.deepEqual(h.nav, ['/pages/settings/index'])
  const s = pageHarness('pages/settings/index.js')
  s.page.openLegal()
  assert.deepEqual(s.nav, ['/pages/legal/index?type=privacy'])
  const routes = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).pages
  assert.ok(routes.includes('pages/settings/index'))
})

test('settings cloud loading failure disables edits and retry loads the actual shared name', async () => {
  const h = pageHarness('pages/settings/index.js', { family: { getCurrentFamily: async () => { throw new AppError('NETWORK_ERROR', '连接失败') } } })
  await h.page.onShow()
  h.page.openFamilyEditor()
  assert.equal(h.page.data.canEditFamily, false)
  assert.equal(h.page.data.familyEditorOpen, false)
  assert.equal(h.page.data.familyError, '连接失败')
  h.family.getCurrentFamily = async () => currentFamily()
  await h.page.loadFamily()
  assert.equal(h.page.data.familyName, '云端真实家庭')
  assert.equal(h.page.data.familyError, '')
})

test('profile refreshes a renamed table on return from settings', async () => {
  const h = pageHarness('pages/profile/index.js')
  await h.page.onShow()
  h.family.getCurrentFamily = async () => ({ ...currentFamily(), family: { id: 'family-real', name: '新的饭桌名称', infoVersion: 1 } })
  await h.page.onShow()
  assert.equal(h.page.data.familyName, '新的饭桌名称')
})
