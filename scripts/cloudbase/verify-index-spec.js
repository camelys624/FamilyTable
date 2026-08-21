'use strict'

const fs = require('fs')
const path = require('path')

const specPath = path.resolve(__dirname, '../../cloudbase/indexes.json')
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
const requiredCollections = [
  'users',
  'families',
  'family_members',
  'recipes',
  'menus',
  'polls',
  'votes',
  'shopping_lists',
  'preferences',
  'idempotency_records',
  'operation_logs',
]

if (spec.version !== 1) throw new Error('索引清单 version 必须为 1')
const collectionNames = spec.collections.map((collection) => collection.name)
for (const required of requiredCollections) {
  if (!collectionNames.includes(required)) throw new Error(`缺少集合：${required}`)
}
if (new Set(collectionNames).size !== collectionNames.length) throw new Error('集合名称重复')

for (const collection of spec.collections) {
  const indexNames = collection.indexes.map((index) => index.name)
  if (new Set(indexNames).size !== indexNames.length) throw new Error(`${collection.name} 存在重复索引名`)
  for (const index of collection.indexes) {
    if (!index.fields.length) throw new Error(`${index.name} 没有索引字段`)
    for (const field of index.fields) {
      if (!field.field || !['asc', 'desc'].includes(field.order)) throw new Error(`${index.name} 字段配置无效`)
    }
  }
}

console.log(`index_spec=ok collections=${spec.collections.length}`)
