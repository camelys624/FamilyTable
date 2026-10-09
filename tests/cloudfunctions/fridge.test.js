'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createFridgeHandler } = require('../../cloudfunctions/fridge/handler')
const { CloudBaseFridgeRepository, familyToday } = require('../../cloudfunctions/fridge/repository')
const { createCloudBaseSuggester, parseModelText, reconcileSuggestions } = require('../../cloudfunctions/fridge/suggestion')

const silentLogger = { error() {} }

// In-memory stand-in for wx-server-sdk's database: where/orderBy/limit queries,
// a small command subset, and transactions that only allow doc() access and roll
// back every write when the callback throws — the guarantees fridge.cook relies on.
function createFakeCloud() {
  const collections = new Map()
  const store = (name) => {
    if (!collections.has(name)) collections.set(name, new Map())
    return collections.get(name)
  }
  const op = (kind, value) => ({ __op: kind, value })
  const command = {
    lt: (value) => op('lt', value),
    eq: (value) => op('eq', value),
    or: (branches) => ({ __or: branches }),
  }
  const comparable = (value) => (value instanceof Date ? value.getTime() : value)
  const matchField = (actual, expected) => {
    if (expected && expected.__op === 'lt') return comparable(actual) < comparable(expected.value)
    if (expected && expected.__op === 'eq') return comparable(actual) === comparable(expected.value)
    if (expected === null) return actual === null || actual === undefined
    return comparable(actual) === comparable(expected)
  }
  const matches = (doc, where) => {
    if (where.__or) return where.__or.some((branch) => matches(doc, branch))
    return Object.entries(where).every(([key, expected]) => matchField(doc[key], expected))
  }
  const clone = (value) => structuredClone(value)

  function query(name, where = {}, orders = [], limit = 100) {
    return {
      where: (next) => query(name, next, orders, limit),
      orderBy: (field, direction) => query(name, where, [...orders, { field, direction }], limit),
      limit: (next) => query(name, where, orders, next),
      async get() {
        const rows = [...store(name).entries()]
          .map(([_id, doc]) => ({ _id, ...clone(doc) }))
          .filter((doc) => matches(doc, where))
        rows.sort((left, right) => {
          for (const { field, direction } of orders) {
            const a = comparable(left[field])
            const b = comparable(right[field])
            if (a === b) continue
            return (a < b ? -1 : 1) * (direction === 'desc' ? -1 : 1)
          }
          return 0
        })
        return { data: rows.slice(0, limit) }
      },
    }
  }

  function docRef(name, id) {
    return {
      async get() {
        const doc = store(name).get(id)
        return { data: doc ? { _id: id, ...clone(doc) } : null }
      },
      async set({ data }) {
        store(name).set(id, clone(data))
      },
      async update({ data }) {
        const current = store(name).get(id)
        if (!current) throw new Error(`document with _id ${id} does not exist`)
        store(name).set(id, { ...current, ...clone(data) })
      },
    }
  }

  const db = {
    command,
    collection: (name) => ({ ...query(name), doc: (id) => docRef(name, id) }),
    async runTransaction(callback) {
      const snapshot = new Map([...collections].map(([name, docs]) => [name, clone(docs)]))
      const transaction = { collection: (name) => ({ doc: (id) => docRef(name, id) }) }
      try {
        return await callback(transaction)
      } catch (error) {
        collections.clear()
        snapshot.forEach((docs, name) => collections.set(name, docs))
        throw error
      }
    },
  }

  return {
    database: () => db,
    seed(name, id, doc) {
      store(name).set(id, clone(doc))
    },
    all(name) {
      return [...store(name).entries()].map(([_id, doc]) => ({ _id, ...doc }))
    },
  }
}

function addFamily(cloud, key) {
  cloud.seed('users', `user_${key}`, { openid: `openid_${key}`, status: 'active' })
  cloud.seed('family_members', `fm_${key}`, { userId: `user_${key}`, familyId: `fam_${key}`, status: 'active', role: 'owner' })
  cloud.seed('families', `fam_${key}`, { status: 'active' })
}

function seedMenu(cloud, familyKey, ingredients) {
  cloud.seed('menus', `menu_${familyKey}`, {
    familyId: `fam_${familyKey}`,
    weekStart: '2026-10-05',
    version: 1,
    days: [{
      date: '2026-10-09',
      breakfast: [],
      lunch: [],
      dinner: [{ id: 'item_1', recipeId: 'recipe_1', recipeSnapshot: { name: '番茄炒蛋', ingredients } }],
    }],
  })
}

function addDays(offset) {
  const date = new Date(`${familyToday(new Date())}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function setup({ suggester = async () => [] } = {}) {
  const cloud = createFakeCloud()
  addFamily(cloud, 'a')
  addFamily(cloud, 'b')
  const handler = createFridgeHandler(new CloudBaseFridgeRepository(cloud, suggester), silentLogger)
  let sequence = 0
  const call = (action, payload = {}, { openid = 'openid_a', requestId } = {}) => handler(
    { action, payload, requestId: requestId || `req_test_${++sequence}` },
    { openid },
  )
  const addBatch = async (name, expiresOn = '', options) => {
    const result = await call('fridge.createBatch', { name, expiresOn }, options)
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return result.data.batch
  }
  return { cloud, call, addBatch }
}

const cookPayload = (batches) => ({ menuId: 'menu_a', itemId: 'item_1', date: '2026-10-09', mealType: 'dinner', batches })

test('payloads cannot carry identity, family or quantity fields', async () => {
  const { call } = setup()
  const forged = await call('fridge.createBatch', { name: '番茄', expiresOn: '', familyId: 'fam_b' })
  assert.equal(forged.error.code, 'VALIDATION_ERROR')
  const quantity = await call('fridge.cook', cookPayload([{ batchId: 'x', expectedVersion: 1, usedUp: true, quantity: 2 }]))
  assert.equal(quantity.error.code, 'VALIDATION_ERROR')
  const notBoolean = await call('fridge.cook', cookPayload([{ batchId: 'x', expectedVersion: 1, usedUp: 'true' }]))
  assert.equal(notBoolean.error.code, 'VALIDATION_ERROR')
  const badDate = await call('fridge.createBatch', { name: '番茄', expiresOn: '2026-02-30' })
  assert.equal(badDate.error.code, 'VALIDATION_ERROR')
  const noRequestId = await createFridgeHandler({}, silentLogger)({ action: 'fridge.createBatch', payload: { name: '番茄', expiresOn: '' } }, { openid: 'openid_a' })
  assert.equal(noRequestId.error.code, 'VALIDATION_ERROR')
})

test('cook marks used-up batches gone, keeps leftovers, and records each batch once', async () => {
  const { cloud, call, addBatch } = setup()
  seedMenu(cloud, 'a', [{ name: '番茄', usedUp: true }, { name: '鸡蛋', usedUp: false }])
  const tomato = await addBatch('番茄')
  const egg = await addBatch(' 鸡蛋 ')

  const payload = cookPayload([
    { batchId: tomato.id, expectedVersion: 1, usedUp: true },
    { batchId: egg.id, expectedVersion: 1, usedUp: false },
  ])
  const cooked = await call('fridge.cook', payload, { requestId: 'req_cook_0001' })
  assert.equal(cooked.ok, true, JSON.stringify(cooked.error))

  const listed = await call('fridge.listBatches')
  assert.deepEqual(listed.data.batches.map((batch) => [batch.name, batch.version]), [['鸡蛋', 2]])
  const cookedRecords = cloud.all('fridge_records').filter((record) => record.type === 'cooked')
  assert.deepEqual(cookedRecords.map((record) => [record.name, record.usedUp]).sort(), [['番茄', true], ['鸡蛋', false]])

  // A network retry with the same requestId replays the receipt without consuming again.
  const replay = await call('fridge.cook', payload, { requestId: 'req_cook_0001' })
  assert.deepEqual(replay.data, cooked.data)
  assert.equal(cloud.all('fridge_records').filter((record) => record.type === 'cooked').length, 2)

  // A fresh submission for the same menu item is a second cook of one dish.
  const again = await call('fridge.cook', cookPayload([{ batchId: egg.id, expectedVersion: 2, usedUp: true }]))
  assert.equal(again.error.code, 'ALREADY_COOKED')
})

test('cook is all-or-nothing when any batch is stale', async () => {
  const { cloud, call, addBatch } = setup()
  seedMenu(cloud, 'a', [{ name: '番茄', usedUp: true }, { name: '鸡蛋', usedUp: true }])
  const tomato = await addBatch('番茄')
  const egg = await addBatch('鸡蛋')
  const renamed = await call('fridge.updateBatch', { batchId: egg.id, expectedVersion: 1, name: '鸡蛋', expiresOn: addDays(3) })
  assert.equal(renamed.data.batch.version, 2)

  const result = await call('fridge.cook', cookPayload([
    { batchId: tomato.id, expectedVersion: 1, usedUp: true },
    { batchId: egg.id, expectedVersion: 1, usedUp: true },
  ]))
  assert.equal(result.error.code, 'VERSION_CONFLICT')
  assert.equal(result.error.details.batchId, egg.id)
  const listed = await call('fridge.listBatches')
  assert.deepEqual(listed.data.batches.map((batch) => [batch.name, batch.remaining, batch.version]).sort(), [['番茄', true, 1], ['鸡蛋', true, 2]])
  assert.equal(cloud.all('fridge_records').filter((record) => record.type === 'cooked').length, 0)
  assert.equal(cloud.all('fridge_cooks').length, 0)
})

test('cook rejects expired batches and batches the dish does not use', async () => {
  const { cloud, call, addBatch } = setup()
  seedMenu(cloud, 'a', [{ name: '番茄', usedUp: true }])
  const expired = await addBatch('番茄', addDays(-1))
  const fish = await addBatch('鲈鱼')

  const expiredResult = await call('fridge.cook', cookPayload([{ batchId: expired.id, expectedVersion: 1, usedUp: true }]))
  assert.equal(expiredResult.error.code, 'VALIDATION_ERROR')
  const unrelated = await call('fridge.cook', cookPayload([{ batchId: fish.id, expectedVersion: 1, usedUp: true }]))
  assert.equal(unrelated.error.code, 'VALIDATION_ERROR')
  const missingItem = await call('fridge.cook', { ...cookPayload([{ batchId: fish.id, expectedVersion: 1, usedUp: true }]), itemId: 'item_gone' })
  assert.equal(missingItem.error.code, 'NOT_FOUND')
})

test('expiry is a status, not a discard; discard records the reason', async () => {
  const { cloud, call, addBatch } = setup()
  const today = await addBatch('牛奶', addDays(0))
  const expired = await addBatch('豆腐', addDays(-2))
  const greens = await addBatch('青菜', addDays(5))

  const listed = await call('fridge.listBatches')
  const byName = Object.fromEntries(listed.data.batches.map((batch) => [batch.name, batch]))
  assert.equal(byName['牛奶'].expired, false, 'the expiry date itself is still usable')
  assert.equal(byName['豆腐'].expired, true)
  assert.equal(byName['豆腐'].usable, false)
  assert.equal(byName['豆腐'].remaining, true)
  assert.equal(cloud.all('fridge_records').filter((record) => record.type === 'discarded').length, 0)

  const thrown = await call('fridge.discardBatch', { batchId: expired.id, expectedVersion: 1, reason: 'expired', usedUp: true })
  assert.equal(thrown.data.batch.status, 'discarded')
  const partial = await call('fridge.discardBatch', { batchId: greens.id, expectedVersion: 1, reason: 'spoiled', usedUp: false })
  assert.equal(partial.data.batch.remaining, true)
  assert.equal(partial.data.batch.usable, false)
  assert.equal(partial.data.batch.status, 'spoiled')

  const after = await call('fridge.listBatches')
  assert.deepEqual(after.data.batches.map((batch) => batch.name).sort(), ['牛奶', '青菜'])
  const discards = cloud.all('fridge_records').filter((record) => record.type === 'discarded')
  assert.deepEqual(discards.map((record) => [record.name, record.reason, record.usedUp]).sort(), [['豆腐', 'expired', true], ['青菜', 'spoiled', false]])
  assert.ok(today)
})

test('another family cannot see or touch a batch', async () => {
  const { cloud, call, addBatch } = setup()
  seedMenu(cloud, 'b', [{ name: '番茄', usedUp: true }])
  const tomato = await addBatch('番茄')
  const asB = { openid: 'openid_b' }

  assert.deepEqual((await call('fridge.listBatches', {}, asB)).data.batches, [])
  assert.deepEqual((await call('fridge.listRecords', {}, asB)).data.records, [])
  const update = await call('fridge.updateBatch', { batchId: tomato.id, expectedVersion: 1, name: '番茄', expiresOn: '' }, asB)
  assert.equal(update.error.code, 'NOT_FOUND')
  const discard = await call('fridge.discardBatch', { batchId: tomato.id, expectedVersion: 1, reason: 'other', usedUp: true }, asB)
  assert.equal(discard.error.code, 'NOT_FOUND')
  const cook = await call('fridge.cook', { ...cookPayload([{ batchId: tomato.id, expectedVersion: 1, usedUp: true }]), menuId: 'menu_b' }, asB)
  assert.equal(cook.error.code, 'NOT_FOUND')
  // Family A cannot cook against family B's menu either.
  const crossMenu = await call('fridge.cook', { ...cookPayload([{ batchId: tomato.id, expectedVersion: 1, usedUp: true }]), menuId: 'menu_b' })
  assert.equal(crossMenu.error.code, 'NOT_FOUND')

  const stranger = await call('fridge.listBatches', {}, { openid: 'openid_nobody' })
  assert.equal(stranger.error.code, 'UNAUTHENTICATED')
})

test('records page newest-first with an opaque cursor', async () => {
  const { call, addBatch } = setup()
  for (const name of ['一', '二', '三']) await addBatch(name)
  const first = await call('fridge.listRecords', { pageSize: 2 })
  assert.equal(first.data.records.length, 2)
  assert.ok(first.data.nextCursor)
  const second = await call('fridge.listRecords', { pageSize: 2, cursor: first.data.nextCursor })
  assert.equal(second.data.records.length, 1)
  assert.equal(second.data.nextCursor, '')
  const names = [...first.data.records, ...second.data.records].map((record) => record.name)
  assert.deepEqual([...names].sort(), ['一', '三', '二'])
  const bad = await call('fridge.listRecords', { cursor: 'not-a-cursor' })
  assert.equal(bad.error.code, 'VALIDATION_ERROR')
})

test('suggestions only see usable stock and stock writes survive AI failure', async () => {
  let prompt = null
  const failing = async (input) => {
    prompt = input
    throw Object.assign(new Error('AI 建议暂时不可用'), { code: 'FEATURE_UNAVAILABLE' })
  }
  const { cloud, call, addBatch } = setup({ suggester: failing })
  cloud.seed('recipes', 'recipe_1', { familyId: 'fam_a', name: '番茄炒蛋', deletedAt: null, updatedAt: new Date(), ingredients: [{ name: '番茄' }, { name: '鸡蛋' }] })
  cloud.seed('recipes', 'recipe_b', { familyId: 'fam_b', name: '别家的菜', deletedAt: null, updatedAt: new Date(), ingredients: [{ name: '番茄' }] })
  await addBatch('番茄')
  await addBatch('豆腐', addDays(-1))

  const failed = await call('fridge.suggest')
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'FEATURE_UNAVAILABLE')
  assert.deepEqual(prompt.stockNames, ['番茄'])
  assert.deepEqual(prompt.recipes.map((recipe) => recipe.name), ['番茄炒蛋'])
  assert.ok(!JSON.stringify(prompt).includes('fam_a') && !JSON.stringify(prompt).includes('openid'))

  const created = await call('fridge.createBatch', { name: '鸡蛋', expiresOn: '' })
  assert.equal(created.ok, true)
})

test('empty usable stock returns no suggestions without calling the model', async () => {
  let called = false
  const { call } = setup({ suggester: async () => { called = true; return [] } })
  const result = await call('fridge.suggest')
  assert.deepEqual(result.data.suggestions, [])
  assert.equal(called, false)
})

test('server decides canCook from stock, preferring the family recipe ingredient list', () => {
  const recipes = [{ id: 'recipe_1', name: '番茄炒蛋', ingredients: ['番茄', '鸡蛋'] }]
  const raw = parseModelText('好的：\n```json\n{"suggestions":[' +
    '{"name":"番茄炒蛋","reason":"家常","ingredients":["番茄"],"steps":["炒"]},' +
    '{"name":"番茄汤","reason":"快手","ingredients":["番茄","葱"]},' +
    '{"name":"牛排","reason":"没有相关食材","ingredients":["牛肉"]}' +
    ']}\n```')
  const result = reconcileSuggestions(raw, ['番茄', '葱'], recipes)
  assert.deepEqual(result.map((item) => [item.name, item.recipeId, item.canCook, item.missing]), [
    ['番茄炒蛋', 'recipe_1', false, ['鸡蛋']],
    ['番茄汤', null, true, []],
  ])
  assert.throws(() => parseModelText('抱歉，我无法回答'), { code: 'FEATURE_UNAVAILABLE' })
})

test('suggester reports unconfigured or failing models as unavailable', async () => {
  const unconfigured = createCloudBaseSuggester({ ai: () => { throw new Error('should not be called') } }, {}, silentLogger)
  await assert.rejects(unconfigured({ stockNames: ['番茄'], recipes: [] }), { code: 'FEATURE_UNAVAILABLE' })

  const broken = createCloudBaseSuggester({
    ai: () => ({ createModel: () => ({ generateText: async () => { throw new Error('quota exceeded') } }) }),
  }, { FRIDGE_AI_MODEL: 'hunyuan-lite' }, silentLogger)
  await assert.rejects(broken({ stockNames: ['番茄'], recipes: [] }), { code: 'FEATURE_UNAVAILABLE' })

  const slow = createCloudBaseSuggester({
    ai: () => ({ createModel: () => ({ generateText: () => new Promise(() => {}) }) }),
  }, { FRIDGE_AI_MODEL: 'hunyuan-lite', FRIDGE_AI_TIMEOUT_MS: '20' }, silentLogger)
  await assert.rejects(slow({ stockNames: ['番茄'], recipes: [] }), { code: 'FEATURE_UNAVAILABLE' })

  let request = null
  const working = createCloudBaseSuggester({
    ai: () => ({ createModel: (provider) => ({ generateText: async (input) => {
      request = { provider, ...input }
      return { text: '{"suggestions":[{"name":"番茄汤","ingredients":["番茄"]}]}' }
    } }) }),
  }, { FRIDGE_AI_MODEL: 'hunyuan-lite' }, silentLogger)
  const suggestions = await working({ stockNames: ['番茄'], recipes: [] })
  assert.equal(suggestions[0].name, '番茄汤')
  assert.equal(request.provider, 'cloudbase')
  assert.equal(request.model, 'hunyuan-lite')
})
