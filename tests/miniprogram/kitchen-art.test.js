'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { kitchenArt } = require('../../miniprogram/utils/kitchen-art')
const fs = require('node:fs')
const path = require('node:path')

test('pages with kitchen artwork declare a resolvable dependency for lazy component loading', () => {
  const root = path.resolve(__dirname, '../../miniprogram')
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.equal(app.lazyCodeLoading, 'requiredComponents')
  let consumers = 0
  for (const route of app.pages) {
    const template = fs.readFileSync(path.join(root, `${route}.wxml`), 'utf8')
    if (!/<kitchen-art\b/.test(template)) continue
    consumers++
    const config = JSON.parse(fs.readFileSync(path.join(root, `${route}.json`), 'utf8'))
    const component = config.usingComponents?.['kitchen-art']
    assert.ok(component, `${route} must declare its lazy-loaded artwork component`)
    const base = component.startsWith('/') ? path.join(root, component.slice(1)) : path.resolve(root, path.dirname(route), component)
    for (const ext of ['.js', '.json', '.wxml', '.wxss']) assert.ok(fs.existsSync(base + ext), `${route}: missing ${base + ext}`)
    assert.equal(JSON.parse(fs.readFileSync(base + '.json', 'utf8')).component, true)
  }
  assert.ok(consumers > 0)
})

test('known ingredients reuse the correct fridge cells; unknown names stay neutral', () => {
  assert.deepEqual(kitchenArt(' 鸡蛋 '), { src: '/assets/fridge/illustrations-v2.png', style: 'width:300%;height:200%;left:-100%;top:-100%;' })
  assert.equal(kitchenArt('番茄炒蛋').style, 'width:400%;height:300%;left:-200%;top:-100%;')
  assert.equal(kitchenArt('清蒸鲈鱼').style, 'width:400%;height:300%;left:-300%;top:-100%;')
  assert.equal(kitchenArt('牛肉').style, kitchenArt().style)
  assert.deepEqual(kitchenArt('', 'not-a-cell'), kitchenArt())
})

test('dynamic artwork is included in the phone package as decodable PNG files', () => {
  const root = path.resolve(__dirname, '../../miniprogram')
  const config = JSON.parse(fs.readFileSync(path.join(root, '../project.config.json'), 'utf8'))
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const sources = new Set([kitchenArt().src, kitchenArt('鸡蛋').src])
  for (const src of sources) {
    const relative = src.slice(1)
    assert.ok(config.packOptions.include.some((rule) => rule.type === 'file' && rule.value === relative), `${relative} can be pruned from the phone preview`)
    const file = fs.readFileSync(path.join(root, relative))
    assert.ok(file.subarray(0, 8).equals(pngSignature), `${relative} must be a real PNG, not a renamed WebP`)
    assert.equal(file[25], 6, 'sprite sheets must retain RGBA transparency')
  }
  const fridge = fs.readFileSync(path.join(root, 'pages/fridge/index.wxml'), 'utf8')
  const imageSources = [...fridge.matchAll(/<image\b[^>]*src="([^"]+)"/g)].map((match) => match[1])
  assert.ok(imageSources.length > 0)
  assert.ok(imageSources.every((src) => sources.has(src)), 'the fridge must use the same packaged PNG sheet')
})
