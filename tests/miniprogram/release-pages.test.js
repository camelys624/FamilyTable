'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../../miniprogram')
const { AppError, toAppError } = require(path.join(root, 'utils/app-error'))
const { WriteIntent } = require(path.join(root, 'utils/write-intent'))
const { toRecipe } = require(path.join(root, 'modules/recipe/cloud-adapter'))
const emptyVote = () => ({ poll: null, summary: { totalVotes: 0, candidates: [], currentMemberVoted: false }, voters: [], currentVote: null, canCreate: true })
const list = (version = 1, items = []) => ({ id: 'shopping-real', weekStart: '2026-10-12', version, sourceMenuVersion: 1, stale: false, items })
function harness(route, modules = {}) {
  let page
  const toasts = [], navigation = [], modals = []
  const preference = { getMine: async () => ({ spicyLevel: 2, avoidFoods: ['花生'], notes: '' }), updateMine: async (input) => input, ...modules.preference }
  const shopping = { getList: async () => list(), addItem: async () => list(2), checkItem: async () => list(2), generate: async () => list(2), clearChecked: async () => list(2), ...modules.shopping }
  const vote = { getCurrent: async () => emptyVote(), cast: async () => ({}), createPoll: async () => ({}), close: async () => ({}), ...modules.vote }
  const mocks = {
    '../../utils/app-error': { AppError, toAppError }, '../../utils/write-intent': { WriteIntent },
    '../../utils/request-id': require(path.join(root, 'utils/request-id')),
    '../../config/runtime': { runtimeConfig: { repositoryMode: 'cloud' } },
    '../../utils/date': { getFamilyToday: () => '2026-10-13', getCurrentWeekKey: () => '2026-10-12', formatToday: () => '10月13日' },
    '../../services/store': { resetDemo() {} },
    '../../modules/recipe/cloud-adapter': { toRecipe },
    '../../modules/recipe/index': { recipeModule: { listRecipes: async () => [] } },
    '../../modules/vote/index': { voteModule: vote }, '../../modules/shopping/index': { shoppingModule: shopping }, '../../modules/preference/index': { preferenceModule: preference },
    '../../modules/family/index': { familyModule: { getCurrentFamily: async () => ({ family: { name: '真实家庭' }, currentMember: { id: 'member', displayName: '妈妈', role: 'owner' }, members: [{ id: 'member', displayName: '妈妈', role: 'owner' }], invitation: { active: false, expiresAt: '' } }) } },
    '../../modules/session/index': { ensureSession: async () => ({ onboarded: true }), clearSession() {}, completeOnboarding: async () => {} },
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, route), 'utf8'), { exports: {}, require(id) { assert.ok(mocks[id], `unexpected ${id}`); return mocks[id] }, Page(options) { page = options }, wx: { showToast: (options) => toasts.push(options), navigateTo: (options) => navigation.push(options.url), reLaunch: (options) => navigation.push(options.url), showModal: (options) => modals.push(options), stopPullDownRefresh() {} } })
  page.data = structuredClone(page.data)
  page.setData = (patch) => Object.assign(page.data, patch)
  return { page, shopping, vote, preference, toasts, navigation, modals }
}

test('shopping reads actual cloud data, and failed loading cannot enable writes', async () => {
  let writes = 0
  const h = harness('pages/shopping/index.js', { shopping: { getList: async () => { throw new AppError('NETWORK_ERROR', '连接失败') }, addItem: async () => { writes++ } } })
  await h.page.onShow()
  h.page.data.newItem = '牛奶'
  await h.page.addItem()
  assert.equal(h.page.data.loadError, '连接失败')
  assert.equal(writes, 0)
  assert.equal(h.page.data.total, 0)
  h.shopping.getList = async () => list(4, [{ id: 'item-real', name: '牛奶', checked: false, category: '手动添加' }])
  await h.page.loadData()
  assert.equal(h.page.data.total, 1)
  assert.equal(h.page.data.version, 4)
})

test('lost shopping response freezes the original write, blocks duplicates and reuses its receipt', async () => {
  const requests = []
  let rejectFirst
  const h = harness('pages/shopping/index.js', { shopping: { addItem: (input, requestId) => {
    requests.push({ input, requestId })
    if (requests.length === 1) return new Promise((_, reject) => { rejectFirst = reject })
    return Promise.resolve(list(2, [{ id: 'item-new', name: input.name, checked: false, category: '手动添加' }]))
  } } })
  await h.page.onShow()
  h.page.data.newItem = '牛奶'
  const pending = h.page.addItem()
  await h.page.addItem()
  h.page.onNewItem({ detail: { value: '鸡蛋' } })
  rejectFirst(new AppError('NETWORK_ERROR', '结果未知'))
  await pending
  assert.equal(h.page.data.newItem, '牛奶')
  assert.equal(h.page.data.pending, true)
  await h.page.retryPending()
  assert.equal(requests.length, 2)
  assert.equal(requests[0].requestId, requests[1].requestId)
  assert.equal(requests[1].input.name, '牛奶')
  assert.equal(requests[1].input.expectedVersion, 1)
  assert.equal(h.page.data.newItem, '')
})

test('shopping conflict refreshes the list, preserves input and requires a new explicit submit', async () => {
  let attempts = 0
  const h = harness('pages/shopping/index.js', { shopping: { getList: async () => list(attempts ? 8 : 2), addItem: async () => { attempts++; throw new AppError('VERSION_CONFLICT', '家人已更新') } } })
  await h.page.onShow()
  h.page.data.newItem = '牛奶'
  await h.page.addItem()
  assert.equal(attempts, 1)
  assert.equal(h.page.data.version, 8)
  assert.equal(h.page.data.newItem, '牛奶')
  assert.equal(h.page.data.pending, false)
  assert.match(h.page.data.writeError, /家人/)
})

test('vote displays real counts only and failed casts never optimistically mark a vote', async () => {
  const result = emptyVote()
  result.poll = { id: 'poll-real', title: '今天吃什么', status: 'open', closesAt: '2026-10-13T15:59:00Z', candidates: [{ recipeId: 'recipe-real', recipeSnapshot: { name: '鸡蛋', category: '家常菜', difficulty: 'easy', ingredients: [] } }] }
  result.summary = { totalVotes: 0, candidates: [{ recipeId: 'recipe-real', voteCount: 0 }], currentMemberVoted: false }
  let calls = 0
  const h = harness('pages/vote/index.js', { vote: { getCurrent: async () => result, cast: async () => { calls++; throw new AppError('NETWORK_ERROR', '响应丢失') } } })
  await h.page.onShow()
  assert.equal(h.page.data.totalVotes, 0)
  assert.equal(h.page.data.participantCount, 0)
  await h.page.vote({ currentTarget: { dataset: { id: 'recipe-real' } } })
  await h.page.vote({ currentTarget: { dataset: { id: 'recipe-real' } } })
  assert.equal(calls, 1)
  assert.equal(h.page.data.votedRecipeId, '')
  assert.equal(h.page.data.pending, true)
})

test('ordinary members cannot create polls and closed polls cannot be cast from the page', async () => {
  let writes = 0
  const h = harness('pages/vote/index.js', { vote: { getCurrent: async () => ({ ...emptyVote(), canCreate: false }), createPoll: async () => { writes++ }, cast: async () => { writes++ } } })
  await h.page.onShow()
  h.page.openCreate()
  await h.page.createPoll()
  await h.page.vote({ currentTarget: { dataset: { id: 'recipe' } } })
  assert.equal(writes, 0)
  assert.equal(h.page.data.showCreate, false)
})

test('profile loads private cloud preferences and retries exactly the saved intent after a network error', async () => {
  const requests = []
  const h = harness('pages/profile/index.js', { preference: { getMine: async () => ({ spicyLevel: 2, avoidFoods: ['花生'], notes: '原有备注' }), updateMine: async (input, requestId) => {
    requests.push({ input, requestId })
    if (requests.length === 1) throw new AppError('NETWORK_ERROR', '响应丢失')
    return input
  } } })
  await h.page.onShow()
  assert.equal(h.page.data.avoidFood, '花生')
  assert.equal(h.page.data.spicyLevel, 2)
  await h.page.saveAvoidFood()
  h.page.onAvoidInput({ detail: { value: '香菜' } })
  assert.equal(h.page.data.avoidFood, '花生')
  await h.page.saveAvoidFood()
  assert.equal(requests[0].requestId, requests[1].requestId)
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1].input.avoidFoods)), ['花生'])
  assert.equal(requests[1].input.notes, '原有备注')
})

test('new users cannot submit onboarding until explicitly accepting the agreements', async () => {
  const h = harness('pages/onboarding/index.js')
  await h.page.continue()
  assert.equal(h.navigation.length, 0)
  assert.equal(h.page.data.termsAccepted, false)
  assert.match(h.toasts[0].title, /同意/)
  h.page.onAgreementChange({ detail: { value: ['accepted'] } })
  assert.equal(h.page.data.termsAccepted, true)
})
