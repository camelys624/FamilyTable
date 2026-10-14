'use strict'

const { BaseRepository, get, hash, dataOnly } = require('./common')
const preferenceId = (context) => `pref_${hash(`${context.familyId}:${context.user._id}`).slice(0, 40)}`
const view = (document) => ({ id: document._id, spicyLevel: document.spicyLevel, avoidFoods: document.avoidFoods || [], notes: document.notes || '' })
class CloudBasePreferenceRepository extends BaseRepository {
  async getMine(openid) {
    const context = await this.context(openid)
    const rows = await this.db.collection('preferences').where({ familyId: context.familyId, userId: context.user._id }).limit(1).get()
    return { preference: rows.data[0] ? view(rows.data[0]) : { id: preferenceId(context), spicyLevel: 1, avoidFoods: [], notes: '' } }
  }

  async updateMine(openid, input, requestId) {
    const context = await this.context(openid)
    // Existing records can use IDs created before the deterministic ID convention.
    const rows = await this.db.collection('preferences').where({ familyId: context.familyId, userId: context.user._id }).limit(1).get()
    const id = rows.data[0]?._id || preferenceId(context)
    return this.write(context, 'preference.updateMine', input, requestId, async (transaction, now, current) => {
      const existing = await get(transaction, 'preferences', id)
      const document = { _id: id, familyId: current.familyId, userId: current.user._id, memberId: current.member._id, ...input, createdAt: existing?.createdAt || now, createdBy: existing?.createdBy || current.user._id, updatedAt: now, updatedBy: current.user._id, schemaVersion: 1 }
      await transaction.collection('preferences').doc(id).set({ data: dataOnly(document) })
      return { preference: view(document) }
    })
  }
}
module.exports = { CloudBasePreferenceRepository }
