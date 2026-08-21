'use strict'

const {
  codedError,
  documentData,
  idempotencyId,
  now,
  operationLogId,
  requestHash,
  resourceId,
} = require('./repository-utils')

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, '')
}


function recipeView(recipe) {
  return {
    id: recipe._id,
    name: recipe.name,
    category: recipe.category,
    durationMinutes: recipe.durationMinutes,
    difficulty: recipe.difficulty,
    note: recipe.note || '',
    ingredients: recipe.ingredients.map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    })),
    steps: Array.isArray(recipe.steps) ? recipe.steps : [],
  }
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
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    })),
  }
}

function normalizeIngredients(ingredients) {
  return ingredients.map((ingredient) => ({
    name: ingredient.name,
    normalizedName: normalizeName(ingredient.name),
    quantity: ingredient.quantity,
    unit: ingredient.unit,
  }))
}

function documentExists(result) {
  return result?.data?.[0] || null
}

class CloudBaseRecipeRepository {
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

    return { user, member, familyId: member.familyId }
  }

  async list(openid, input) {
    const context = await this.getContext(openid)
    const where = { familyId: context.familyId, deletedAt: null }
    if (input.category) where.category = input.category
    let query = this.db.collection('recipes').where(where)
    if (input.keyword && this.db.command) {
      query = query.where({
        searchName: this.db.command.gte(input.keyword).and(this.db.command.lt(`${input.keyword}\uffff`)),
      })
    }
    const result = await query.orderBy('updatedAt', 'desc').limit(input.pageSize).get()
    let items = result.data || []
    if (input.keyword && !this.db.command) {
      items = items.filter((recipe) => recipe.searchName.includes(input.keyword))
    }
    return {
      items: items.map(recipeView),
      nextCursor: '',
    }
  }

  async detail(openid, recipeId) {
    const context = await this.getContext(openid)
    const result = await this.db
      .collection('recipes')
      .where({ _id: recipeId, familyId: context.familyId, deletedAt: null })
      .limit(1)
      .get()
    const recipe = documentExists(result)
    if (!recipe) throw codedError('NOT_FOUND', '这道菜已经不在菜谱簿里了')
    return recipeView(recipe)
  }

  async create(openid, input, requestId) {
    const context = await this.getContext(openid)
    const requestHashValue = requestHash(input)
    const idempotencyRecordId = idempotencyId(context.user._id, 'recipe.create', requestId)
    const recipeId = resourceId('recipe')
    const logId = operationLogId()
    const timestamp = now()

    return this.db.runTransaction(async (transaction) => {
      const idempotencyResult = await transaction
        .collection('idempotency_records')
        .where({ _id: idempotencyRecordId })
        .limit(1)
        .get()
      const existingIdempotency = documentExists(idempotencyResult)
      if (existingIdempotency) {
        if (existingIdempotency.requestHash !== requestHashValue) {
          throw codedError('IDEMPOTENCY_CONFLICT', '同一个 requestId 不能用于不同的新增菜谱请求')
        }
        if (existingIdempotency.status === 'succeeded') return existingIdempotency.responseSnapshot
        throw codedError('REQUEST_IN_PROGRESS', '新增菜谱的请求正在处理中，请稍后重试')
      }

      const recipe = {
        _id: recipeId,
        familyId: context.familyId,
        name: input.name,
        searchName: normalizeName(input.name),
        category: input.category,
        durationMinutes: input.durationMinutes,
        difficulty: input.difficulty,
        note: input.note,
        ingredients: normalizeIngredients(input.ingredients),
        steps: input.steps,
        createdAt: timestamp,
        createdBy: context.user._id,
        updatedAt: timestamp,
        updatedBy: context.user._id,
        deletedAt: null,
        deletedBy: null,
        schemaVersion: 1,
      }
      const responseSnapshot = recipeView(recipe)

      await transaction.collection('recipes').doc(recipeId).set({ data: documentData(recipe) })
      await transaction.collection('idempotency_records').doc(idempotencyRecordId).set({
        data: documentData({
          _id: idempotencyRecordId,
          userId: context.user._id,
          familyId: context.familyId,
          action: 'recipe.create',
          requestId,
          requestHash: requestHashValue,
          status: 'succeeded',
          responseSnapshot,
          errorCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt: new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000),
          schemaVersion: 1,
        }),
      })
      await this.writeOperationLog(transaction, {
        _id: logId,
        familyId: context.familyId,
        actorUserId: context.user._id,
        actorMemberId: context.member._id,
        action: 'recipe.create',
        resourceType: 'recipe',
        resourceId: recipeId,
        result: 'success',
        errorCode: null,
        requestId,
        metadata: { ingredientCount: input.ingredients.length },
        createdAt: timestamp,
        schemaVersion: 1,
      })

      return responseSnapshot
    })
  }

  async update(openid, recipeId, patch, requestId) {
    const context = await this.getContext(openid)
    const input = { recipeId, patch }
    const requestHashValue = requestHash(input)
    const idempotencyRecordId = idempotencyId(context.user._id, 'recipe.update', requestId)
    const logId = operationLogId()
    const timestamp = now()

    return this.db.runTransaction(async (transaction) => {
      const idempotencyResult = await transaction
        .collection('idempotency_records')
        .where({ _id: idempotencyRecordId })
        .limit(1)
        .get()
      const existingIdempotency = documentExists(idempotencyResult)
      if (existingIdempotency) {
        if (existingIdempotency.requestHash !== requestHashValue) {
          throw codedError('IDEMPOTENCY_CONFLICT', '同一个 requestId 不能用于不同的修改菜谱请求')
        }
        if (existingIdempotency.status === 'succeeded') return existingIdempotency.responseSnapshot
        throw codedError('REQUEST_IN_PROGRESS', '修改菜谱的请求正在处理中，请稍后重试')
      }

      const recipeResult = await transaction
        .collection('recipes')
        .where({ _id: recipeId, familyId: context.familyId, deletedAt: null })
        .limit(1)
        .get()
      const existing = documentExists(recipeResult)
      if (!existing) throw codedError('NOT_FOUND', '这道菜已经不在菜谱簿里了')

      const updateData = {
        updatedAt: timestamp,
        updatedBy: context.user._id,
      }
      Object.keys(patch).forEach((key) => {
        updateData[key] = key === 'ingredients' ? normalizeIngredients(patch[key]) : patch[key]
      })
      if (patch.name) updateData.searchName = normalizeName(patch.name)
      const updated = { ...existing, ...updateData }
      const responseSnapshot = recipeView(updated)

      await transaction.collection('recipes').doc(recipeId).update({ data: updateData })
      await transaction.collection('idempotency_records').doc(idempotencyRecordId).set({
        data: documentData({
          _id: idempotencyRecordId,
          userId: context.user._id,
          familyId: context.familyId,
          action: 'recipe.update',
          requestId,
          requestHash: requestHashValue,
          status: 'succeeded',
          responseSnapshot,
          errorCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt: new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000),
          schemaVersion: 1,
        }),
      })
      await this.writeOperationLog(transaction, {
        _id: logId,
        familyId: context.familyId,
        actorUserId: context.user._id,
        actorMemberId: context.member._id,
        action: 'recipe.update',
        resourceType: 'recipe',
        resourceId: recipeId,
        result: 'success',
        errorCode: null,
        requestId,
        metadata: { fields: Object.keys(patch) },
        createdAt: timestamp,
        schemaVersion: 1,
      })

      return responseSnapshot
    })
  }

  async delete(openid, recipeId, requestId) {
    const context = await this.getContext(openid)
    const requestHashValue = requestHash({ recipeId })
    const idempotencyRecordId = idempotencyId(context.user._id, 'recipe.delete', requestId)
    const logId = operationLogId()
    const timestamp = now()

    return this.db.runTransaction(async (transaction) => {
      const idempotencyResult = await transaction
        .collection('idempotency_records')
        .where({ _id: idempotencyRecordId })
        .limit(1)
        .get()
      const existingIdempotency = documentExists(idempotencyResult)
      if (existingIdempotency) {
        if (existingIdempotency.requestHash !== requestHashValue) {
          throw codedError('IDEMPOTENCY_CONFLICT', '同一个 requestId 不能用于不同的删除菜谱请求')
        }
        if (existingIdempotency.status === 'succeeded') return existingIdempotency.responseSnapshot
        throw codedError('REQUEST_IN_PROGRESS', '删除菜谱的请求正在处理中，请稍后重试')
      }

      const recipeResult = await transaction
        .collection('recipes')
        .where({ _id: recipeId, familyId: context.familyId, deletedAt: null })
        .limit(1)
        .get()
      const existing = documentExists(recipeResult)
      if (!existing) throw codedError('NOT_FOUND', '这道菜已经不在菜谱簿里了')
      if (existing.createdBy !== context.user._id && !['owner', 'admin'].includes(context.member.role)) {
        throw codedError('FORBIDDEN', '只有创建者或家庭管理员可以删除这道菜')
      }

      const updateData = { deletedAt: timestamp, deletedBy: context.user._id, updatedAt: timestamp, updatedBy: context.user._id }
      const responseSnapshot = { recipeId, deletedAt: timestamp }
      await transaction.collection('recipes').doc(recipeId).update({ data: updateData })
      await transaction.collection('idempotency_records').doc(idempotencyRecordId).set({
        data: documentData({
          _id: idempotencyRecordId,
          userId: context.user._id,
          familyId: context.familyId,
          action: 'recipe.delete',
          requestId,
          requestHash: requestHashValue,
          status: 'succeeded',
          responseSnapshot,
          errorCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt: new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000),
          schemaVersion: 1,
        }),
      })
      await this.writeOperationLog(transaction, {
        _id: logId,
        familyId: context.familyId,
        actorUserId: context.user._id,
        actorMemberId: context.member._id,
        action: 'recipe.delete',
        resourceType: 'recipe',
        resourceId: recipeId,
        result: 'success',
        errorCode: null,
        requestId,
        metadata: {},
        createdAt: timestamp,
        schemaVersion: 1,
      })

      return responseSnapshot
    })
  }

  async writeOperationLog(transaction, log) {
    await transaction.collection('operation_logs').doc(log._id).set({ data: documentData(log) })
  }
}

module.exports = { CloudBaseRecipeRepository, recipeView, recipeSnapshot, normalizeName }
