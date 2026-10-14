'use strict'

const { createHandler, codedError, text } = require('./common')
function createPreferenceHandler(repository, logger) {
  return createHandler(repository, {
    'preference.getMine': { method: 'getMine', fields: [] },
    'preference.updateMine': { method: 'updateMine', write: true, fields: ['spicyLevel', 'avoidFoods', 'notes'], normalize(p) {
      if (!Number.isInteger(p.spicyLevel) || p.spicyLevel < 0 || p.spicyLevel > 3) throw codedError('VALIDATION_ERROR', '吃辣程度需为 0～3')
      if (!Array.isArray(p.avoidFoods) || p.avoidFoods.length > 50) throw codedError('VALIDATION_ERROR', '忌口最多填写 50 项')
      if (p.notes !== undefined && (typeof p.notes !== 'string' || p.notes.length > 500)) throw codedError('VALIDATION_ERROR', '备注最多填写 500 个字')
      return { spicyLevel: p.spicyLevel, avoidFoods: [...new Set(p.avoidFoods.map((name) => text(name, '忌口', 30)))], notes: (p.notes || '').trim() }
    } },
  }, logger)
}
module.exports = { createPreferenceHandler }
