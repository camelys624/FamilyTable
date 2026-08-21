'use strict'

const crypto = require('crypto')

function codedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details })
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableValue(value[key])
        return result
      }, {})
  }
  return value
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function documentData(document) {
  const { _id, ...data } = document
  return data
}

function familyView(family) {
  return {
    id: family._id,
    name: family.name,
    timezone: family.timezone,
    weekStartsOn: family.weekStartsOn,
    status: family.status,
  }
}

function memberView(member) {
  return {
    id: member._id,
    familyId: member.familyId,
    role: member.role,
    status: member.status,
    displayName: member.displayName,
  }
}

class CloudBaseFamilyRepository {
  constructor(cloud) {
    this.db = cloud.database()
  }

  async findUser(openid) {
    const result = await this.db.collection('users').where({ openid }).limit(1).get()
    const user = result.data[0] || null
    if (!user || user.status !== 'active') throw codedError('UNAUTHENTICATED', '微信身份已失效，请重新进入小程序')
    return user
  }

  async create(openid, input, requestId) {
    const user = await this.findUser(openid)
    const requestHash = hash(JSON.stringify(stableValue(input)))
    const idempotencyId = `idem_${hash(`${user._id}:family.create:${requestId}`).slice(0, 40)}`
    const memberId = `fm_${hash(user._id).slice(0, 28)}`
    const familyId = `fam_${crypto.randomBytes(12).toString('hex')}`
    const logId = `log_${crypto.randomBytes(12).toString('hex')}`
    const now = new Date()

    return this.db.runTransaction(async (transaction) => {
      const idempotencyResult = await transaction
        .collection('idempotency_records')
        .where({ _id: idempotencyId })
        .limit(1)
        .get()
      const existingIdempotency = idempotencyResult.data[0] || null
      if (existingIdempotency) {
        if (existingIdempotency.requestHash !== requestHash) {
          throw codedError('IDEMPOTENCY_CONFLICT', '同一个 requestId 不能用于不同的创建请求')
        }
        if (existingIdempotency.status === 'succeeded') return existingIdempotency.responseSnapshot
        throw codedError('REQUEST_IN_PROGRESS', '创建家庭的请求正在处理中，请稍后重试')
      }

      const membershipResult = await transaction
        .collection('family_members')
        .where({ _id: memberId })
        .limit(1)
        .get()
      const existingMembership = membershipResult.data[0] || null
      if (existingMembership?.status === 'active') {
        throw codedError('FORBIDDEN', '你已经加入了一个家庭，不能重复创建')
      }

      const family = {
        _id: familyId,
        familyId,
        name: input.name,
        timezone: input.timezone,
        weekStartsOn: 1,
        status: 'active',
        createdAt: now,
        createdBy: user._id,
        updatedAt: now,
        updatedBy: user._id,
        schemaVersion: 1,
      }
      const member = {
        _id: memberId,
        familyId,
        userId: user._id,
        role: 'owner',
        status: 'active',
        displayName: input.displayName,
        joinedAt: now,
        endedAt: null,
        createdAt: now,
        createdBy: user._id,
        updatedAt: now,
        updatedBy: user._id,
        schemaVersion: 1,
      }
      const responseSnapshot = { family: familyView(family), member: memberView(member) }

      await transaction.collection('families').doc(familyId).set({ data: documentData(family) })
      await transaction.collection('family_members').doc(memberId).set({ data: documentData(member) })
      await transaction.collection('users').doc(user._id).update({ data: { displayName: input.displayName, updatedAt: now } })
      await transaction.collection('idempotency_records').doc(idempotencyId).set({
        data: documentData({
          _id: idempotencyId,
          userId: user._id,
          familyId,
          action: 'family.create',
          requestId,
          requestHash,
          status: 'succeeded',
          responseSnapshot,
          errorCode: null,
          createdAt: now,
          updatedAt: now,
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          schemaVersion: 1,
        }),
      })
      await transaction.collection('operation_logs').doc(logId).set({
        data: documentData({
          _id: logId,
          familyId,
          actorUserId: user._id,
          actorMemberId: memberId,
          action: 'family.create',
          resourceType: 'family',
          resourceId: familyId,
          result: 'success',
          errorCode: null,
          requestId,
          metadata: { nameLength: input.name.length },
          createdAt: now,
          schemaVersion: 1,
        }),
      })

      return responseSnapshot
    })
  }

  async current(openid) {
    const user = await this.findUser(openid)
    const membershipResult = await this.db
      .collection('family_members')
      .where({ userId: user._id, status: 'active' })
      .limit(1)
      .get()
    const currentMember = membershipResult.data[0] || null
    if (!currentMember) throw codedError('FAMILY_REQUIRED', '你还没有创建或加入家庭')

    const familyResult = await this.db.collection('families').doc(currentMember.familyId).get()
    const family = familyResult.data || null
    if (!family || family.status !== 'active') throw codedError('NOT_FAMILY_MEMBER', '当前家庭已不可访问')

    const membersResult = await this.db
      .collection('family_members')
      .where({ familyId: family._id, status: 'active' })
      .orderBy('joinedAt', 'asc')
      .get()

    return {
      family: familyView(family),
      currentMember: memberView(currentMember),
      members: membersResult.data.map(memberView),
    }
  }
}

module.exports = { CloudBaseFamilyRepository, hash, stableValue }
