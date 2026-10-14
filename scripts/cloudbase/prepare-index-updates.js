'use strict'
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '../..')
const auditFile = process.argv[2]
const output = process.argv[3]
if (!auditFile || !output) throw new Error('用法：node prepare-index-updates.js <只读索引审计JSON> <输出目录>')
const spec = JSON.parse(fs.readFileSync(path.join(root, 'cloudbase/indexes.json'), 'utf8'))
const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8').replace(/^\uFEFF/, ''))
fs.mkdirSync(output, { recursive: true })
const manifest = []
for (const collection of spec.collections) {
  if (!audit[collection.name]?.ok) throw new Error(`未成功读取 ${collection.name}，不生成更新请求`)
  const existing = audit[collection.name].result.indexes || []
  const missing = []
  for (const index of collection.indexes) {
    const keys = index.fields.map((field) => ({ Name: field.field, Direction: field.order === 'desc' ? '-1' : '1' }))
    const current = existing.find((row) => row.Name === index.name)
    if (current) {
      if (current.Unique !== index.unique || JSON.stringify(current.Keys) !== JSON.stringify(keys)) throw new Error(`${collection.name}.${index.name} 定义不一致，请人工核对；不会删除重建`)
    } else missing.push({ IndexName: index.name, MgoKeySchema: { MgoIndexKeys: keys, MgoIsUnique: index.unique } })
  }
  if (!missing.length) continue
  const file = path.resolve(output, `${collection.name}.json`)
  fs.writeFileSync(file, JSON.stringify({ CreateIndexes: missing }, null, 2) + '\n')
  manifest.push({ collection: collection.name, file, indexes: missing.map((row) => row.IndexName) })
}
fs.writeFileSync(path.resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest))
