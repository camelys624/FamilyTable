'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const MINIPROGRAM = path.resolve(__dirname, '../../miniprogram')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function batch(id, extra = {}) {
  return {
    id, name: '番茄', version: 1, expiresOn: '', remaining: true,
    usable: true, expired: false, statusLabel: '有剩', expiryLabel: '未填写', ...extra,
  }
}

function drive(overrides = {}, session = { onboarded: true }) {
  let options
  let requestSequence = 0
  const redirects = []
  const writes = []
  const fridgeModule = {
    listBatches: async () => [],
    listRecords: async () => ({ records: [], nextCursor: '' }),
    createBatch: async (input, requestId) => writes.push({ action: 'create', input, requestId }),
    updateBatch: async (input, requestId) => writes.push({ action: 'update', input, requestId }),
    discardBatch: async (input, requestId) => writes.push({ action: 'discard', input, requestId }),
    suggest: async () => [],
    ...overrides,
  }
  const dependencies = {
    '../../modules/fridge/index': { fridgeModule },
    '../../modules/session/index': { ensureSession: async () => session },
    '../../utils/app-error': { toAppError: (error) => ({ message: error.message }) },
    '../../utils/request-id': { createRequestId: () => `request-${++requestSequence}` },
  }
  vm.runInNewContext(fs.readFileSync(path.join(MINIPROGRAM, 'pages/fridge/index.js'), 'utf8'), {
    exports: {},
    require: (name) => {
      if (!dependencies[name]) throw new Error(`Unexpected page dependency: ${name}`)
      return dependencies[name]
    },
    Page: (page) => { options = page },
    wx: { reLaunch: ({ url }) => redirects.push(url), stopPullDownRefresh() {} },
  })
  const page = Object.create(options)
  page.data = JSON.parse(JSON.stringify(options.data))
  page.setData = (patch) => Object.assign(page.data, patch)
  return { page, writes, redirects }
}

const value = (text) => ({ detail: { value: text } })
const target = (id) => ({ currentTarget: { dataset: { id } } })
const plain = (object) => JSON.parse(JSON.stringify(object))

test('AI failure is separate from inventory writes and stock errors', async () => {
  const { page, writes } = drive({
    listBatches: async () => [batch('fresh')],
    suggest: async () => { throw new Error('AI unavailable') },
  })
  await page.onShow()
  await page.suggest()
  assert.equal(page.data.aiError, 'AI unavailable')
  assert.equal(page.data.loadError, '')
  assert.equal(page.data.aiLoading, false)
  assert.equal(page.data.batches[0].id, 'fresh')
  page.openAdd()
  page.inputName(value('鸡蛋'))
  await page.saveBatch()
  assert.equal(writes.length, 1)
  assert.equal(page.data.editorVisible, false)
  assert.equal(page.data.saveError, '')
})

test('failed create keeps input, no success or stock mutation, and retries the same request', async () => {
  const attempts = []
  const { page } = drive({ createBatch: async (input, requestId) => {
    attempts.push({ input, requestId })
    throw new Error('save failed')
  } })
  page.data.batches = [batch('existing')]
  page.openAdd()
  page.inputName(value('  鸡蛋  '))
  page.changeExpiry(value('2026-10-20'))
  await page.saveBatch()
  assert.equal(page.data.editorVisible, true)
  assert.equal(page.data.formName, '  鸡蛋  ')
  assert.equal(page.data.formExpiry, '2026-10-20')
  assert.equal(page.data.saveError, 'save failed')
  assert.equal(page.data.saving, false)
  assert.equal(page.data.batches[0].id, 'existing')
  await page.saveBatch()
  assert.equal(attempts[0].requestId, attempts[1].requestId)
  page.inputName(value('牛奶'))
  page.inputName(value('  鸡蛋  '))
  await page.saveBatch()
  assert.notEqual(attempts[1].requestId, attempts[2].requestId)
})

test('old AI completion cannot restore suggestions after a successful stock write', async () => {
  const pending = deferred()
  const started = deferred()
  const { page } = drive({ suggest: () => { started.resolve(); return pending.promise } })
  const suggestionRequest = page.suggest()
  await started.promise
  page.openAdd()
  page.inputName(value('鸡蛋'))
  await page.saveBatch()
  pending.resolve([{ name: '旧库存菜', canCook: true }])
  await suggestionRequest
  assert.equal(page.data.suggestions.length, 0)
  assert.equal(page.data.aiLoaded, false)
  assert.equal(page.data.aiLoading, false)
})

test('remaining list includes expired batches but available count excludes expired and spoiled', async () => {
  const { page } = drive({ listBatches: async () => [
    batch('fresh'), batch('expired', { expired: true, usable: false }),
    batch('spoiled', { usable: false }), batch('closed', { remaining: false, usable: false }),
  ] })
  await page.onShow()
  assert.deepEqual(plain(page.data.batches.map((item) => item.id)), ['fresh', 'expired', 'spoiled'])
  assert.equal(page.data.availableCount, 1)
})

test('overlapping stock loads ignore older completion and failure', async () => {
  const old = deferred()
  const started = deferred()
  let calls = 0
  const { page } = drive({ listBatches: () => {
    if (++calls === 1) { started.resolve(); return old.promise }
    return Promise.resolve([batch('new')])
  } })
  const first = page.loadBatches()
  await started.promise
  await page.loadBatches()
  old.reject(new Error('obsolete error'))
  await first
  assert.equal(page.data.batches[0].id, 'new')
  assert.equal(page.data.loadError, '')
  assert.equal(page.data.loading, false)
})

test('records paginate, deduplicate, and ignore an obsolete page when refreshed', async () => {
  const next = deferred()
  const started = deferred()
  const cursors = []
  let rootCalls = 0
  const record = (id) => ({ id, name: '番茄', typeLabel: '购入', detail: '', timeLabel: '' })
  const { page } = drive({ listRecords: async (cursor) => {
    cursors.push(cursor)
    if (cursor === 'first') return { records: [record('one'), record('two')], nextCursor: 'second' }
    if (cursor === 'second') { started.resolve(); return next.promise }
    return ++rootCalls === 1
      ? { records: [record('one')], nextCursor: 'first' }
      : { records: [record('new')], nextCursor: '' }
  } })
  await page.loadRecords()
  await page.moreRecords()
  assert.deepEqual(plain(page.data.records.map((item) => item.id)), ['one', 'two'])
  const olderPage = page.moreRecords()
  await started.promise
  await page.loadRecords()
  next.resolve({ records: [record('stale')], nextCursor: 'stale-cursor' })
  await olderPage
  assert.deepEqual(plain(page.data.records.map((item) => item.id)), ['new'])
  assert.equal(page.data.recordsHasMore, false)
  assert.equal(page.data.recordsLoading, false)
  assert.deepEqual(cursors, [undefined, 'first', 'second', undefined])
})

test('failed partial discard retains selection and the idempotent retry intent', async () => {
  const attempts = []
  const { page } = drive({ discardBatch: async (input, requestId) => {
    attempts.push({ input, requestId })
    throw new Error('discard failed')
  } })
  page.data.batches = [batch('first'), batch('second', { version: 8 })]
  page.openAdd()
  page.discardBatch(target('second'))
  assert.equal(page.data.editorVisible, false)
  page.changeDiscardReason(value('1'))
  page.changeDiscardUsedUp({ detail: { value: [] } })
  await page.confirmDiscard()
  assert.equal(page.data.discardId, 'second')
  assert.equal(page.data.discardUsedUp, false)
  assert.equal(page.data.saveError, 'discard failed')
  await page.confirmDiscard()
  assert.equal(attempts[0].requestId, attempts[1].requestId)
  assert.deepEqual(plain(page.data.batches.map(({ id, remaining }) => ({ id, remaining }))), [
    { id: 'first', remaining: true }, { id: 'second', remaining: true },
  ])
  page.openAdd()
  assert.equal(page.data.discardId, '')
})

test('saving guard rejects duplicate submission and preserves in-flight input', async () => {
  const pending = deferred()
  const started = deferred()
  let calls = 0
  const { page } = drive({ createBatch: () => {
    ++calls
    started.resolve()
    return pending.promise
  } })
  page.openAdd()
  page.inputName(value('鸡蛋'))
  const first = page.saveBatch()
  await started.promise
  await page.saveBatch()
  page.inputName(value('牛奶'))
  page.closeEditor()
  assert.equal(calls, 1)
  assert.equal(page.data.formName, '鸡蛋')
  assert.equal(page.data.editorVisible, true)
  pending.resolve()
  await first
  assert.equal(page.data.editorVisible, false)
  assert.equal(page.data.saving, false)
})

test('stock and records fail independently and unonboarded sessions never write', async () => {
  const { page } = drive({ listRecords: async () => { throw new Error('records unavailable') } })
  await page.onShow()
  assert.equal(page.data.loadError, '')
  assert.equal(page.data.recordsError, 'records unavailable')
  const { page: guarded, writes, redirects } = drive({}, { onboarded: false })
  guarded.openAdd()
  guarded.inputName(value('鸡蛋'))
  await guarded.saveBatch()
  assert.equal(writes.length, 0)
  assert.equal(guarded.data.formName, '鸡蛋')
  assert.equal(guarded.data.editorVisible, true)
  assert.deepEqual(redirects, ['/pages/onboarding/index'])
})
