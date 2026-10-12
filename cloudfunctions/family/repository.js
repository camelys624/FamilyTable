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

// 32 symbols: cryptographically random 40-bit code, excluding ambiguous 0/1/I/O.
function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.randomBytes(8), (byte) => alphabet[byte & 31]).join('')
}

async function getDocument(database, collection, id) {
  return (await database.collection(collection).doc(id).get()).data || null
}

async function activeMembership(transaction, userId, legacyMember) {
  const member = await getDocument(transaction, 'family_members', `fm_${hash(userId).slice(0, 28)}`)
  if (member?.status === 'active') return member
  if (!legacyMember || legacyMember._id === member?._id) return null
  const legacy = await getDocument(transaction, 'family_members', legacyMember._id)
  return legacy?.status === 'active' && legacy.userId === userId ? legacy : null
}

async function assertActiveUser(transaction, user) {
  const current = await getDocument(transaction, 'users', user._id)
  if (!current || current.status !== 'active' || current.openid !== user.openid) throw codedError('UNAUTHENTICATED', '当前账号不可用')
}

async function readReceipt(transaction, userId, action, requestId, input) {
  const id = `idem_${hash(`${userId}:${action}:${requestId}`).slice(0, 40)}`
  const requestHash = hash(JSON.stringify(stableValue(input)))
  const receipt = await getDocument(transaction, 'idempotency_records', id)
  if (receipt && receipt.requestHash !== requestHash) throw codedError('IDEMPOTENCY_CONFLICT', '同一个请求不能用于不同的家庭操作')
  if (receipt && receipt.status !== 'succeeded') throw codedError('REQUEST_IN_PROGRESS', '请求正在处理中，请稍后重试')
  return { id, requestHash, response: receipt?.responseSnapshot }
}

async function writeReceipt(transaction, user, member, action, requestId, receipt, response, now) {
  await transaction.collection('idempotency_records').doc(receipt.id).set({ data: {
    userId: user._id, familyId: member.familyId, action, requestId,
    requestHash: receipt.requestHash, status: 'succeeded', responseSnapshot: response,
    errorCode: null, createdAt: now, updatedAt: now,
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), schemaVersion: 1,
  } })
  await transaction.collection('operation_logs').doc(`log_${crypto.randomBytes(12).toString('hex')}`).set({ data: {
    familyId: member.familyId, actorUserId: user._id, actorMemberId: member._id,
    action, resourceType: 'family', resourceId: member.familyId,
    result: 'success', errorCode: null, requestId, metadata: {}, createdAt: now, schemaVersion: 1,
  } })
}

class CloudBaseFamilyRepository {
  constructor(cloud) {
    this.db = cloud.database({ throwOnNotFound: false })
  }

  async findUser(openid) {
    const result = await this.db.collection('users').where({ openid }).limit(1).get()
    const user = result.data[0] || null
    if (!user || user.status !== 'active') throw codedError('UNAUTHENTICATED', '微信身份已失效，请重新进入小程序')
    return user
  }

  async create(openid, input, requestId) {
    const user = await this.findUser(openid)
    const legacyMember = await this.findMembership(user._id)
    const requestHash = hash(JSON.stringify(stableValue(input)))
    const idempotencyId = `idem_${hash(`${user._id}:family.create:${requestId}`).slice(0, 40)}`
    const memberId = `fm_${hash(user._id).slice(0, 28)}`
    const familyId = `fam_${crypto.randomBytes(12).toString('hex')}`
    const logId = `log_${crypto.randomBytes(12).toString('hex')}`
    const now = new Date()

    return this.db.runTransaction(async (transaction) => {
      await assertActiveUser(transaction, user)
      const existingIdempotency = await getDocument(transaction, 'idempotency_records', idempotencyId)
      if (existingIdempotency) {
        if (existingIdempotency.requestHash !== requestHash) {
          throw codedError('IDEMPOTENCY_CONFLICT', '同一个 requestId 不能用于不同的创建请求')
        }
        if (existingIdempotency.status === 'succeeded') {
          const member = await activeMembership(transaction, user._id, legacyMember)
          const family = member ? await getDocument(transaction, 'families', member.familyId) : null
          if (!family || family.status !== 'active' || family._id !== existingIdempotency.responseSnapshot.family.id) {
            throw codedError('NOT_FAMILY_MEMBER', '原来的家庭成员关系已失效')
          }
          return existingIdempotency.responseSnapshot
        }
        throw codedError('REQUEST_IN_PROGRESS', '创建家庭的请求正在处理中，请稍后重试')
      }

      const existingMembership = await activeMembership(transaction, user._id, legacyMember)
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
        memberCount: 1,
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

  async findMembership(userId) {
    const result = await this.db.collection('family_members').where({ userId, status: 'active' }).limit(1).get()
    return result.data[0] || null
  }

  async invite(openid, input, requestId) {
    const user = await this.findUser(openid)
    const legacyMember = await this.findMembership(user._id)
    if (!legacyMember) throw codedError('FAMILY_REQUIRED', '你还没有创建或加入家庭')
    const countResult = await this.db.collection('family_members').where({ familyId: legacyMember.familyId, status: 'active' }).count()
    const inviteCode = generateInviteCode()
    return this.db.runTransaction(async (transaction) => {
      await assertActiveUser(transaction, user)
      const member = await activeMembership(transaction, user._id, legacyMember)
      if (!member) throw codedError('FAMILY_REQUIRED', '你还没有创建或加入家庭')
      const family = await getDocument(transaction, 'families', member.familyId)
      if (!family || family.status !== 'active') throw codedError('NOT_FAMILY_MEMBER', '当前家庭已不可访问')
      if (member.role !== 'owner') throw codedError('FORBIDDEN', '只有家庭管理员可以生成邀请码')
      const receipt = await readReceipt(transaction, user._id, 'family.invite', requestId, input)
      const now = new Date()
      if (receipt.response) {
        if (family.inviteCodeHash !== hash(receipt.response.inviteCode)) throw codedError('INVITE_INVALID', '邀请码已更新，请生成新码')
        if (!(new Date(family.inviteExpiresAt).getTime() > now.getTime())) throw codedError('INVITE_EXPIRED', '邀请码已过期，请生成新码')
        return receipt.response
      }
      const expiresAt = new Date(now.getTime() + input.expiresInHours * 60 * 60 * 1000)
      await transaction.collection('families').doc(family._id).update({ data: {
        inviteCodeHash: hash(inviteCode), inviteExpiresAt: expiresAt,
        memberCount: Number.isInteger(family.memberCount) ? family.memberCount : countResult.total,
        updatedAt: now, updatedBy: user._id,
      } })
      const response = { familyId: family._id, inviteCode, expiresAt: expiresAt.toISOString() }
      await writeReceipt(transaction, user, member, 'family.invite', requestId, receipt, response, now)
      return response
    })
  }

  async join(openid, input, requestId) {
    const user = await this.findUser(openid)
    const legacyMember = await this.findMembership(user._id)
    // Queries locate candidates only. The transaction re-reads documents and verifies
    // membership and the code hash; CloudBase transactions do not support where().
    const candidates = await this.db.collection('families').where({ inviteCodeHash: hash(input.inviteCode), status: 'active' }).limit(1).get()
    const candidateId = candidates.data[0]?._id
    return this.db.runTransaction(async (transaction) => {
      await assertActiveUser(transaction, user)
      const receipt = await readReceipt(transaction, user._id, 'family.join', requestId, input)
      const existingMember = await activeMembership(transaction, user._id, legacyMember)
      if (receipt.response) {
        if (!existingMember || existingMember.familyId !== receipt.response.family.id) {
          throw codedError('NOT_FAMILY_MEMBER', '原来的家庭成员关系已失效')
        }
        const joinedFamily = await getDocument(transaction, 'families', existingMember.familyId)
        if (!joinedFamily || joinedFamily.status !== 'active') throw codedError('NOT_FAMILY_MEMBER', '当前家庭已不可访问')
        return receipt.response
      }
      const family = candidateId ? await getDocument(transaction, 'families', candidateId) : null
      if (!family || family.status !== 'active' || family.inviteCodeHash !== hash(input.inviteCode)) throw codedError('INVITE_INVALID', '邀请码无效，请向家人确认最新邀请码')
      const now = new Date()
      if (!family.inviteExpiresAt || !(new Date(family.inviteExpiresAt).getTime() > now.getTime())) {
        throw codedError('INVITE_EXPIRED', '邀请码已过期，请让管理员生成新码')
      }
      if (existingMember && existingMember.familyId !== family._id) throw codedError('FORBIDDEN', '你已经加入其他家庭，不能重复加入')
      let member = existingMember
      if (!member) {
        if (!Number.isInteger(family.memberCount) || family.memberCount < 1) throw codedError('INVITE_INVALID', '请让管理员生成新码后再加入')
        if (family.memberCount >= 20) throw codedError('FAMILY_FULL', '家庭成员已达 20 人上限')
        const memberId = `fm_${hash(user._id).slice(0, 28)}`
        member = { _id: memberId, familyId: family._id, userId: user._id,
          role: 'member', status: 'active', displayName: input.displayName,
          joinedAt: now, endedAt: null, createdAt: now, createdBy: user._id,
          updatedAt: now, updatedBy: user._id, schemaVersion: 1 }
        await transaction.collection('family_members').doc(memberId).set({ data: documentData(member) })
        await transaction.collection('users').doc(user._id).update({ data: { displayName: input.displayName, updatedAt: now } })
        // Conflict with code rotation and other joins; the SDK retries the whole transaction.
        await transaction.collection('families').doc(family._id).update({ data: { memberCount: family.memberCount + 1, updatedAt: now, updatedBy: user._id } })
      }
      const response = { family: familyView(family), member: memberView(member) }
      await writeReceipt(transaction, user, member, 'family.join', requestId, receipt, response, now)
      return response
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
      .limit(100)
      .get()

    return {
      family: familyView(family),
      currentMember: memberView(currentMember),
      members: membersResult.data.map(memberView),
      invitation: {
        active: Boolean(family.inviteCodeHash && family.inviteExpiresAt && new Date(family.inviteExpiresAt).getTime() > Date.now()),
        expiresAt: family.inviteExpiresAt ? new Date(family.inviteExpiresAt).toISOString() : '',
      },
    }
  }
}

module.exports = { CloudBaseFamilyRepository, hash, stableValue }
