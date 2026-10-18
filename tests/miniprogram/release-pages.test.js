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
  const preference = { getMine: async () => ({ spicyLevel: 2, avoidFoods: ['花生'], allergies: [], notes: '' }), updateMine: async (input) => input, ...modules.preference }
  const shopping = { getList: async () => list(), addItem: async () => list(2), checkItem: async () => list(2), generate: async () => list(2), clearChecked: async () => list(2), ...modules.shopping }
  const vote = { getCurrent: async () => emptyVote(), cast: async () => ({}), createPoll: async () => ({}), close: async () => ({}), ...modules.vote }
  const mocks = {
    '../../utils/app-error': { AppError, toAppError }, '../../utils/write-intent': { WriteIntent },
    '../../utils/request-id': require(path.join(root, 'utils/request-id')),
    '../../config/runtime': { runtimeConfig: { repositoryMode: 'cloud' } },
    '../../config/preference-options': require(path.join(root, 'config/preference-options')),
    '../../utils/display-name': require(path.join(root, 'utils/display-name')),
    '../../utils/date': { getFamilyToday: () => '2026-10-13', getCurrentWeekKey: () => '2026-10-12', formatToday: () => '10月13日' },
    '../../services/store': { resetDemo() {} },
    '../../modules/recipe/cloud-adapter': { toRecipe },
    '../../modules/recipe/index': { recipeModule: { listRecipes: async () => [], ...modules.recipe } },
    '../../modules/menu/index': { menuModule: { getWeekMenu: async () => ({ days: Array.from({ length: 7 }, () => ({ breakfast: [], lunch: [], dinner: [] })) }), ...modules.menu } },
    '../../modules/vote/index': { voteModule: vote }, '../../modules/shopping/index': { shoppingModule: shopping }, '../../modules/preference/index': { preferenceModule: preference },
    '../../modules/family/index': { familyModule: { getCurrentFamily: async () => ({ family: { name: '真实家庭' }, currentMember: { id: 'member', displayName: '妈妈', role: 'owner' }, members: [{ id: 'member', displayName: '妈妈', role: 'owner' }], invitation: { active: false, expiresAt: '' } }) } },
    '../../modules/session/index': { ensureSession: async () => ({ onboarded: true, familyName: '缓存旧名称' }), clearSession() {}, completeOnboarding: async () => {}, ...modules.session },
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, route), 'utf8'), { exports: {}, require(id) { assert.ok(mocks[id], `unexpected ${id}`); return mocks[id] }, Page(options) { page = options }, wx: { showToast: (options) => toasts.push(options), navigateTo: (options) => navigation.push(options.url), reLaunch: (options) => navigation.push(options.url), showModal: (options) => modals.push(options), stopPullDownRefresh() {}, ...modules.wx } })
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
  const h = harness('pages/profile/index.js', { preference: { getMine: async () => ({ spicyLevel: 2, avoidFoods: ['花生'], allergies: ['虾蟹'], notes: '原有备注' }), updateMine: async (input, requestId) => {
    requests.push({ input, requestId })
    if (requests.length === 1) throw new AppError('NETWORK_ERROR', '响应丢失')
    return input
  } } })
  await h.page.onShow()
  assert.deepEqual([...h.page.data.dislikes], ['花生'])
  assert.deepEqual([...h.page.data.allergies], ['虾蟹'])
  assert.equal(h.page.data.spicyLevel, 2)
  assert.equal(h.page.data.dirty, false)

  h.page.pickSpicy({ currentTarget: { dataset: { level: '3' } } })
  assert.equal(h.page.data.spicyLevel, 3)
  assert.equal(h.page.data.dirty, true)

  await h.page.onSave()
  // 保存结果未知时输入被锁住，后续改动不生效
  h.page.toggleOption({ currentTarget: { dataset: { key: 'dislike', value: '香菜' } } })
  h.page.pickSpicy({ currentTarget: { dataset: { level: '0' } } })
  assert.equal(h.page.data.spicyLevel, 3)
  assert.deepEqual([...h.page.data.dislikes], ['花生'])

  await h.page.onSave()
  assert.equal(requests[0].requestId, requests[1].requestId)
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1].input.avoidFoods)), ['花生'])
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1].input.allergies)), ['虾蟹'])
  assert.equal(requests[1].input.notes, '原有备注')
  assert.equal(requests[1].input.spicyLevel, 3)
  assert.equal(h.page.data.dirty, false)
})

test('a rejected preference save keeps the draft editable and can be saved again', async () => {
  const requests = []
  const h = harness('pages/profile/index.js', { preference: { getMine: async () => ({ spicyLevel: 1, avoidFoods: [], allergies: [], notes: '' }), updateMine: async (input, requestId) => {
    requests.push({ input: JSON.parse(JSON.stringify(input)), requestId })
    // 未更新的 preference 云函数不认识 allergies 字段
    if (requests.length === 1) throw new AppError('VALIDATION_ERROR', '请求包含不支持的字段')
    return input
  } } })
  await h.page.onShow()
  h.page.toggleOption({ currentTarget: { dataset: { key: 'allergen', value: '虾蟹' } } })
  await h.page.onSave()

  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].input.allergies, ['虾蟹'])
  assert.equal(h.page.data.preferenceSaveError, '请求包含不支持的字段')
  assert.equal(h.page.data.preferenceError, '', '保存失败不能伪装成读取失败、要求重新加载')
  assert.equal(h.page.data.preferencePending, false)
  assert.equal(h.page.data.dirty, true)
  assert.equal(h.page.data.canSave, true)

  // 返回本页（例如从设置页回来）不会用服务端旧值冲掉草稿
  await h.page.onShow()
  assert.deepEqual([...h.page.data.allergies], ['虾蟹'])

  // 草稿仍可编辑，编辑后旧错误消失，再保存是一次新的请求
  h.page.pickSpicy({ currentTarget: { dataset: { level: '2' } } })
  assert.equal(h.page.data.spicyLevel, 2)
  assert.equal(h.page.data.preferenceSaveError, '')
  await h.page.onSave()
  assert.equal(requests.length, 2)
  assert.notEqual(requests[0].requestId, requests[1].requestId)
  assert.equal(requests[1].input.spicyLevel, 2)
  assert.deepEqual(requests[1].input.allergies, ['虾蟹'])
  assert.equal(h.page.data.dirty, false)
  assert.equal(h.page.data.preferenceSaveError, '')
})

test('preference payload omits empty allergies so users without allergens can save on any deployed version', async () => {
  const requests = []
  const h = harness('pages/profile/index.js', { preference: { updateMine: async (input) => { requests.push(JSON.parse(JSON.stringify(input))); return input } } })
  await h.page.onShow()
  h.page.pickSpicy({ currentTarget: { dataset: { level: '0' } } })
  await h.page.onSave()
  assert.deepEqual(Object.keys(requests[0]).sort(), ['avoidFoods', 'notes', 'spicyLevel'])
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

test('home reads the latest shared family name instead of its stale login snapshot', async () => {
  const h = harness('pages/home/index.js')
  await h.page.onShow()
  assert.equal(h.page.data.familyName, '真实家庭')
  assert.equal(h.page.data.loadError, '')
  assert.equal(h.page.data.loading, false)
})

test('home uses server poll permissions and clears a stale create action on failure', async () => {
  const h = harness('pages/home/index.js')
  await h.page.onShow()
  assert.equal(h.page.data.canCreatePoll, true)
  assert.equal(h.page.data.pollId, '')
  h.page.openVote()
  assert.equal(h.navigation[0], '/pages/vote/index')
  h.vote.getCurrent = async () => ({ ...emptyVote(), canCreate: false })
  await h.page.loadData()
  assert.equal(h.page.data.canCreatePoll, false)
  h.vote.getCurrent = async () => { throw new AppError('NETWORK_ERROR', '投票连接失败') }
  await h.page.loadData()
  assert.equal(h.page.data.canCreatePoll, false)
  assert.equal(h.page.data.voteError, '投票连接失败')
  assert.equal(h.page.data.loadError, '')
})

test('home keeps each meal distinct and falls back from failed photos to food artwork', async () => {
  const ribs = toRecipe({ id: 'ribs', name: '山楂小排', category: '家常菜', duration: 45, difficulty: 'easy', imagePath: 'https://example.com/ribs.jpg', ingredients: [{ name: '猪肋排', usedUp: true }, { name: '山楂', usedUp: true }] })
  const greens = toRecipe({ id: 'greens', name: '白灼菜心', category: '素菜', duration: 10, difficulty: 'easy', ingredients: [{ name: '菜心', usedUp: true }] })
  const entry = { id: 'entry', recipeId: ribs.id, recipe: ribs }
  const h = harness('pages/home/index.js', {
    recipe: { listRecipes: async () => [ribs, greens] },
    menu: { getWeekMenu: async () => ({ days: [{ breakfast: [], lunch: [entry], dinner: [entry] }] }) },
    session: { ensureSession: async () => ({ onboarded: true, userName: '微信用户' }) },
  })
  await h.page.onShow()
  const dishes = h.page.data.todayDishes
  assert.equal(dishes[0].mealLabel, '午餐')
  assert.equal(dishes[1].mealLabel, '晚餐')
  assert.notEqual(dishes[0].displayKey, dishes[1].displayKey)
  assert.equal(dishes[0].foodEmoji, '🍖')
  assert.match(dishes[0].subtitle, /猪肋排 · 山楂/)
  assert.equal(dishes[2].artKind, 'greensDish')
  assert.match(dishes[2].subtitle, /待安排/)
  assert.equal(h.page.data.greeting, '小厨师，开饭啦')
  h.page.onDishImageError({ currentTarget: { dataset: { id: 'ribs' } } })
  assert.equal(h.page.data.todayDishes[0].imagePath, '')
  assert.equal(h.page.data.todayDishes[1].imagePath, '')
})

test('home retains poll results with zero votes and works with an empty week', async () => {
  const result = emptyVote()
  result.poll = { id: 'poll-empty', candidates: [] }
  const h = harness('pages/home/index.js', { menu: { getWeekMenu: async () => ({ days: [] }) }, vote: { getCurrent: async () => result } })
  await h.page.onShow()
  assert.equal(h.page.data.pollId, 'poll-empty')
  assert.equal(h.page.data.familyName, '真实家庭')
  assert.equal(h.page.data.loading, false)
})

test('home keeps poll snapshot names while reusing available recipe photos', async () => {
  const current = toRecipe({ id: 'shrimp', name: '改名后的菜', duration: 30, category: '家常菜', difficulty: 'easy', imagePath: 'https://example.com/shrimp.jpg', ingredients: [] })
  const result = emptyVote()
  result.poll = { id: 'poll-real', candidates: [{ recipeId: 'shrimp', recipeSnapshot: { name: '虾仁豆腐蒸蛋', durationMinutes: 20, category: '家常菜', difficulty: 'easy', ingredients: [] } }] }
  const h = harness('pages/home/index.js', { recipe: { listRecipes: async () => [current] }, vote: { getCurrent: async () => result } })
  await h.page.onShow()
  assert.equal(h.page.data.pollCandidates[0].name, '虾仁豆腐蒸蛋')
  assert.equal(h.page.data.pollCandidates[0].duration, 20)
  assert.equal(h.page.data.pollCandidates[0].imagePath, current.imagePath)
})

test('home navigation reserves the device status bar and capsule space', () => {
  const h = harness('pages/home/index.js', { wx: { getWindowInfo: () => ({ statusBarHeight: 47, windowWidth: 390 }), getMenuButtonBoundingClientRect: () => ({ top: 51, height: 32, left: 285 }) } })
  h.page.onLoad()
  assert.equal(h.page.data.navTop, 47)
  assert.equal(h.page.data.navHeight, 40)
  assert.equal(h.page.data.navRight, 117)
})

test('home uses separate food artwork for shrimp custard and taro toast, with photos taking priority', async () => {
  const shrimp = toRecipe({ id: 'shrimp', name: '虾仁豆腐蒸蛋', category: '家常菜', duration: 20, difficulty: 'easy', imagePath: 'https://example.com/shrimp.jpg', ingredients: [{ name: '鸡蛋' }, { name: '虾仁' }] })
  const toast = toRecipe({ id: 'toast', name: '芋泥吐司', category: '早餐', duration: 20, difficulty: 'easy', ingredients: [{ name: '牛奶' }, { name: '鸡蛋' }] })
  const h = harness('pages/home/index.js', { recipe: { listRecipes: async () => [shrimp, toast] } })
  await h.page.onShow()
  assert.equal(h.page.data.todayDishes[0].foodSheetStyle, 'left:0;')
  assert.equal(h.page.data.todayDishes[1].foodSheetStyle, 'left:-100%;')
  assert.equal(h.page.data.todayDishes[0].foodEmoji, '🍤')
  assert.equal(h.page.data.todayDishes[1].foodEmoji, '🍞')
  assert.equal(h.page.data.todayDishes[0].imagePath, shrimp.imagePath)
  h.page.onDishImageError({ currentTarget: { dataset: { id: 'shrimp' } } })
  assert.equal(h.page.data.todayDishes[0].imagePath, '')
  assert.equal(h.page.data.todayDishes[0].foodSheetStyle, 'left:0;')
})

test('local preference adapter keeps allergies across save and reload', async () => {
  const state = { spicyLevel: 1, avoidFood: '香菜' }
  const store = {
    getState: () => JSON.parse(JSON.stringify(state)),
    updatePreferences(spicyLevel, avoidFood, allergies) { Object.assign(state, { spicyLevel, avoidFood, allergies }) },
  }
  const sandbox = { exports: {}, require(id) { assert.equal(id, '../../services/store'); return store } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/preference/local-adapter.js'), 'utf8'), sandbox)
  const adapter = new sandbox.exports.LocalPreferenceAdapter()
  assert.deepEqual(JSON.parse(JSON.stringify(await adapter.getMine())).allergies, [], '旧版本地数据没有 allergies 字段')
  await adapter.updateMine({ spicyLevel: 2, avoidFoods: ['葱'], allergies: ['芒果'], notes: '' })
  const reloaded = JSON.parse(JSON.stringify(await adapter.getMine()))
  assert.deepEqual(reloaded.allergies, ['芒果'])
  assert.deepEqual(reloaded.avoidFoods, ['葱'])
  assert.equal(reloaded.spicyLevel, 2)
})
