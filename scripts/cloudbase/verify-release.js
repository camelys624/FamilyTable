'use strict'

// Offline code checks are distinct from the operator's verified console evidence.
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const json = (file) => JSON.parse(read(file).replace(/^\uFEFF/, ''))
const errors = []
const requireCondition = (condition, message) => { if (!condition) errors.push(message) }
const testMode = process.argv.includes('--development') || process.argv.includes('--test')
const functions = ['auth', 'family', 'recipe', 'menu', 'vote', 'shopping', 'preference', 'fridge']
const { activeStage, environmentProfiles } = require(path.join(root, 'miniprogram/config/environments.js'))
const { legalConfig } = require(path.join(root, 'miniprogram/config/legal.js'))
const project = json('project.config.json')
const indexes = json('cloudbase/indexes.json')
requireCondition(project.appid && project.appid !== 'touristappid', '必须配置真实小程序 AppID')
requireCondition(legalConfig.operator && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(legalConfig.contactEmail), '运营者及联系邮箱不完整')
requireCondition(read('cloudfunctions/auth/handler.js').includes(legalConfig.version), '客户端与云端协议版本不一致')
requireCondition(environmentProfiles[activeStage]?.repositoryMode === 'cloud', '发布或测试验收必须连接云端')
requireCondition(read('miniprogram/config/environments.ts').includes(`activeStage: RuntimeStage = '${activeStage}'`), '环境 TS 与 JS 未同步')
for (const name of functions) {
  for (const file of ['index.js', 'handler.js', 'repository.js', 'package.json']) requireCondition(fs.existsSync(path.join(root, 'cloudfunctions', name, file)), `云函数 ${name} 缺少 ${file}`)
}
for (const file of ['miniprogram/pages/home/index.ts', 'miniprogram/pages/vote/index.ts', 'miniprogram/pages/shopping/index.ts', 'miniprogram/pages/profile/index.ts']) {
  requireCondition(!/\b(getState|castVote|generateShoppingList|updatePreferences)\b/.test(read(file)), `${file} 仍依赖本地业务数据`)
}
for (const src of ['assets/fridge/illustrations-v2.png', 'assets/kitchen/illustrations-v2.png']) requireCondition(project.packOptions.include.some((rule) => rule.type === 'file' && rule.value === src), `${src} 必须强制纳入手机包`)
requireCondition(indexes.collections.length === 14, '请重新核对集合与索引清单')
requireCondition(json('miniprogram/app.json').pages.includes('pages/legal/index'), '隐私与协议页面未注册')

if (!testMode) {
  requireCondition(activeStage === 'prod', '尚未切换到生产 profile')
  const env = environmentProfiles.prod.cloudEnvId
  requireCondition(env && !env.startsWith('__') && env !== 'prod1', '生产云环境尚未配置')
  requireCondition(env !== environmentProfiles.test.cloudEnvId && env !== environmentProfiles.dev.cloudEnvId, '生产环境不能复用当前开发或测试环境')
  const flagIndex = process.argv.indexOf('--evidence')
  const file = flagIndex >= 0 ? process.argv[flagIndex + 1] : ''
  if (!file || !fs.existsSync(path.resolve(file))) errors.push('缺少生产验收记录，请按 cloudbase/release-evidence.example.json 提供 --evidence 文件')
  else {
    const evidence = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, ''))
    requireCondition(evidence.appid === project.appid && evidence.env === env, '验收记录与发布环境不一致')
    requireCondition(evidence.verifiedBy && Number.isFinite(Date.parse(evidence.verifiedAt)), '请记录实际验收人和时间')
    for (const field of ['cloudFunctionsDeployed', 'indexesVerified', 'databaseServerOnly', 'storageRulesVerified', 'privacyDeclarationVerified', 'contentSafetyVerified', 'backupRestoreVerified', 'iosPreviewVerified', 'androidPreviewVerified', 'twoAccountFlowVerified']) requireCondition(evidence[field] === true, `尚未验收：${field}`)
    requireCondition(Number.isInteger(evidence.mainPackageBytes) && evidence.mainPackageBytes > 0 && evidence.mainPackageBytes < 2 * 1024 * 1024, '缺少低于 2 MiB 的实际主包结果')
  }
}
if (errors.length) { errors.forEach((error) => console.error(`BLOCKED: ${error}`)); process.exitCode = 1 }
else console.log(testMode ? `development_code_checks=ok stage=${activeStage} (不是生产验收通过)` : 'release_checks=ok stage=prod')
