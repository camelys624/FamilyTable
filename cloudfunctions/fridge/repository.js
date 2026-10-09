'use strict'

const {
  codedError,
  documentData,
  hash,
  idempotencyId,
  now,
  operationLogId,
  requestHash,
  resourceId,
} = require('./repository-utils')
const { normalizeName, reconcileSuggestions } = require('./suggestion')

const FAMILY_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000
const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_LISTED_BATCHES = 500
const MAX_PROMPT_RECIPES = 50

// 家庭时区固定为 Asia/Shanghai（与 menus.timezone 一致）；保质期当天仍算未过期。
function familyToday(timestamp) {
  return new Date(timestamp.getTime() + FAMILY_TIMEZONE_OFFSET_MS).toISOString().slice(0, 10)
}

function isExpired(batch, today) {
  return Boolean(batch.expiresOn) && batch.expiresOn < today
}

function batchStatus(batch, today) {
  if (!batch.remaining) return batch.endedReason === 'discarded' ? 'discarded' : 'usedUp'
  if (batch.spoiled) return 'spoiled'
  if (isExpired(batch, today)) return 'expired'
  return 'available'
}

function batchView(batch, today) {
  const expired = batch.remaining && isExpired(batch, today)
  return {
    id: batch._id,
    name: batch.name,
    version: batch.version,
    expiresOn: batch.expiresOn || '',
    remaining: batch.remaining,
    spoiled: Boolean(batch.spoiled),
    expired,
    usable: batch.remaining && !batch.spoiled && !expired,
    status: batchStatus(batch, today),
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  }
}

function recordView(record) {
  return {
    id: record._id,
    batchId: record.batchId,
    name: record.name,
    type: record.type,
    usedUp: record.usedUp ?? null,
    reason: record.reason ?? null,
    recipeName: record.recipeName ?? null,
    date: record.date ?? null,
    mealType: record.mealType ?? null,
    changes: record.changes ?? null,
    createdAt: record.createdAt,
  }
}

function encodeCursor(record) {
  const time = record.createdAt instanceof Date ? record.createdAt.getTime() : new Date(record.createdAt).getTime()
  return Buffer.from(JSON.stringify({ t: time, id: record._id })).toString('base64url')
}

function decodeCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (Number.isFinite(parsed?.t) && typeof parsed?.id === 'string' && parsed.id) return parsed
  } catch (error) {
    // 落到下方统一的校验错误
  }
  throw codedError('VALIDATION_ERROR', '记录分页参数无效，请刷新后重试', { field: 'cursor' })
}

function cookIdFor(familyId, menuId, itemId) {
  return `cook_${hash(`${familyId}:${menuId}:${itemId}`).slice(0, 40)}`
}

function findMenuItem(menu, date, mealType, itemId) {
  const day = (menu.days || []).find((entry) => entry.date === date)
  return (day?.[mealType] || []).find((entry) => entry.id === itemId) || null
}

class CloudBaseFridgeRepository {
  // suggester: async ({ stockNames, recipes, requestId }) => [{ name, reason, ingredients, steps }]
  constructor(cloud, suggester) {
    // 事务内只能用 doc() 单记录读写；找不到记录时返回 null 而不是抛错。
    this.db = cloud.database({ throwOnNotFound: false })
    this.suggester = suggester
  }

  async getContext(openid) {
    const userResult = await this.db.collection('users').where({ openid }).limit(1).get()
    const user = userResult?.data?.[0] || null
    if (!user || user.status !== 'active') throw codedError('UNAUTHENTICATED', '微信身份已失效，请重新进入小程序')

    const memberResult = await this.db
      .collection('family_members')
      .where({ userId: user._id, status: 'active' })
      .limit(1)
      .get()
    const member = memberResult?.data?.[0] || null
    if (!member) throw codedError('FAMILY_REQUIRED', '你还没有创建或加入家庭')

    const familyResult = await this.db.collection('families').where({ _id: member.familyId, status: 'active' }).limit(1).get()
    if (!familyResult?.data?.[0]) throw codedError('NOT_FAMILY_MEMBER', '当前家庭已不可访问')
    return { user, member, familyId: member.familyId }
  }

  async getFamilyDoc(transaction, collection, id, familyId) {
    const result = await transaction.collection(collection).doc(id).get()
    const document = result?.data || null
    if (!document || document.familyId !== familyId) return null
    return document
  }

  // 幂等模板：同 requestId 同参数重放成功结果，不同参数报冲突。
  async runIdempotent(context, action, input, requestId, label, work) {
    const requestHashValue = requestHash(input)
    const recordId = idempotencyId(context.user._id, action, requestId)
    const timestamp = now()
    return this.db.runTransaction(async (transaction) => {
      const existing = (await transaction.collection('idempotency_records').doc(recordId).get())?.data || null
      if (existing) {
        if (existing.requestHash !== requestHashValue) {
          throw codedError('IDEMPOTENCY_CONFLICT', `同一个 requestId 不能用于不同的${label}请求`)
        }
        if (existing.status === 'succeeded') return existing.responseSnapshot
        throw codedError('REQUEST_IN_PROGRESS', `${label}的请求正在处理中，请稍后重试`)
      }
      const { responseSnapshot, log } = await work(transaction, timestamp)
      await transaction.collection('idempotency_records').doc(recordId).set({
        data: documentData({
          _id: recordId,
          userId: context.user._id,
          familyId: context.familyId,
          action,
          requestId,
          requestHash: requestHashValue,
          status: 'succeeded',
          responseSnapshot,
          errorCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt: new Date(timestamp.getTime() + IDEMPOTENCY_TTL_MS),
          schemaVersion: 1,
        }),
      })
      const logId = operationLogId()
      await transaction.collection('operation_logs').doc(logId).set({
        data: documentData({
          _id: logId,
          familyId: context.familyId,
          actorUserId: context.user._id,
          actorMemberId: context.member._id,
          action,
          resourceType: log.resourceType,
          resourceId: log.resourceId,
          result: 'success',
          errorCode: null,
          requestId,
          metadata: log.metadata,
          createdAt: timestamp,
          schemaVersion: 1,
        }),
      })
      return responseSnapshot
    })
  }

  async writeRecord(transaction, context, timestamp, requestId, record) {
    const recordId = resourceId('fridgerec')
    await transaction.collection('fridge_records').doc(recordId).set({
      data: documentData({
        _id: recordId,
        familyId: context.familyId,
        ...record,
        createdAt: timestamp,
        createdBy: context.user._id,
        actorMemberId: context.member._id,
        requestId,
        schemaVersion: 1,
      }),
    })
  }

  async loadBatchForWrite(transaction, context, batchId, expectedVersion) {
    const batch = await this.getFamilyDoc(transaction, 'fridge_batches', batchId, context.familyId)
    if (!batch) throw codedError('NOT_FOUND', '这批食材已经不在冰箱记录里了')
    if (batch.version !== expectedVersion || !batch.remaining) {
      throw codedError('VERSION_CONFLICT', '这批食材已被其他成员更新，请刷新后重试', {
        batchId,
        currentVersion: batch.version,
      })
    }
    return batch
  }

  async listBatches(openid) {
    return this.listRemainingBatches(await this.getContext(openid))
  }

  async listRemainingBatches(context) {
    const result = await this.db
      .collection('fridge_batches')
      .where({ familyId: context.familyId, remaining: true })
      .limit(MAX_LISTED_BATCHES)
      .get()
    const today = familyToday(now())
    // 临期在前，未填保质期的排最后。
    return (result.data || [])
      .slice()
      .sort((left, right) => {
        const a = left.expiresOn || '9999-99-99'
        const b = right.expiresOn || '9999-99-99'
        return a.localeCompare(b) || String(left._id).localeCompare(String(right._id))
      })
      .map((batch) => batchView(batch, today))
  }

  async listRecords(openid, input) {
    const context = await this.getContext(openid)
    const _ = this.db.command
    let where = { familyId: context.familyId }
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor)
      const at = new Date(cursor.t)
      where = _.or([
        { familyId: context.familyId, createdAt: _.lt(at) },
        { familyId: context.familyId, createdAt: _.eq(at), _id: _.lt(cursor.id) },
      ])
    }
    const result = await this.db
      .collection('fridge_records')
      .where(where)
      .orderBy('createdAt', 'desc')
      .orderBy('_id', 'desc')
      .limit(input.pageSize + 1)
      .get()
    const rows = result.data || []
    const page = rows.slice(0, input.pageSize)
    return {
      records: page.map(recordView),
      nextCursor: rows.length > input.pageSize ? encodeCursor(page[page.length - 1]) : '',
    }
  }

  async createBatch(openid, input, requestId) {
    const context = await this.getContext(openid)
    const batchId = resourceId('batch')
    return this.runIdempotent(context, 'fridge.createBatch', input, requestId, '录入食材', async (transaction, timestamp) => {
      const batch = {
        _id: batchId,
        familyId: context.familyId,
        name: input.name,
        normalizedName: normalizeName(input.name),
        expiresOn: input.expiresOn,
        remaining: true,
        spoiled: false,
        endedReason: null,
        version: 1,
        createdAt: timestamp,
        createdBy: context.user._id,
        updatedAt: timestamp,
        updatedBy: context.user._id,
        schemaVersion: 1,
      }
      await transaction.collection('fridge_batches').doc(batchId).set({ data: documentData(batch) })
      await this.writeRecord(transaction, context, timestamp, requestId, {
        batchId,
        name: input.name,
        type: 'added',
      })
      return {
        responseSnapshot: { batch: batchView(batch, familyToday(timestamp)) },
        log: { resourceType: 'fridge_batch', resourceId: batchId, metadata: { hasExpiry: Boolean(input.expiresOn) } },
      }
    })
  }

  async updateBatch(openid, input, requestId) {
    const context = await this.getContext(openid)
    return this.runIdempotent(context, 'fridge.updateBatch', input, requestId, '修改食材', async (transaction, timestamp) => {
      const batch = await this.loadBatchForWrite(transaction, context, input.batchId, input.expectedVersion)
      const changes = []
      if (batch.name !== input.name) changes.push('name')
      if ((batch.expiresOn || '') !== input.expiresOn) changes.push('expiresOn')
      // 未改动直接返回当前批次，不增加版本、不写变动记录。
      if (!changes.length) {
        return {
          responseSnapshot: { batch: batchView(batch, familyToday(timestamp)) },
          log: { resourceType: 'fridge_batch', resourceId: batch._id, metadata: { fields: [] } },
        }
      }
      const updateData = {
        name: input.name,
        normalizedName: normalizeName(input.name),
        expiresOn: input.expiresOn,
        version: batch.version + 1,
        updatedAt: timestamp,
        updatedBy: context.user._id,
      }
      await transaction.collection('fridge_batches').doc(batch._id).update({ data: updateData })
      await this.writeRecord(transaction, context, timestamp, requestId, {
        batchId: batch._id,
        name: input.name,
        type: 'edited',
        changes,
      })
      return {
        responseSnapshot: { batch: batchView({ ...batch, ...updateData }, familyToday(timestamp)) },
        log: { resourceType: 'fridge_batch', resourceId: batch._id, metadata: { fields: changes } },
      }
    })
  }

  // 过期是按日期计算的状态，不自动记报损；只有这里确认丢弃才写报损记录。
  async discardBatch(openid, input, requestId) {
    const context = await this.getContext(openid)
    return this.runIdempotent(context, 'fridge.discardBatch', input, requestId, '记录报损', async (transaction, timestamp) => {
      const batch = await this.loadBatchForWrite(transaction, context, input.batchId, input.expectedVersion)
      const updateData = {
        version: batch.version + 1,
        updatedAt: timestamp,
        updatedBy: context.user._id,
      }
      if (input.usedUp) {
        updateData.remaining = false
        updateData.endedReason = 'discarded'
      } else if (input.reason === 'spoiled') {
        // 只丢了一部分：剩下的同批次也视为变质，不再参与做菜和建议。
        updateData.spoiled = true
      }
      await transaction.collection('fridge_batches').doc(batch._id).update({ data: updateData })
      await this.writeRecord(transaction, context, timestamp, requestId, {
        batchId: batch._id,
        name: batch.name,
        type: 'discarded',
        reason: input.reason,
        usedUp: input.usedUp,
      })
      return {
        responseSnapshot: { batch: batchView({ ...batch, ...updateData }, familyToday(timestamp)) },
        log: { resourceType: 'fridge_batch', resourceId: batch._id, metadata: { reason: input.reason, usedUp: input.usedUp } },
      }
    })
  }

  // 一次做菜的所有批次在同一事务里整体成功或整体失败；同一菜单条目只能记一次消耗。
  async cook(openid, input, requestId) {
    const context = await this.getContext(openid)
    const cookId = cookIdFor(context.familyId, input.menuId, input.itemId)
    return this.runIdempotent(context, 'fridge.cook', input, requestId, '记录做菜消耗', async (transaction, timestamp) => {
      const today = familyToday(timestamp)
      const menu = await this.getFamilyDoc(transaction, 'menus', input.menuId, context.familyId)
      const item = menu ? findMenuItem(menu, input.date, input.mealType, input.itemId) : null
      if (!item) throw codedError('NOT_FOUND', '这道菜已经不在菜单里了，请返回菜单刷新')

      const existingCook = (await transaction.collection('fridge_cooks').doc(cookId).get())?.data || null
      if (existingCook) {
        throw codedError('ALREADY_COOKED', '这道菜已经记录过食材消耗了', { cookedAt: existingCook.createdAt })
      }

      const recipeIngredients = new Set((item.recipeSnapshot?.ingredients || []).map((ingredient) => normalizeName(ingredient.name)))
      const batches = []
      for (const choice of input.batches) {
        const batch = await this.loadBatchForWrite(transaction, context, choice.batchId, choice.expectedVersion)
        if (batch.spoiled || isExpired(batch, today)) {
          throw codedError('VALIDATION_ERROR', `“${batch.name}”已过期或变质，不能用于做菜`, { batchId: batch._id })
        }
        if (!recipeIngredients.has(batch.normalizedName)) {
          throw codedError('VALIDATION_ERROR', `“${batch.name}”不在这道菜的食材里`, { batchId: batch._id })
        }
        batches.push({ batch, usedUp: choice.usedUp })
      }

      const updated = []
      for (const { batch, usedUp } of batches) {
        const updateData = {
          version: batch.version + 1,
          lastCookedAt: timestamp,
          updatedAt: timestamp,
          updatedBy: context.user._id,
        }
        if (usedUp) {
          updateData.remaining = false
          updateData.endedReason = 'usedUp'
        }
        await transaction.collection('fridge_batches').doc(batch._id).update({ data: updateData })
        await this.writeRecord(transaction, context, timestamp, requestId, {
          batchId: batch._id,
          name: batch.name,
          type: 'cooked',
          usedUp,
          recipeName: item.recipeSnapshot?.name || '',
          menuId: input.menuId,
          itemId: input.itemId,
          date: input.date,
          mealType: input.mealType,
        })
        updated.push(batchView({ ...batch, ...updateData }, today))
      }

      const cook = {
        _id: cookId,
        familyId: context.familyId,
        menuId: input.menuId,
        itemId: input.itemId,
        date: input.date,
        mealType: input.mealType,
        recipeId: item.recipeId,
        recipeName: item.recipeSnapshot?.name || '',
        batches: batches.map(({ batch, usedUp }) => ({ batchId: batch._id, name: batch.name, usedUp })),
        requestId,
        createdAt: timestamp,
        createdBy: context.user._id,
        schemaVersion: 1,
      }
      await transaction.collection('fridge_cooks').doc(cookId).set({ data: documentData(cook) })
      return {
        responseSnapshot: {
          cook: { id: cookId, menuId: cook.menuId, itemId: cook.itemId, recipeName: cook.recipeName, createdAt: timestamp },
          batches: updated,
        },
        log: { resourceType: 'fridge_cook', resourceId: cookId, metadata: { batchCount: batches.length } },
      }
    })
  }

  // AI 只读库存，不扣减、不提交采购；失败只影响建议本身。
  async suggest(openid, requestId) {
    const context = await this.getContext(openid)
    const batches = await this.listRemainingBatches(context)
    const seen = new Set()
    const stockNames = []
    batches.filter((batch) => batch.usable).forEach((batch) => {
      const key = normalizeName(batch.name)
      if (seen.has(key)) return
      seen.add(key)
      stockNames.push(batch.name)
    })
    const generatedAt = now()
    if (!stockNames.length) return { suggestions: [], stockNames, generatedAt }

    const recipeResult = await this.db
      .collection('recipes')
      .where({ familyId: context.familyId, deletedAt: null })
      .orderBy('updatedAt', 'desc')
      .limit(MAX_PROMPT_RECIPES)
      .get()
    const recipes = (recipeResult.data || []).map((recipe) => ({
      id: recipe._id,
      name: recipe.name,
      ingredients: (recipe.ingredients || []).map((ingredient) => ingredient.name),
    }))
    const raw = await this.suggester({ stockNames, recipes, requestId })
    return { suggestions: reconcileSuggestions(raw, stockNames, recipes), stockNames, generatedAt }
  }
}

module.exports = { CloudBaseFridgeRepository, batchView, familyToday, cookIdFor, encodeCursor, decodeCursor }
