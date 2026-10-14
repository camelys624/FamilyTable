'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { fakeCloud } = require('../helpers/fake-cloud')
const { CloudBaseVoteRepository } = require('../../cloudfunctions/vote/repository')
const { CloudBaseShoppingRepository, listIdFor } = require('../../cloudfunctions/shopping/repository')
const { CloudBasePreferenceRepository } = require('../../cloudfunctions/preference/repository')
const { CloudBaseMenuRepository, menuIdFor } = require('../../cloudfunctions/menu/repository')
const { CloudBaseRecipeRepository } = require('../../cloudfunctions/recipe/repository')
const { CloudBaseAuthRepository } = require('../../cloudfunctions/auth/repository')
const { createVoteHandler } = require('../../cloudfunctions/vote/handler')
const { createShoppingHandler } = require('../../cloudfunctions/shopping/handler')
const { createPreferenceHandler } = require('../../cloudfunctions/preference/handler')
const { today } = require('../../cloudfunctions/vote/common')

const weekStart = '2026-10-12'
function setup() {
  const cloud = fakeCloud()
  for (const [id, familyId, role] of [['owner', 'family-a', 'owner'], ['member', 'family-a', 'member'], ['outsider', 'family-b', 'owner']]) {
    cloud.seed('users', id, { openid: id, status: 'active', displayName: id })
    cloud.seed('family_members', `fm-${id}`, { userId: id, familyId, role, status: 'active', displayName: id })
    cloud.seed('families', familyId, { status: 'active' })
  }
  for (const [id, familyId] of [['recipe-a', 'family-a'], ['recipe-b', 'family-a'], ['recipe-x', 'family-b']]) cloud.seed('recipes', id, { familyId, name: id, category: '家常菜', durationMinutes: 20, difficulty: 'easy', note: '', ingredients: [{ name: ' 鸡蛋 ', usedUp: true }, { name: '盐', usedUp: false }], steps: ['炒熟'], deletedAt: null, createdBy: 'owner' })
  const pollInput = { title: '今天吃什么', targetDate: today(), mealType: 'dinner', candidateRecipeIds: ['recipe-a', 'recipe-b'], closesAt: new Date(Date.now() + 3600000).toISOString() }
  return { cloud, pollInput, vote: new CloudBaseVoteRepository(cloud), shopping: new CloudBaseShoppingRepository(cloud), preference: new CloudBasePreferenceRepository(cloud), menu: new CloudBaseMenuRepository(cloud), recipe: new CloudBaseRecipeRepository(cloud) }
}

test('cloud votes use actual records, one member has one vote, and another family cannot read results', async () => {
  const { cloud, vote, pollInput } = setup()
  const created = await vote.createPoll('owner', pollInput, 'req_create_poll')
  const before = await vote.result('member', { pollId: created.poll.id })
  assert.equal(before.summary.totalVotes, 0)
  assert.equal(before.canCreate, false)
  await vote.cast('member', { pollId: created.poll.id, candidateRecipeId: 'recipe-a' }, 'req_cast_member')
  const result = await vote.result('owner', { pollId: created.poll.id })
  assert.equal(result.summary.totalVotes, 1)
  assert.deepEqual(result.summary.candidates.map((entry) => entry.voteCount), [1, 0])
  assert.deepEqual(result.voters, [{ id: 'fm-member', displayName: 'member' }])
  assert.equal(result.currentVote, null)
  await assert.rejects(vote.result('outsider', { pollId: created.poll.id }), { code: 'NOT_FOUND' })
  await assert.rejects(vote.cast('member', { pollId: created.poll.id, candidateRecipeId: 'recipe-b' }, 'req_cast_twice'), { code: 'VOTE_ALREADY_CAST' })
  assert.equal(cloud.all('votes').length, 1)
})

test('poll creation and voting are idempotent under concurrent requests; duplicate open polls conflict', async () => {
  const { cloud, vote, pollInput } = setup()
  const created = await Promise.all(Array.from({ length: 3 }, () => vote.createPoll('owner', pollInput, 'req_create_same')))
  assert.equal(cloud.all('polls').length, 1)
  assert.deepEqual(created[0], created[1])
  const next = await Promise.allSettled([vote.createPoll('owner', pollInput, 'req_create_next'), vote.createPoll('member', pollInput, 'req_create_member')])
  assert.deepEqual(next.map((entry) => entry.reason.code), ['POLL_ALREADY_OPEN', 'FORBIDDEN'])
  const input = { pollId: created[0].poll.id, candidateRecipeId: 'recipe-a' }
  const votes = await Promise.all(Array.from({ length: 3 }, () => vote.cast('member', input, 'req_cast_same')))
  assert.equal(votes[0].vote.id, votes[1].vote.id)
  assert.equal(cloud.all('votes').length, 1)
  await assert.rejects(vote.cast('member', { ...input, candidateRecipeId: 'recipe-b' }, 'req_cast_same'), { code: 'IDEMPOTENCY_CONFLICT' })
  assert.equal(cloud.all('operation_logs').filter((entry) => entry.action === 'vote.cast').length, 1)
})

test('closed, expired, forged and deleted-candidate polls cannot receive votes', async () => {
  const { cloud, vote, pollInput } = setup()
  await assert.rejects(vote.createPoll('owner', { ...pollInput, candidateRecipeIds: ['recipe-a', 'recipe-x'] }, 'req_foreign_candidate'), { code: 'NOT_FOUND' })
  const created = await vote.createPoll('owner', pollInput, 'req_valid_poll')
  await assert.rejects(vote.cast('member', { pollId: created.poll.id, candidateRecipeId: 'recipe-x' }, 'req_invalid_choice'), { code: 'VALIDATION_ERROR' })
  await assert.rejects(vote.close('member', { pollId: created.poll.id }, 'req_forbidden_close'), { code: 'FORBIDDEN' })
  await vote.close('owner', { pollId: created.poll.id }, 'req_owner_close')
  await assert.rejects(vote.cast('member', { pollId: created.poll.id, candidateRecipeId: 'recipe-a' }, 'req_closed_vote'), { code: 'POLL_CLOSED' })
  const reopened = await vote.createPoll('owner', pollInput, 'req_new_poll')
  const stored = cloud.all('polls').find((poll) => poll._id === reopened.poll.id)
  cloud.seed('polls', stored._id, { ...stored, closesAt: new Date(0) })
  assert.equal((await vote.result('member', { pollId: stored._id })).poll.status, 'closed')
  await assert.rejects(vote.cast('member', { pollId: stored._id, candidateRecipeId: 'recipe-a' }, 'req_expired_vote'), { code: 'POLL_CLOSED' })
  assert.equal(cloud.all('votes').length, 0)
})

async function seedMenu(s) {
  const first = await s.menu.addRecipe('owner', { weekStart, date: weekStart, mealType: 'dinner', recipeId: 'recipe-a', expectedVersion: 0 }, 'req_menu_first')
  return s.menu.addRecipe('member', { weekStart, date: weekStart, mealType: 'lunch', recipeId: 'recipe-b', expectedVersion: first.version }, 'req_menu_second')
}

test('shopping generation merges used-up ingredients only, preserves manual items and detects stale menus', async () => {
  const s = setup()
  const menu = await seedMenu(s)
  let list = (await s.shopping.generate('owner', { weekStart, replaceExisting: false }, 'req_generate_first')).shoppingList
  assert.deepEqual(list.items.map((item) => item.name), ['鸡蛋'])
  assert.equal(list.sourceMenuVersion, menu.version)
  list = (await s.shopping.addItem('member', { listId: list.id, weekStart, expectedVersion: list.version, name: '面包', category: '手动添加' }, 'req_manual')).shoppingList
  list = (await s.shopping.checkItem('member', { listId: list.id, weekStart, expectedVersion: list.version, itemId: list.items[1].id, checked: true }, 'req_check_manual')).shoppingList
  const same = (await s.shopping.generate('owner', { weekStart, replaceExisting: false }, 'req_same_menu')).shoppingList
  assert.equal(same.version, list.version)
  assert.equal(same.items.find((item) => item.name === '面包').checked, true)
  await s.menu.removeRecipe('owner', { menuId: menu.id, itemId: menu.days[0].lunch[0].id, expectedVersion: menu.version }, 'req_menu_remove')
  assert.equal((await s.shopping.getList('owner', { weekStart })).shoppingList.stale, true)
  await assert.rejects(s.shopping.generate('owner', { weekStart, replaceExisting: false }, 'req_reconfirm_menu'), { code: 'VERSION_CONFLICT' })
  const refreshed = (await s.shopping.generate('owner', { weekStart, replaceExisting: true }, 'req_confirm_generate')).shoppingList
  assert.equal(refreshed.stale, false)
  assert.equal(refreshed.items.find((item) => item.name === '面包').checked, true)
  assert.equal(refreshed.items.find((item) => item.name === '鸡蛋').checked, false)
})

test('shopping concurrent edits cannot overwrite each other and request replay does not increment versions', async () => {
  const s = setup()
  await seedMenu(s)
  const list = (await s.shopping.generate('owner', { weekStart, replaceExisting: false }, 'req_initial')).shoppingList
  const input = { listId: list.id, weekStart, expectedVersion: list.version, itemId: list.items[0].id, checked: true }
  const racing = await Promise.allSettled([s.shopping.checkItem('owner', input, 'req_check_owner'), s.shopping.checkItem('member', input, 'req_check_member')])
  assert.equal(racing.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(racing.find((result) => result.status === 'rejected').reason.code, 'VERSION_CONFLICT')
  const winner = racing[0].status === 'fulfilled' ? 'owner' : 'member'
  const winningId = winner === 'owner' ? 'req_check_owner' : 'req_check_member'
  await s.shopping.checkItem(winner, input, winningId)
  assert.equal((await s.shopping.getList('owner', { weekStart })).shoppingList.version, list.version + 1)
  await assert.rejects(s.shopping.checkItem('outsider', input, 'req_outsider_check'), { code: 'NOT_FOUND' })
})

test('manual-only shopping lists can be created before a menu without duplicate normalized ingredients', async () => {
  const { shopping } = setup()
  const blank = (await shopping.getList('owner', { weekStart })).shoppingList
  assert.equal(blank.version, 0)
  assert.equal(blank.stale, false)
  let list = (await shopping.addItem('owner', { listId: blank.id, weekStart, expectedVersion: 0, name: ' 鸡蛋 ', category: '手动添加' }, 'req_add_manual_1')).shoppingList
  list = (await shopping.addItem('owner', { listId: list.id, weekStart, expectedVersion: list.version, name: '鸡 蛋', category: '手动添加' }, 'req_add_manual_2')).shoppingList
  assert.equal(list.items.length, 1)
  assert.equal(list.id, listIdFor('family-a', weekStart))
})

test('preferences belong only to the caller and repeat writes are idempotent', async () => {
  const { preference, cloud } = setup()
  assert.deepEqual((await preference.getMine('owner')).preference.avoidFoods, [])
  const input = { spicyLevel: 3, avoidFoods: ['花生'], notes: '' }
  const updates = await Promise.all(Array.from({ length: 3 }, () => preference.updateMine('owner', input, 'req_preference_same')))
  assert.deepEqual(updates[0], updates[1])
  assert.equal(cloud.all('preferences').length, 1)
  assert.equal((await preference.getMine('member')).preference.spicyLevel, 1)
  assert.equal((await preference.getMine('owner')).preference.spicyLevel, 3)
  await assert.rejects(preference.updateMine('owner', { ...input, spicyLevel: 2 }, 'req_preference_same'), { code: 'IDEMPOTENCY_CONFLICT' })
})

test('all domain handlers reject forged fields and invalid types before touching repositories', async () => {
  const cases = [
    [createVoteHandler, { action: 'vote.cast', payload: { pollId: 'poll', candidateRecipeId: 'recipe', voterMemberId: 'forged' } }],
    [createShoppingHandler, { action: 'shopping.checkItem', payload: { listId: 'list', weekStart, itemId: 'item', checked: 'true', expectedVersion: 1 } }],
    [createPreferenceHandler, { action: 'preference.updateMine', payload: { spicyLevel: 1, avoidFoods: [], userId: 'forged' } }],
    [createPreferenceHandler, { action: 'preference.updateMine', payload: { spicyLevel: '1', avoidFoods: [] } }],
  ]
  for (const [factory, event] of cases) {
    const result = await factory({}, { error() {} })({ ...event, requestId: 'req_validation' }, { openid: 'owner' })
    assert.equal(result.error.code, 'VALIDATION_ERROR')
  }
})

test('transaction failures roll back writes and revoked members cannot replay old receipts', async () => {
  const s = setup()
  const input = { spicyLevel: 2, avoidFoods: [], notes: '' }
  s.cloud.failWrite((name) => name === 'operation_logs')
  await assert.rejects(s.preference.updateMine('owner', input, 'req_fail_transaction'), /injected/)
  assert.equal(s.cloud.all('preferences').length, 0)
  assert.equal(s.cloud.all('idempotency_records').length, 0)
  s.cloud.failWrite(null)
  await s.preference.updateMine('owner', input, 'req_good_transaction')
  s.cloud.beforeTransaction(async () => {
    const member = s.cloud.all('family_members').find((entry) => entry._id === 'fm-owner')
    s.cloud.seed('family_members', member._id, { ...member, status: 'removed' })
  })
  await assert.rejects(s.preference.updateMine('owner', input, 'req_good_transaction'), { code: 'NOT_FAMILY_MEMBER' })
})

test('recipe CRUD and menu edits use doc-only transactions, maintain family isolation, and replay safely', async () => {
  const s = setup()
  const draft = { name: '测试菜', category: '家常菜', durationMinutes: 10, difficulty: 'easy', note: '', ingredients: [{ name: '鸡蛋', usedUp: true }], steps: ['煮熟'] }
  const recipe = await s.recipe.create('member', draft, 'req_recipe_create')
  assert.equal((await s.recipe.create('member', draft, 'req_recipe_create')).id, recipe.id)
  await s.recipe.update('member', recipe.id, { name: '新菜名' }, 'req_recipe_update')
  assert.equal((await s.recipe.detail('owner', recipe.id)).name, '新菜名')
  await assert.rejects(s.recipe.update('outsider', recipe.id, { name: '越权' }, 'req_foreign_update'), { code: 'NOT_FOUND' })
  const menu = await s.menu.addRecipe('member', { weekStart, date: weekStart, mealType: 'dinner', recipeId: recipe.id, expectedVersion: 0 }, 'req_added_menu')
  assert.equal(menu.days[0].dinner[0].recipeSnapshot.name, '新菜名')
  await assert.rejects(s.menu.addRecipe('owner', { weekStart, date: weekStart, mealType: 'dinner', recipeId: recipe.id, expectedVersion: 0 }, 'req_stale_menu'), { code: 'VERSION_CONFLICT' })
  await s.recipe.delete('member', recipe.id, 'req_deleted_recipe')
  assert.equal((await s.menu.week('owner', weekStart)).days[0].dinner[0].recipeSnapshot.name, '新菜名')
  await assert.rejects(s.recipe.detail('owner', recipe.id), { code: 'NOT_FOUND' })
  assert.equal(s.cloud.all('menus')[0]._id, menuIdFor('family-a', weekStart))
})

test('privacy consent records the actual user and preserves its original acceptance time on retry', async () => {
  const { cloud } = setup()
  const auth = new CloudBaseAuthRepository(cloud)
  const first = await auth.acceptTerms('owner', '2026-10-13')
  const second = await auth.acceptTerms('owner', '2026-10-13')
  assert.deepEqual(first, second)
  assert.equal(cloud.all('users').find((user) => user._id === 'member').privacyConsent, undefined)
})

test('simultaneous first logins create one user and return the same identity', async () => {
  const { cloud } = setup()
  const auth = new CloudBaseAuthRepository(cloud)
  const results = await Promise.all([auth.login('new-person'), auth.login('new-person')])
  assert.equal(results[0].user.id, results[1].user.id)
  assert.equal(cloud.all('users').filter((user) => user.openid === 'new-person').length, 1)
  assert.equal(results[0].onboardingRequired, true)
})
