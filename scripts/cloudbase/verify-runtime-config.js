'use strict'

const fs = require('fs')
const path = require('path')

const runtimeSource = fs.readFileSync(path.resolve(__dirname, '../../miniprogram/config/runtime.ts'), 'utf8')
const environmentsSource = fs.readFileSync(path.resolve(__dirname, '../../miniprogram/config/environments.ts'), 'utf8')

for (const stage of ['dev', 'test', 'prod']) {
  if (!new RegExp(`\\b${stage}:\\s*\\{`).test(environmentsSource)) throw new Error(`缺少 ${stage} profile`)
}
if (!/activeStage:\s*RuntimeStage\s*=\s*'dev'/.test(environmentsSource)) {
  console.log('runtime_profile=non-dev（发布前请确认 activeStage）')
}
if (!runtimeSource.includes("appId === 'touristappid'")) throw new Error('缺少 touristappid 防误连保护')
if (!runtimeSource.includes("startsWith('__')")) throw new Error('缺少环境 ID 占位符保护')

console.log('runtime_config=ok profiles=dev,test,prod')
