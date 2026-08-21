'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('path')

const MINIPROGRAM = path.resolve(__dirname, '../../miniprogram')

// Drives the compiled page modules under stubbed wx globals. The onboarding and
// home guards must agree on whether the user has a family; when they disagree the
// app ping-pongs between the two pages forever (闪屏).
function drive({ cloudHasFamily, localOnboarded = false, repositoryMode = 'cloud', maxSteps = 8 }) {
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
