'use strict'

function codedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details })
}

function userView(user) {
  return {
    id: user._id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl || null,
    status: user.status,
  }
}

function familyView(family) {
  if (!family) return null
  return {
    id: family._id,
    name: family.name,
    timezone: family.timezone,
    weekStartsOn: family.weekStartsOn,
    status: family.status,
  }
}

function memberView(member) {
  if (!member) return null
  return {
    id: member._id,
    familyId: member.familyId,
    role: member.role,
    status: member.status,
    displayName: member.displayName,
  }
}

function preferenceView(preference) {
  if (!preference) return null
  return {
    id: preference._id,
    spicyLevel: preference.spicyLevel,
    avoidFoods: preference.avoidFoods || [],
    notes: preference.notes || '',
  }
}

class CloudBaseAuthRepository {
  constructor(cloud) {
    this.db = cloud.database()
  }

  async findUser(openid) {
    const result = await this.db.collection('users').where({ openid }).limit(1).get()
    return result.data[0] || null
  }

  async login(openid) {
    const now = new Date()
    let user = await this.findUser(openid)
    if (!user) {
      const data = {
        openid,
        displayName: '微信用户',
        avatarUrl: null,
        status: 'active',
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      }
      const created = await this.db.collection('users').add({ data })
      user = { _id: created._id, ...data }
    } else {
      if (user.status !== 'active') throw codedError('UNAUTHENTICATED', '当前账号不可用')
      await this.db.collection('users').doc(user._id).update({ data: { lastLoginAt: now, updatedAt: now } })
      user = { ...user, lastLoginAt: now, updatedAt: now }
    }

    const membershipResult = await this.db
      .collection('family_members')
      .where({ userId: user._id, status: 'active' })
      .limit(1)
      .get()
    const member = membershipResult.data[0] || null
    let family = null
    let preference = null

    if (member) {
      const familyResult = await this.db.collection('families').doc(member.familyId).get()
      family = familyResult.data && familyResult.data.status === 'active' ? familyResult.data : null
      if (family) {
        const preferenceResult = await this.db
          .collection('preferences')
          .where({ familyId: family._id, userId: user._id })
          .limit(1)
          .get()
        preference = preferenceResult.data[0] || null
      }
    }

    return {
      user: userView(user),
      family: familyView(family),
      member: family ? memberView(member) : null,
      preference: preferenceView(preference),
      onboardingRequired: !family,
    }
  }

  async updateProfile(openid, profile) {
    const user = await this.findUser(openid)
    if (!user || user.status !== 'active') throw codedError('UNAUTHENTICATED', '微信身份已失效，请重新进入小程序')
    const updatedAt = new Date()
    const data = { displayName: profile.displayName, updatedAt }
    if (profile.avatarUrl !== undefined) data.avatarUrl = profile.avatarUrl || null
    await this.db.collection('users').doc(user._id).update({ data })
    return {
      user: userView({
        ...user,
        displayName: data.displayName,
        avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : user.avatarUrl,
        updatedAt,
      }),
    }
  }
}

module.exports = { CloudBaseAuthRepository }
