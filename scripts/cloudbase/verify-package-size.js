'use strict'

// Read actual WeChat DevTools preview/upload output, not filesystem estimates.
const fs = require('node:fs')
const limit = 2 * 1024 * 1024
const headroom = 64 * 1024
const budget = limit - headroom

try {
  const file = process.argv[2]
  if (!file) throw new Error('用法：node scripts/cloudbase/verify-package-size.js <开发者工具 info-output.json>')
  const report = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  const packages = (report.size?.packages || []).filter((item) => item.name !== 'TOTAL')
  if (!packages.length) packages.push({ name: 'main', size: report.size?.total })
  for (const item of packages) {
    if (!Number.isSafeInteger(item.size) || item.size <= 0) throw new Error('打包结果缺少有效的包体积，请使用开发者工具实际生成的 info-output 文件')
    if (item.size > budget) throw new Error(`${item.name} 包体积 ${item.size} 字节，超过安全预算 ${budget} 字节；需为 2 MiB 上限保留至少 64 KiB 余量`)
    console.log(`package_size=ok name=${item.name} bytes=${item.size} remaining=${limit - item.size}`)
  }
} catch (error) {
  console.error(`BLOCKED: ${error.message}`)
  process.exitCode = 1
}
