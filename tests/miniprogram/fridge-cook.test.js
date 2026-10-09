'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')

const MINIPROGRAM = path.resolve(__dirname, '../../miniprogram')
const { AppError } = require(path.join(MINIPROGRAM, 'utils/app-error.js'))
const OPTIONS = { weekStart: '2026-10-05', date: '2026-10-09', mealType: 'dinner', itemId: 'item-1', menuId: 'menu-1' }

function batch(id, overrides = {}) {
  return { id, name: '鸡蛋', version: 1, expiresOn: '2026-10-12', remaining: true, usable: true, expired: false, statusLabel: '可用 · 有剩', expiryLabel: '2026-10-12', ...overrides }
}

function menu(ingredients = [{ name: '鸡蛋', usedUp: true }]) {
  return {
    id: OPTIONS.menuId,
    weekStart: OPTIONS.weekStart,
    days: [{ key: OPTIONS.date, breakfast: [], lunch: [], dinner: [{ id: OPTIONS.itemId, recipe: { name: '菜单快照里的菜', ingredients } }] }],
  }
}

function checkbox(id, value) {
  return { currentTarget: { dataset: { id } }, detail: { value } }
}

function drive(t, config = {}) {
  const paths = ['modules/menu/index.js', 'modules/fridge/index.js', 'utils/request-id.js', 'pages/fridge/cook.js'].map((file) => path.join(MINIPROGRAM, file))
  const saved = paths.map((file) => require.cache[file])
  const oldPage = global.Page
  const oldWx = global.wx
  t.after(() => {
    paths.forEach((file, index) => {
      if (saved[index]) require.cache[file] = saved[index]
      else delete require.cache[file]
    })
    global.Page = oldPage
    global.wx = oldWx
  })
  const state = { batches: config.batches || [batch('early'), batch('later', { expiresOn: '2026-10-20' })], menu: config.menu || menu(), calls: [], batchReads: 0, menuReads: 0, navigations: [] }
  let sequence = 0
  const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
  stub(paths[0], { menuModule: { getWeekMenu: async (weekStart) => { state.menuReads++; assert.equal(weekStart, OPTIONS.weekStart); return state.menu } } })
  stub(paths[1], { fridgeModule: {
    listBatches: async () => { state.batchReads++; return state.batches },
    cook: async (input, requestId) => {
      state.calls.push({ input: JSON.parse(JSON.stringify(input)), requestId })
      if (config.cook) return config.cook(input, requestId, state.calls.length)
      return input.batches.map((choice) => ({ ...state.batches.find((entry) => entry.id === choice.batchId), remaining: !choice.usedUp, usable: !choice.usedUp, version: choice.expectedVersion + 1, statusLabel: choice.usedUp ? '已用完' : '仍有剩' }))
    },
  } })
  stub(paths[2], { createRequestId: () => `cook-request-${++sequence}` })
  global.wx = { navigateBack: () => state.navigations.push('back'), navigateTo: ({ url }) => state.navigations.push(url) }
  let definition
  global.Page = (options) => { definition = options }
  delete require.cache[paths[3]]
  require(paths[3])
  const page = Object.create(definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = (patch) => Object.assign(page.data, patch)
  return { page, state }
}

test('failed submit preserves selected actual batches and usedUp, without displaying consumed', async (t) => {
  const { page, state } = drive(t, { cook: async () => { throw new AppError('NETWORK_ERROR', '连接中断') } })
  await page.onLoad(OPTIONS)
  page.selectBatch(checkbox('later', ['selected']))
  page.toggleUsedUp(checkbox('early', []))
  const before = JSON.parse(JSON.stringify(page.data.ingredients))
  await page.submit()
  assert.equal(page.data.submitted, false)
  assert.equal(page.data.submitting, false)
  assert.deepEqual(page.data.results, [])
  assert.deepEqual(page.data.ingredients, before)
  assert.equal(page.data.outcomeUncertain, true)
  assert.match(page.data.submitError, /尚未确认/)
  await page.submit()
  assert.equal(state.calls.length, 2)
  assert.deepEqual(state.calls[1], state.calls[0], 'identical retries retain both request ID and payload')
})

test('defaults use menu snapshot, earliest usable matching batch, and backend canonical names', async (t) => {
  const { page } = drive(t, {
    menu: menu([{ name: ' 鸡 蛋 ', usedUp: false }, { name: '牛奶', usedUp: true }]),
    batches: [batch('undated', { expiresOn: '' }), batch('later', { expiresOn: '2026-10-20' }), batch('expired', { expired: true }), batch('spoiled', { usable: false }), batch('closed', { remaining: false }), batch('other', { name: '番茄' }), batch('earliest')],
  })
  await page.onLoad(OPTIONS)
  assert.equal(page.data.recipeName, '菜单快照里的菜')
  assert.deepEqual(page.data.ingredients[0].batches.map((entry) => entry.id), ['earliest', 'later', 'undated'])
  assert.deepEqual(page.data.ingredients[0].batches.map((entry) => entry.selected), [true, false, false])
  assert.deepEqual(page.data.ingredients[0].batches.map((entry) => entry.usedUp), [false, false, false])
  assert.deepEqual(page.data.ingredients[1].batches, [], 'missing ingredient is represented for its warning')
})

test('confirmed receipt blocks re-submission and survives returning from inventory', async (t) => {
  const { page, state } = drive(t, { batches: [batch('early'), batch('later', { version: 7, expiresOn: '2026-10-20' }), batch('untouched', { expiresOn: '2026-10-25' })] })
  await page.onLoad(OPTIONS)
  page.selectBatch(checkbox('later', ['selected']))
  page.toggleUsedUp(checkbox('later', []))
  await page.submit()
  assert.equal(page.data.submitted, true)
  const reads = state.batchReads
  await page.submit()
  page.openFridge()
  await page.onShow()
  assert.equal(state.calls.length, 1, 'confirmed page cannot submit again')
  assert.equal(state.batchReads, reads, 'submitted receipt is not discarded on returning from inventory')
  assert.equal(page.data.submitted, true)
})

test('in-flight submission guards every action and does not mark success early', async (t) => {
  let finish
  const result = new Promise((resolve) => { finish = resolve })
  const { page, state } = drive(t, { cook: () => result })
  await page.onLoad(OPTIONS)
  const pending = page.submit()
  assert.equal(page.data.submitting, true)
  assert.equal(page.data.submitted, false)
  await page.submit()
  page.selectBatch(checkbox('later', ['selected']))
  page.toggleUsedUp(checkbox('early', []))
  page.cancel()
  page.openFridge()
  await page.onShow()
  assert.equal(state.calls.length, 1)
  assert.equal(page.data.ingredients[0].batches[1].selected, false)
  assert.equal(page.data.ingredients[0].batches[0].usedUp, true)
  assert.deepEqual(state.navigations, [])
  finish([batch('early', { remaining: false, usable: false })])
  await pending
  assert.equal(page.data.submitted, true)
})

test('version conflict reloads current batches but requires a new explicit confirmation', async (t) => {
  const { page, state } = drive(t, { cook: async (input, requestId, count) => {
    if (count === 1) throw new AppError('VERSION_CONFLICT', '批次已变化')
    return [batch('early', { version: 3, remaining: false, usable: false })]
  } })
  await page.onLoad(OPTIONS)
  state.batches = [batch('early', { version: 2 }), batch('later', { expiresOn: '2026-10-20' })]
  await page.submit()
  assert.equal(page.data.submitted, false)
  assert.equal(page.data.reconfirmRequired, true)
  assert.equal(state.batchReads, 2)
  assert.equal(state.calls.length, 1, 'conflict does not automatically retry a write')
  assert.equal(page.data.ingredients[0].batches[0].version, 2)
  await page.submit()
  assert.notEqual(state.calls[1].requestId, state.calls[0].requestId)
  assert.equal(state.calls[1].input.batches[0].expectedVersion, 2)
  assert.equal(page.data.submitted, true)
})

test('conflict does not substitute an unchosen same-name batch when chosen batch is no longer usable', async (t) => {
  const { page, state } = drive(t, { cook: async () => { throw new AppError('VERSION_CONFLICT', '批次已变化') } })
  await page.onLoad(OPTIONS)
  state.batches = [batch('early', { usable: false }), batch('later', { expiresOn: '2026-10-20' })]
  await page.submit()
  assert.deepEqual(page.data.ingredients[0].batches.map((entry) => [entry.id, entry.selected]), [['later', false]])
  assert.equal(page.data.canSubmit, false)
  await page.submit()
  assert.equal(state.calls.length, 1)
})

test('uncertain transport outcome freezes original confirmation across inventory reload and retries its receipt', async (t) => {
  const { page, state } = drive(t, { cook: async (input, requestId, count) => {
    if (count === 1) throw new AppError('NETWORK_ERROR', '响应丢失')
    return [batch('early', { usable: false, remaining: false, version: 2 })]
  } })
  await page.onLoad(OPTIONS)
  await page.submit()
  const original = JSON.parse(JSON.stringify(page.data.ingredients))
  state.batches = [batch('early', { usable: false, remaining: false, version: 2 })]
  page.openFridge()
  await page.onShow()
  page.selectBatch(checkbox('early', []))
  page.toggleUsedUp(checkbox('early', []))
  assert.deepEqual(page.data.ingredients, original)
  assert.equal(state.batchReads, 2)
  await page.submit()
  assert.deepEqual(state.calls[1], state.calls[0])
  assert.equal(page.data.submitted, true)
})

test('changing confirmation after a definitive rejection creates a new request ID', async (t) => {
  const { page, state } = drive(t, { cook: async (input, requestId, count) => {
    if (count === 1) throw new AppError('VALIDATION_ERROR', '请重新核对')
    return [batch('early')]
  } })
  await page.onLoad(OPTIONS)
  await page.submit()
  assert.equal(page.data.outcomeUncertain, false)
  page.toggleUsedUp(checkbox('early', []))
  await page.submit()
  assert.notEqual(state.calls[1].requestId, state.calls[0].requestId)
  assert.equal(state.calls[1].input.batches[0].usedUp, false)
})

test('returning from inventory refreshes batches while preserving actual choices; WXML tap is not URL options', async (t) => {
  const { page, state } = drive(t)
  await page.onLoad(OPTIONS)
  page.selectBatch(checkbox('early', []))
  page.selectBatch(checkbox('later', ['selected']))
  page.toggleUsedUp(checkbox('later', []))
  state.batches = [batch('early'), batch('later', { version: 2, expiresOn: '2026-10-20' }), batch('new', { expiresOn: '2026-10-11' })]
  page.openFridge()
  await page.onShow()
  await page.loadData({ currentTarget: { dataset: {} }, detail: {} })
  assert.equal(page.data.loadError, '')
  assert.deepEqual(page.data.ingredients[0].batches.map((entry) => [entry.id, entry.selected, entry.usedUp]), [['new', false, true], ['early', false, true], ['later', true, false]])
  assert.equal(page.data.ingredients[0].batches[2].version, 2)
  assert.deepEqual(state.navigations, ['/pages/fridge/index'])
})

test('cancel leaves all stock untouched and never invokes cook', async (t) => {
  const { page, state } = drive(t)
  await page.onLoad(OPTIONS)
  page.cancel()
  assert.deepEqual(state.navigations, ['back'])
  assert.deepEqual(state.calls, [])
})

test('empty or invalid URLs are safe and do not load or write', async (t) => {
  const { page, state } = drive(t)
  for (const options of [undefined, {}, { ...OPTIONS, date: '2026-02-30' }, { ...OPTIONS, mealType: 'other' }, { ...OPTIONS, itemId: '' }]) {
    await page.onLoad(options)
    await page.submit()
    assert.equal(page.data.canSubmit, false)
    assert.match(page.data.loadError, /无效/)
  }
  assert.equal(state.menuReads, 0)
  assert.equal(state.batchReads, 0)
  assert.deepEqual(state.calls, [])
})

test('wrong menu ID and absent menu item cannot be consumed', async (t) => {
  const { page, state } = drive(t)
  await page.onLoad({ ...OPTIONS, menuId: 'different-menu' })
  await page.submit()
  assert.equal(page.data.canSubmit, false)
  assert.match(page.data.loadError, /找不到/)
  await page.onLoad({ ...OPTIONS, itemId: 'missing-item' })
  await page.submit()
  assert.equal(page.data.canSubmit, false)
  assert.deepEqual(state.calls, [])
})

test('failed conflict reload cannot be bypassed by changing a stale checkbox', async (t) => {
  const { page, state } = drive(t, { cook: async () => { throw new AppError('VERSION_CONFLICT', '批次已变化') } })
  await page.onLoad(OPTIONS)
  const fridge = require.cache[path.join(MINIPROGRAM, 'modules/fridge/index.js')].exports.fridgeModule
  fridge.listBatches = async () => { throw new AppError('NETWORK_ERROR', '重新核对失败') }
  await page.submit()
  assert.equal(page.data.reconfirmRequired, true)
  assert.equal(page.data.canSubmit, false)
  assert.match(page.data.loadError, /重新核对失败/)
  page.toggleUsedUp(checkbox('early', []))
  page.selectBatch(checkbox('later', ['selected']))
  await page.submit()
  assert.equal(page.data.ingredients[0].batches[0].usedUp, true)
  assert.equal(page.data.canSubmit, false)
  assert.equal(state.calls.length, 1)
})
