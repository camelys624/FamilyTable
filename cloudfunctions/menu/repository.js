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

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']

function documentExists(result) {
  return result?.data?.[0] || null
}

function addDays(date, offset) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}

function buildDays(weekStart) {
  return Array.from({ length: 7 }, (_, index) => ({
    date: addDays(weekStart, index),
    breakfast: [],
    lunch: [],
    dinner: [],
  }))
}

function menuIdFor(familyId, weekStart) {
  return `menu_${hash(`${familyId}:${weekStart}`).slice(0, 40)}`
}

function recipeSnapshot(recipe) {
  return {
    recipeId: recipe._id,
    name: recipe.name,
    category: recipe.category,
    durationMinutes: recipe.durationMinutes,
    difficulty: recipe.difficulty,
    note: recipe.note || '',
    steps: Array.isArray(recipe.steps) ? recipe.steps : [],
    ingredients: recipe.ingredients.map((ingredient) => ({
      name: ingredient.name,
      usedUp: typeof ingredient.usedUp === 'boolean' ? ingredient.usedUp : true,
    })),
  }
}

function menuView(menu) {
  return {
    id: menu._id,
    weekStart: menu.weekStart,
    timezone: menu.timezone,
    version: menu.version,
    days: menu.days.map((day) => ({
      date: day.date,
      breakfast: day.breakfast || [],
      lunch: day.lunch || [],
      dinner: day.dinner || [],
    })),
  }
}

function duplicateError(error) {
  return /(duplicate|unique|already exists|已存在|唯一)/i.test(String(error?.message || error || ''))
}

class CloudBaseMenuRepository {
  constructor(cloud) {
    this.db = cloud.database()
  }

  async getContext(openid) {
    const userResult = await this.db.collection('users').where({ openid }).limit(1).get()
    const user = documentExists(userResult)
    if (!user || user.status !== 'active') throw codedError('UNAUTHENTICATED', '微信身份已失效，请重新进入小程序')

    const memberResult = await this.db
      .collection('family_members')
      .where({ userId: user._id, status: 'active' })
      .limit(1)
      .get()
    const member = documentExists(memberResult)
    if (!member) throw codedError('FAMILY_REQUIRED', '你还没有创建或加入家庭')

    const familyResult = await this.db.collection('families').where({ _id: member.familyId, status: 'active' }).limit(1).get()
    if (!documentExists(familyResult)) throw codedError('NOT_FAMILY_MEMBER', '当前家庭已不可访问')
    return { user, member, familyId: member.familyId }
  }

  async findMenu(database, familyId, menuId) {
    const result = await database.collection('menus').where({ _id: menuId, familyId }).limit(1).get()
    return documentExists(result)
  }

  async findRecipe(database, familyId, recipeId) {
    const result = await database
      .collection('recipes')
      .where({ _id: recipeId, familyId, deletedAt: null })
      .limit(1)
      .get()
    return documentExists(result)
  }

  async week(openid, weekStart) {
    const context = await this.getContext(openid)
    const menuId = menuIdFor(context.familyId, weekStart)
    const current = await this.findMenu(this.db, context.familyId, menuId)
    if (current) return menuView(current)
    return {
      id: menuId,
      weekStart,
      timezone: 'Asia/Shanghai',
      version: 0,
      days: buildDays(weekStart),
    }
  }

  async addRecipe(openid, input, requestId) {
    const context = await this.getContext(openid)
    const menuId = menuIdFor(context.familyId, input.weekStart)
    const requestHashValue = requestHash(input)
    const idempotencyRecordId = idempotencyId(context.user._id, 'menu.addRecipe', requestId)
    const logId = operationLogId()
    const timestamp = now()

    try {
      return await this.db.runTransaction(async (transaction) => {
        const existingIdempotency = documentExists(await transaction
          .collection('idempotency_records')
          .where({ _id: idempotencyRecordId })
          .limit(1)
          .get())
        if (existingIdempotency) {
          if (existingIdempotency.requestHash !== requestHashValue) {
            throw codedError('IDEMPOTENCY_CONFLICT', '同一个 requestId 不能用于不同的添加菜单请求')
          }
          if (existingIdempotency.status === 'succeeded') return existingIdempotency.responseSnapshot
          throw codedError('REQUEST_IN_PROGRESS', '添加菜单的请求正在处理中，请稍后重试')
        }

        const current = await this.findMenu(transaction, context.familyId, menuId)
        const currentVersion = current?.version || 0
        if (currentVersion !== input.expectedVersion) {
          throw codedError('VERSION_CONFLICT', '菜单已被其他成员更新，请刷新后重试', { currentVersion })
        }
        const recipe = await this.findRecipe(transaction, context.familyId, input.recipeId)
        if (!recipe) throw codedError('NOT_FOUND', '这道菜已经不在当前家庭菜谱簿里了')

        const next = current
          ? {
              ...current,
              days: current.days.map((day) => ({
                ...day,
                breakfast: [...(day.breakfast || [])],
                lunch: [...(day.lunch || [])],
                dinner: [...(day.dinner || [])],
              })),
            }
          : {
              _id: menuId,
              familyId: context.familyId,
              weekStart: input.weekStart,
              timezone: 'Asia/Shanghai',
              version: 0,
              days: buildDays(input.weekStart),
              createdAt: timestamp,
              createdBy: context.user._id,
              schemaVersion: 1,
            }
        const day = next.days.find((item) => item.date === input.date)
        if (!day) throw codedError('VALIDATION_ERROR', '菜单日期不属于当前周')
        day[input.mealType].push({
          id: resourceId('menuitem'),
          recipeId: recipe._id,
          recipeSnapshot: recipeSnapshot(recipe),
          source: 'manual',
          addedAt: timestamp,
          addedBy: context.user._id,
        })
        next.version = currentVersion + 1
        next.updatedAt = timestamp
        next.updatedBy = context.user._id
        const responseSnapshot = menuView(next)

        if (current) {
          await transaction.collection('menus').doc(menuId).update({
            data: {
              days: next.days,
              version: next.version,
              updatedAt: timestamp,
              updatedBy: context.user._id,
            },
          })
        } else {
          await transaction.collection('menus').doc(menuId).set({ data: documentData(next) })
        }
        await this.writeIdempotency(transaction, {
          _id: idempotencyRecordId,
          userId: context.user._id,
          familyId: context.familyId,
          action: 'menu.addRecipe',
          requestId,
          requestHash: requestHashValue,
          status: 'succeeded',
          responseSnapshot,
          errorCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt: new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000),
          schemaVersion: 1,
        })
        await this.writeOperationLog(transaction, {
          _id: logId,
          familyId: context.familyId,
          actorUserId: context.user._id,
          actorMemberId: context.member._id,
          action: 'menu.addRecipe',
          resourceType: 'menu',
          resourceId: menuId,
          result: 'success',
          errorCode: null,
          requestId,
          metadata: { date: input.date, mealType: input.mealType, recipeId: input.recipeId },
          createdAt: timestamp,
          schemaVersion: 1,
        })
        return responseSnapshot
      })
    } catch (error) {
      if (duplicateError(error)) throw codedError('VERSION_CONFLICT', '菜单已被其他成员更新，请刷新后重试')
      throw error
    }
  }

  async removeRecipe(openid, input, requestId) {
    const context = await this.getContext(openid)
    const requestHashValue = requestHash(input)
    const idempotencyRecordId = idempotencyId(context.user._id, 'menu.removeRecipe', requestId)
    const logId = operationLogId()
    const timestamp = now()

    return this.db.runTransaction(async (transaction) => {
      const existingIdempotency = documentExists(await transaction
        .collection('idempotency_records')
        .where({ _id: idempotencyRecordId })
        .limit(1)
        .get())
      if (existingIdempotency) {
        if (existingIdempotency.requestHash !== requestHashValue) {
          throw codedError('IDEMPOTENCY_CONFLICT', '同一个 requestId 不能用于不同的移除菜单请求')
        }
        if (existingIdempotency.status === 'succeeded') return existingIdempotency.responseSnapshot
        throw codedError('REQUEST_IN_PROGRESS', '移除菜单的请求正在处理中，请稍后重试')
      }

      const current = await this.findMenu(transaction, context.familyId, input.menuId)
      if (!current) throw codedError('NOT_FOUND', '这一周还没有保存过菜单')
      if (current.version !== input.expectedVersion) {
        throw codedError('VERSION_CONFLICT', '菜单已被其他成员更新，请刷新后重试', { currentVersion: current.version })
      }
      const days = current.days.map((day) => ({
        ...day,
        breakfast: [...(day.breakfast || [])],
        lunch: [...(day.lunch || [])],
        dinner: [...(day.dinner || [])],
      }))
      let removed = false
      days.forEach((day) => {
        MEAL_TYPES.forEach((mealType) => {
          const before = day[mealType].length
          day[mealType] = day[mealType].filter((item) => item.id !== input.itemId)
          if (day[mealType].length !== before) removed = true
        })
      })
      if (!removed) throw codedError('NOT_FOUND', '这道菜已经从菜单移除了')

      const next = { ...current, days, version: current.version + 1, updatedAt: timestamp, updatedBy: context.user._id }
      const responseSnapshot = menuView(next)
      await transaction.collection('menus').doc(input.menuId).update({
        data: { days, version: next.version, updatedAt: timestamp, updatedBy: context.user._id },
      })
      await this.writeIdempotency(transaction, {
        _id: idempotencyRecordId,
        userId: context.user._id,
        familyId: context.familyId,
        action: 'menu.removeRecipe',
        requestId,
        requestHash: requestHashValue,
        status: 'succeeded',
        responseSnapshot,
        errorCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000),
        schemaVersion: 1,
      })
      await this.writeOperationLog(transaction, {
        _id: logId,
        familyId: context.familyId,
        actorUserId: context.user._id,
        actorMemberId: context.member._id,
        action: 'menu.removeRecipe',
        resourceType: 'menu',
        resourceId: input.menuId,
        result: 'success',
        errorCode: null,
        requestId,
        metadata: { itemId: input.itemId },
        createdAt: timestamp,
        schemaVersion: 1,
      })
      return responseSnapshot
    })
  }

  async writeIdempotency(transaction, record) {
    await transaction.collection('idempotency_records').doc(record._id).set({ data: documentData(record) })
  }

  async writeOperationLog(transaction, log) {
    await transaction.collection('operation_logs').doc(log._id).set({ data: documentData(log) })
  }
}

module.exports = { CloudBaseMenuRepository, buildDays, menuIdFor, menuView, recipeSnapshot }
