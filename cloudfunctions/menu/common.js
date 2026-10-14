'use strict'

const crypto = require('crypto')
const safeCodes = new Set(['CONTENT_REJECTED', 'FEATURE_UNAVAILABLE', 'UNAUTHENTICATED', 'FAMILY_REQUIRED', 'NOT_FAMILY_MEMBER', 'FORBIDDEN', 'VALIDATION_ERROR', 'NOT_FOUND', 'VERSION_CONFLICT', 'VOTE_ALREADY_CAST', 'POLL_CLOSED', 'POLL_ALREADY_OPEN', 'IDEMPOTENCY_CONFLICT', 'REQUEST_IN_PROGRESS', 'DATABASE_NOT_INITIALIZED'])
const codedError = (code, message, details = {}) => Object.assign(new Error(message), { code, details })
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex')
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value
const dataOnly = ({ _id, ...data }) => data
const get = async (database, collection, id) => (await database.collection(collection).doc(id).get())?.data || null
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)

function text(value, field, max = 80) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw codedError('VALIDATION_ERROR', `${field}需填写 1～${max} 个字符`)
  return value.trim()
}
function version(value) {
  if (!Number.isInteger(value) || value < 0) throw codedError('VALIDATION_ERROR', '请刷新数据后再操作')
  return value
}
function date(value) {
  const normalized = text(value, '日期', 10)
  const parsed = new Date(`${normalized}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) throw codedError('VALIDATION_ERROR', '日期格式不正确')
  return normalized
}
function week(value) {
  const normalized = date(value)
  if (new Date(`${normalized}T00:00:00Z`).getUTCDay() !== 1) throw codedError('VALIDATION_ERROR', '周菜单起始日期需为周一')
  return normalized
}

function createHandler(repository, actions, logger = console) {
  return async (event = {}, identity = {}) => {
    const requestId = typeof event.requestId === 'string' ? event.requestId.trim() : ''
    try {
      if (!identity.openid) throw codedError('UNAUTHENTICATED', '请重新进入小程序')
      const action = actions[event.action]
      if (!action) throw codedError('VALIDATION_ERROR', '不支持的操作')
      const payload = event.payload === undefined ? {} : event.payload
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw codedError('VALIDATION_ERROR', '请求格式不正确')
      if (Object.keys(payload).some((key) => !action.fields.includes(key))) throw codedError('VALIDATION_ERROR', '请求包含不支持的字段')
      if (action.write && (requestId.length < 8 || requestId.length > 64)) throw codedError('VALIDATION_ERROR', '操作需要有效的 requestId')
      const input = action.normalize ? action.normalize(payload) : payload
      return { ok: true, data: await repository[action.method](identity.openid, input, requestId), requestId }
    } catch (error) {
      const missingDatabase = /(collection|table|namespace)/i.test(error.message || '') && /(not exist|not found|不存在)/i.test(error.message || '')
      const code = safeCodes.has(error.code) ? error.code : missingDatabase ? 'DATABASE_NOT_INITIALIZED' : 'INTERNAL_ERROR'
      if (code === 'INTERNAL_ERROR') logger.error('[service]', { requestId, message: error.message })
      return { ok: false, error: { code, message: code === 'INTERNAL_ERROR' ? '服务暂时不可用，请稍后重试' : code === 'DATABASE_NOT_INITIALIZED' ? '数据库尚未初始化，请联系管理员' : error.message, details: error.details || {} }, requestId }
    }
  }
}

class BaseRepository {
  constructor(cloud) { this.db = cloud.database({ throwOnNotFound: false }) }

  async context(openid) {
    const user = (await this.db.collection('users').where({ openid }).limit(1).get()).data[0]
    if (!user || user.status !== 'active') throw codedError('UNAUTHENTICATED', '当前账号不可用')
    const member = (await this.db.collection('family_members').where({ userId: user._id, status: 'active' }).limit(1).get()).data[0]
    if (!member) throw codedError('FAMILY_REQUIRED', '请先创建或加入家庭')
    const family = await get(this.db, 'families', member.familyId)
    if (!family || family.status !== 'active') throw codedError('NOT_FAMILY_MEMBER', '当前家庭已不可访问')
    return { user, member, family, familyId: family._id }
  }

  async validateContext(transaction, context) {
    const user = await get(transaction, 'users', context.user._id)
    const member = await get(transaction, 'family_members', context.member._id)
    const family = await get(transaction, 'families', context.familyId)
    if (!user || user.status !== 'active' || user.openid !== context.user.openid) throw codedError('UNAUTHENTICATED', '当前账号不可用')
    if (!member || member.userId !== user._id || member.familyId !== context.familyId || member.status !== 'active' || !family || family.status !== 'active') throw codedError('NOT_FAMILY_MEMBER', '当前家庭成员关系已失效')
    return { ...context, user, member, family }
  }

  async write(context, action, input, requestId, work) {
    const id = `idem_${hash(`${context.user._id}:${action}:${requestId}`).slice(0, 40)}`
    const requestHash = hash(JSON.stringify(stable(input)))
    return this.db.runTransaction(async (transaction) => {
      const current = await this.validateContext(transaction, context)
      if (['vote.createPoll', 'vote.close'].includes(action) && current.member.role !== 'owner') throw codedError('FORBIDDEN', '只有管理员可以管理投票')
      const receipt = await get(transaction, 'idempotency_records', id)
      if (receipt) {
        if (receipt.requestHash !== requestHash) throw codedError('IDEMPOTENCY_CONFLICT', '同一个请求不能提交不同内容')
        if (receipt.status !== 'succeeded') throw codedError('REQUEST_IN_PROGRESS', '操作正在处理中，请稍后重试')
        return receipt.responseSnapshot
      }
      const now = new Date()
      const response = await work(transaction, now, current)
      await transaction.collection('idempotency_records').doc(id).set({ data: {
        userId: current.user._id, familyId: current.familyId, action, requestId, requestHash,
        status: 'succeeded', responseSnapshot: response, errorCode: null, createdAt: now, updatedAt: now,
        expiresAt: new Date(now.getTime() + 7 * 86400000), schemaVersion: 1,
      } })
      await transaction.collection('operation_logs').doc(`log_${crypto.randomBytes(12).toString('hex')}`).set({ data: {
        familyId: current.familyId, actorUserId: current.user._id, actorMemberId: current.member._id,
        action, resourceType: action.split('.')[0], resourceId: response.poll?.id || response.shoppingList?.id || response.preference?.id || response.vote?.id || '',
        result: 'success', errorCode: null, requestId, metadata: {}, createdAt: now, schemaVersion: 1,
      } })
      return response
    })
  }
}

module.exports = { BaseRepository, createHandler, codedError, get, hash, stable, dataOnly, text, date, week, version, today }
