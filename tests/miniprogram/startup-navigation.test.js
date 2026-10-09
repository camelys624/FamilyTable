'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../../miniprogram')

// Drives the compiled page modules under stubbed wx globals. The onboarding and
// home guards must agree on whether the user has a family; when they disagree the
// app ping-pongs between the two pages forever (闪屏).
let driveQueue = Promise.resolve()

function runSerialized(task) {
  const previous = driveQueue
  let release
  driveQueue = new Promise((resolve) => { release = resolve })
  return previous.then(async () => {
    try {
      return await task()
    } finally {
      release()
    }
  })
}

function drive(options) {
  return runSerialized(() => driveUnsafe(options))
}

function driveUnsafe({ cloudHasFamily, localOnboarded = false, repositoryMode = 'cloud', maxSteps = 8 }) {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(MINIPROGRAM)) delete require.cache[key]
  }

  const storage = new Map()
  const nav = []

  global.wx = {
    getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    getAccountInfoSync: () => ({ miniProgram: { appId: 'wx859aee6af4c1f636' } }),
    showToast() {},
    stopPullDownRefresh() {},
    switchTab: ({ url }) => nav.push(url),
    reLaunch: ({ url }) => nav.push(url),
    navigateTo: ({ url }) => nav.push(url),
    cloud: {
      init() {},
      callFunction: async ({ name, data }) => {
        if (name === 'auth' && data.action === 'auth.login') {
          return {
            result: {
              ok: true,
              requestId: data.requestId,
              data: {
                user: { displayName: '小满' },
                family: cloudHasFamily ? { name: '林家饭桌' } : null,
                member: cloudHasFamily ? { displayName: '小满' } : null,
                onboardingRequired: !cloudHasFamily,
              },
            },
          }
        }
        if (name === 'family' && data.action === 'family.current') {
          return {
            result: {
              ok: true,
              requestId: data.requestId,
              data: { family: { name: '林家饭桌' }, members: [{ displayName: '小满' }] },
            },
          }
        }
        if (name === 'menu' && data.action === 'menu.week') {
          const days = Array.from({ length: 7 }, (_, index) => ({
            date: `2026-08-${String(index + 1).padStart(2, '0')}`,
            breakfast: [],
            lunch: [],
            dinner: [],
          }))
          return { result: { ok: true, requestId: data.requestId, data: { menu: { id: 'menu-1', weekStart: '2026-08-17', timezone: 'Asia/Shanghai', version: 0, days } } } }
        }
        if (name === 'recipe' && data.action === 'recipe.list') {
          return { result: { ok: true, requestId: data.requestId, data: { items: [], nextCursor: '' } } }
        }
        throw new Error(`unexpected call ${name}.${data.action}`)
      },
    },
  }

  const registered = []
  global.Page = (options) => registered.push(options)
  const load = (rel) => {
    registered.length = 0
    require(path.join(MINIPROGRAM, rel))
    return registered[0]
  }

  // The session adapter is picked at import time from the active profile.
  require(path.join(MINIPROGRAM, 'config/runtime.js')).runtimeConfig.repositoryMode = repositoryMode

  const routes = {
    '/pages/onboarding/index': load('pages/onboarding/index.js'),
    '/pages/home/index': load('pages/home/index.js'),
  }

  const { ensureState, saveState } = require(path.join(MINIPROGRAM, 'services/store.js'))
  const seeded = ensureState()
  seeded.onboarded = localOnboarded
  saveState(seeded)

  return (async () => {
    const visits = []
    let current = '/pages/onboarding/index'
    for (let step = 0; step < maxSteps; step++) {
      visits.push(current)
      const page = Object.create(routes[current])
      page.data = JSON.parse(JSON.stringify(routes[current].data))
      page.setData = (patch) => Object.assign(page.data, patch)

      nav.length = 0
      if (page.onLoad) await page.onLoad()
      if (page.onShow) await page.onShow()

      const jump = nav.find((url) => routes[url])
      if (!jump) return { visits, data: page.data, settled: true }
      current = jump
    }
    return { visits, settled: false }
  })()
}

test('startup settles on home when the family exists only in the cloud', async () => {
  const { visits, settled } = await drive({ cloudHasFamily: true, localOnboarded: false })
  assert.equal(settled, true, `navigation never settled: ${visits.join(' -> ')}`)
  assert.deepEqual(visits, ['/pages/onboarding/index', '/pages/home/index'])
})

test('startup stays on onboarding when the account has no family', async () => {
  const { visits, settled } = await drive({ cloudHasFamily: false })
  assert.equal(settled, true, `navigation never settled: ${visits.join(' -> ')}`)
  assert.deepEqual(visits, ['/pages/onboarding/index'])
})

test('home renders the cloud family name, not the local seed name', async () => {
  const { data } = await drive({ cloudHasFamily: true, localOnboarded: false })
  assert.equal(data.familyName, '林家饭桌')
  assert.equal(data.userName, '小满')
})

test('local demo profile still settles on home once onboarded', async () => {
  const { visits, settled } = await drive({ repositoryMode: 'local', localOnboarded: true })
  assert.equal(settled, true, `navigation never settled: ${visits.join(' -> ')}`)
  assert.deepEqual(visits, ['/pages/onboarding/index', '/pages/home/index'])
})

test('local demo profile stays on onboarding before onboarding completes', async () => {
  const { visits, settled } = await drive({ repositoryMode: 'local', localOnboarded: false })
  assert.equal(settled, true, `navigation never settled: ${visits.join(' -> ')}`)
  assert.deepEqual(visits, ['/pages/onboarding/index'])
})

function createRecipeEditPage() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(MINIPROGRAM)) delete require.cache[key]
  }
  global.wx = { showToast() {} }
  const registered = []
  global.Page = (options) => registered.push(options)
  const { recipeModule } = require(path.join(MINIPROGRAM, 'modules/recipe/index.js'))
  require(path.join(MINIPROGRAM, 'pages/recipes/edit.js'))
  const options = registered[0]
  const page = Object.assign({}, options, {
    data: JSON.parse(JSON.stringify(options.data)),
    setData(patch) {
      Object.assign(this.data, patch)
    },
  })
  return { page, recipeModule }
}

function ingredientSuggestion(name, overrides = {}) {
  return {
    name,
    amount: null,
    unit: '',
    amountText: '适量',
    evidenceStepIndexes: [0],
    evidenceQuotes: ['加入食材'],
    confidence: 'high',
    ...overrides,
  }
}

test('AI review applies selected additions without changing steps', async () => {
  await runSerialized(async () => {
    const { page, recipeModule } = createRecipeEditPage()
  const steps = ['锅中倒油，加入冰糖炒化']
  page.data.steps = [{ id: 'step-0', text: steps[0] }]
  page.data.ingredients = [{ id: 'ingredient-0', name: '盐', usedUp: false }]
  recipeModule.extractIngredients = async (input) => {
    assert.deepEqual(input.steps, steps)
    assert.deepEqual(input.existingIngredients, [{ name: '盐', amount: null, unit: '' }])
    return {
      detected: [ingredientSuggestion('冰糖')],
      diff: {
        add: [ingredientSuggestion('冰糖', { amount: 20, unit: '克', amountText: '20克' })],
        update: [],
        removeCandidates: [ingredientSuggestion('盐', { amount: 2, unit: '克', amountText: '2克', confidence: 'low' })],
        needsQuantity: [],
      },
      warnings: [],
    }
  }

  await page.extractIngredients()
  assert.equal(page.data.aiReviewVisible, true)
  assert.equal(page.data.aiReviewAdd[0].selected, true)
  assert.equal(page.data.aiReviewRemove[0].selected, false)

  page.toggleAiSuggestion({ currentTarget: { dataset: { group: 'remove', index: 0 } } })
  page.applyAiReview()

  assert.deepEqual(page.data.steps.map((step) => step.text), steps)
  assert.deepEqual(page.data.ingredients.map((ingredient) => ingredient.name), ['冰糖'])
  assert.equal(page.data.ingredients[0].usedUp, true)
  assert.equal(Object.hasOwn(page.data.ingredients[0], 'amount'), false)
  assert.equal(page.data.usedUpCount, 1)
  assert.equal(page.data.ingredientOptions.includes('冰糖'), true)
  assert.equal(page.data.ingredientSuggestions.includes('冰糖'), false)
  })
})

test('AI result is discarded when the draft changes while waiting', async () => {
  await runSerialized(async () => {
    const { page, recipeModule } = createRecipeEditPage()
  page.data.steps = [{ id: 'step-0', text: '加入鸡蛋' }]
  page.data.ingredients = []
  let resolveResult
  recipeModule.extractIngredients = () => new Promise((resolve) => { resolveResult = resolve })

  const pending = page.extractIngredients()
  page.data.steps[0].text = '加入鸡蛋和葱花'
  resolveResult({
    detected: [ingredientSuggestion('鸡蛋')],
    diff: { add: [ingredientSuggestion('鸡蛋')], update: [], removeCandidates: [], needsQuantity: [ingredientSuggestion('鸡蛋')] },
    warnings: [],
  })
  await pending

  assert.equal(page.data.aiReviewVisible, false)
  assert.equal(page.data.aiReviewMessage, '内容已经变过了，请重新整理')
  assert.deepEqual(page.data.ingredients, [])
  })
})

test('AI additions keep existing used-up flags and ignore quantity updates', async () => {
  await runSerialized(async () => {
    const { page, recipeModule } = createRecipeEditPage()
    page.data.steps = [{ id: 'step-0', text: '加入盐和鸡蛋' }]
    const salt = { id: 'ingredient-0', name: '盐', usedUp: false }
    page.data.ingredients = [salt]
    recipeModule.extractIngredients = async () => ({
      detected: [ingredientSuggestion('盐'), ingredientSuggestion('鸡蛋')],
      diff: {
        add: [ingredientSuggestion('鸡蛋')],
        update: [{
          existing: ingredientSuggestion('盐'),
          suggested: ingredientSuggestion('盐', { amount: 2, unit: '克' }),
          reason: '步骤中的用量与当前食材不同',
        }],
        removeCandidates: [],
        needsQuantity: [ingredientSuggestion('鸡蛋')],
      },
      warnings: [],
    })
    await page.extractIngredients()
    page.applyAiReview()
    assert.deepEqual(page.data.ingredients[0], salt)
    assert.deepEqual(page.data.ingredients.map(({ name, usedUp }) => ({ name, usedUp })), [
      { name: '盐', usedUp: false },
      { name: '鸡蛋', usedUp: true },
    ])
    assert.equal(page.data.usedUpCount, 1)
    page.toggleIngredientUsedUp({ currentTarget: { dataset: { index: 1 } } })
    assert.equal(page.data.usedUpCount, 0)
  })
})

test('changing a used-up flag invalidates pending AI suggestions', async () => {
  await runSerialized(async () => {
    const { page, recipeModule } = createRecipeEditPage()
    page.data.steps = [{ id: 'step-0', text: '加入盐和鸡蛋' }]
    page.data.ingredients = [{ id: 'ingredient-0', name: '盐', usedUp: true }]
    let resolveResult
    recipeModule.extractIngredients = () => new Promise((resolve) => { resolveResult = resolve })
    const pending = page.extractIngredients()
    page.toggleIngredientUsedUp({ currentTarget: { dataset: { index: 0 } } })
    resolveResult({
      detected: [ingredientSuggestion('鸡蛋')],
      diff: { add: [ingredientSuggestion('鸡蛋')], update: [], removeCandidates: [], needsQuantity: [] },
      warnings: [],
    })
    await pending
    assert.equal(page.data.aiReviewVisible, false)
    assert.equal(page.data.aiReviewMessage, '内容已经变过了，请重新整理')
    assert.deepEqual(page.data.ingredients, [{ id: 'ingredient-0', name: '盐', usedUp: false }])
  })
})

test('AI ingredients without quantities can be created and updated through the cloud adapter', async () => {
  await runSerialized(async () => {
    const { page, recipeModule } = createRecipeEditPage()
    const { CloudRecipeAdapter } = require(path.join(MINIPROGRAM, 'modules/recipe/cloud-adapter.js'))
    const { createRecipeHandler } = require('../../cloudfunctions/recipe/handler')
    let stored
    const writes = []
    const handler = createRecipeHandler({
      async create(openid, draft) {
        writes.push('create')
        stored = { id: 'recipe-merged', ...draft }
        return stored
      },
      async update(openid, recipeId, patch) {
        writes.push('update')
        stored = { ...stored, ...patch }
        return stored
      },
    }, { error() {} })
    const adapter = new CloudRecipeAdapter({
      async call(domain, action, payload) {
        const result = await handler({ action, payload, requestId: `req_merged_${writes.length}` }, { openid: 'merge-test-user' })
        assert.equal(result.ok, true, JSON.stringify(result.error))
        return result.data
      },
    })
    recipeModule.extractIngredients = async () => ({
      detected: [ingredientSuggestion('鸡蛋')],
      diff: { add: [ingredientSuggestion('鸡蛋')], update: [], removeCandidates: [], needsQuantity: [ingredientSuggestion('鸡蛋')] },
      warnings: [],
    })
    recipeModule.createRecipe = adapter.createRecipe.bind(adapter)
    recipeModule.updateRecipe = adapter.updateRecipe.bind(adapter)
    recipeModule.getRecipe = async () => ({ id: stored.id, tone: 'green' })
    page.data.name = '炒鸡蛋'
    page.data.steps = [{ id: 'step-0', text: '加入鸡蛋翻炒' }]
    global.wx.navigateBack = () => {}
    await page.extractIngredients()
    page.applyAiReview()
    await page.saveRecipe()
    assert.deepEqual(writes, ['create'])
    assert.deepEqual(stored.ingredients, [{ name: '鸡蛋', usedUp: true }])
    page.data.recipeId = stored.id
    page.toggleIngredientUsedUp({ currentTarget: { dataset: { index: 0 } } })
    await page.saveRecipe()
    assert.deepEqual(writes, ['create', 'update'])
    assert.deepEqual(stored.ingredients, [{ name: '鸡蛋', usedUp: false }])
  })
})
