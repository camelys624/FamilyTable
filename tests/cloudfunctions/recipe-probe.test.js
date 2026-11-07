'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { createProbeHandler } = require('../../cloudfunctions/recipeProbe/handler')
const {
  probeShare, requestPage, validateUrl, extractUrl, isPublicIPv4, MAX_BYTES, MAX_REDIRECTS,
} = require('../../cloudfunctions/recipeProbe/probe')

// Synthetic pages only. None of these URLs is requested over the network.
const html = '<title>测试菜谱</title><div class="ingredients">鸡蛋</div><div class="steps">炒熟</div>'
const page = (body = html, status = 200, headers = {}) => ({
  status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, body, bytes: Buffer.byteLength(body),
})
const input = () => ({ action: 'probe.fetch', requestId: 'probe_test_001', payload: { sampleId: 'xcf-long-01', shareText: 'https://www.xiachufang.com/recipe/123/' } })
const identity = { openid: 'trusted-openid', environment: 'dev-env', invocationId: 'cloud-invocation' }
const enabled = { RECIPE_PROBE_ENABLED: 'true' }
const owner = { async context(openid) { assert.equal(openid, identity.openid); return { member: { role: 'owner' } } } }
const fakeProbe = async () => ({ outcome: 'structure_detected', hops: [] })

function fakeHttp(responsePage, inspect = () => {}) {
  return (_url, options, callback) => {
    inspect(options)
    const req = new EventEmitter()
    queueMicrotask(() => {
      const response = new PassThrough()
      response.statusCode = responsePage.status
      response.headers = responsePage.headers
      callback(response)
      if (!response.destroyed) response.end(responsePage.body)
    })
    return req
  }
}

test('extracts one share URL without losing signed query, and rejects multiple pages', () => {
  assert.equal(extractUrl('菜谱 https://xhslink.com/a/test?xsec_token=secret 复制打开').url.search, '?xsec_token=secret')
  assert.equal(extractUrl('【分享】https://m.xiangha.com/caipu/123.html。').platform, 'xiangha')
  for (const value of ['没有链接', 'https://xhslink.com/a https://www.xiangha.com/caipu/1.html', 'x'.repeat(4097)]) {
    assert.throws(() => extractUrl(value))
  }
})

test('exact host, HTTPS, credentials, port and same-platform redirect constraints', () => {
  for (const value of [
    'http://www.xiachufang.com/recipe/1/', 'https://www.xiachufang.com.evil.example/recipe/1/',
    'https://evil.example@www.xiachufang.com/recipe/1/', 'https://www.xiachufang.com:444/',
    'https://127.0.0.1/', 'https://[::1]/', 'https://xiachufang.com./recipe/1/',
  ]) assert.throws(() => validateUrl(value), { reason: 'url_rejected' })
  assert.throws(() => validateUrl('https://www.xiangha.com/caipu/1.html', 'xiachufang'))
  assert.equal(validateUrl('https://www.xiachufang.com:443/recipe/1/#x').url.hash, '')
})

test('rejects non-public IPv4 ranges and IPv6 for this IPv4-only probe', () => {
  for (const address of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '::ffff:127.0.0.1']) {
    assert.equal(Boolean(isPublicIPv4(address)), false, address)
  }
  assert.equal(isPublicIPv4('1.1.1.1'), true)
})

test('pins vetted DNS address while retaining TLS hostname, and sends no credentials or cookies', async () => {
  const signal = new AbortController().signal
  const result = await requestPage(new URL('https://www.xiachufang.com/recipe/1/'), {
    signal,
    lookup: async (host, options) => {
      assert.equal(host, 'www.xiachufang.com')
      assert.deepEqual(options, { family: 4, all: true })
      return [{ address: '1.1.1.1', family: 4 }]
    },
    get: fakeHttp(page(), (options) => {
      assert.equal(options.agent, false)
      assert.equal(options.headers.Cookie, undefined)
      assert.equal(options.headers.Authorization, undefined)
      assert.equal(options.headers['Accept-Encoding'], 'identity')
      assert.equal(options.rejectUnauthorized, undefined)
      options.lookup('www.xiachufang.com', {}, (error, address, family) => {
        assert.equal(error, null)
        assert.equal(address, '1.1.1.1')
        assert.equal(family, 4)
      })
    }),
  })
  assert.equal(result.body, html)
})

test('rejects mixed public/private DNS answers before connecting', async () => {
  for (const addresses of [[], [{ address: '1.1.1.1' }, { address: '127.0.0.1' }]]) {
    await assert.rejects(requestPage(new URL('https://xhslink.com/a'), {
      signal: new AbortController().signal,
      lookup: async () => addresses,
      get: () => { assert.fail('must not connect') },
    }), { reason: 'dns_rejected' })
  }
})

test('limits response bytes and handles stream truncation safely', async () => {
  await assert.rejects(requestPage(new URL('https://www.xiangha.com/caipu/1.html'), {
    signal: new AbortController().signal,
    lookup: async () => [{ address: '1.1.1.1' }],
    get: fakeHttp(page('x'.repeat(MAX_BYTES + 1))),
  }), { reason: 'response_too_large' })
  await assert.rejects(requestPage(new URL('https://xhslink.com/a'), {
    signal: new AbortController().signal,
    lookup: async () => [{ address: '1.1.1.1' }],
    get: (_url, _options, callback) => {
      const req = new EventEmitter()
      queueMicrotask(() => {
        const response = new PassThrough()
        response.statusCode = 200
        response.headers = {}
        callback(response)
        response.emit('aborted')
        response.destroy()
      })
      return req
    },
  }), { reason: 'network_error' })
})

test('unfolds only same-platform redirects, redacts query and never requests page assets', async () => {
  const calls = []
  const result = await probeShare('分享 https://xhslink.com/a?secret=token', { request: async (url) => {
    calls.push(url.href)
    return calls.length === 1
      ? page('', 302, { location: 'https://www.xiaohongshu.com/explore/example?xsec_token=private', 'set-cookie': 'session=private' })
      : page('<title>笔记</title><script>window.__INITIAL_STATE__={"title":"炒蛋","desc":"鸡蛋炒熟"}</script>')
  } })
  assert.equal(calls.length, 2)
  assert.match(calls[1], /xsec_token=private/)
  assert.equal(result.outcome, 'structure_detected')
  assert.equal(result.platform, 'xiaohongshu')
  assert.equal(result.hops[0].status, 302)
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(JSON.stringify(result).includes('炒蛋'), false)
})

test('rejects unsafe redirects without making a second request', async () => {
  for (const location of ['https://evil.example/', 'http://www.xiachufang.com/', 'https://127.0.0.1/', 'https://www.xiangha.com/', 'https://user:pass@www.xiachufang.com/', 'https://www.xiachufang.com:8443/']) {
    let calls = 0
    const result = await probeShare(input().payload.shareText, { request: async () => { calls++; return page('', 302, { location }) } })
    assert.equal(result.outcome, 'redirect_rejected', location)
    assert.equal(calls, 1)
  }
})

test('stops at captcha redirects and records status without trying to solve the challenge', async () => {
  let calls = 0
  const result = await probeShare(input().payload.shareText, { request: async () => {
    calls++
    return page('', 302, { location: '/humancheck_captcha?token=private' })
  } })
  assert.equal(calls, 1)
  assert.equal(result.outcome, 'captcha')
  assert.equal(result.hops[1].status, null)
  assert.equal(result.hops[0].status, 302)
  assert.equal(JSON.stringify(result).includes('token'), false)
})

test('distinguishes HTTP restrictions, captcha, missing structure and diagnostic limits', async () => {
  for (const [response, outcome] of [
    [page('<title>安全验证</title>', 403), 'captcha'], [page('', 403), 'forbidden'],
    [page('', 401), 'login_required'], [page('', 429), 'rate_limited'], [page('', 500), 'http_error'],
    [page('<title>首页</title>'), 'no_recipe_signals'],
    [page('{}', 200, { 'content-type': 'application/json' }), 'unsupported_content'],
    [page('compressed', 200, { 'content-encoding': 'gzip' }), 'unsupported_encoding'],
  ]) {
    const result = await probeShare(input().payload.shareText, { request: async () => response })
    assert.equal(result.outcome, outcome)
    assert.equal(result.hops[0].status, response.status)
  }
})

test('stops redirect loops, enforces total deadline, and does not leak upstream errors', async () => {
  let calls = 0
  const loop = await probeShare(input().payload.shareText, { request: async () => { calls++; return page('', 302, { location: '/loop' }) } })
  assert.equal(loop.outcome, 'redirect_limit')
  assert.equal(calls, MAX_REDIRECTS + 1)
  const timed = await probeShare(input().payload.shareText, { timeoutMs: 10, request: async () => new Promise(() => {}) })
  assert.equal(timed.outcome, 'timeout')
  const dnsTimed = await probeShare(input().payload.shareText, { timeoutMs: 10, request: (url, options) => requestPage(url, {
    ...options, lookup: async () => new Promise(() => {}), get: () => assert.fail('no connection'),
  }) })
  assert.equal(dnsTimed.outcome, 'timeout')
  const failed = await probeShare(input().payload.shareText, { request: async () => { throw Object.assign(new Error('secret page token'), { reason: 'secret upstream detail' }) } })
  assert.equal(failed.outcome, 'network_error')
  assert.equal(JSON.stringify(failed).includes('secret'), false)
})

test('fingerprints describe signal presence only and never return source text', async () => {
  const result = await probeShare(input().payload.shareText, { request: async () => page() })
  const other = await probeShare(input().payload.shareText, { request: async () => page(html.replace('测试菜谱', '另一道菜')) })
  assert.equal(result.outcome, 'structure_detected')
  assert.equal(result.structure.fingerprint, other.structure.fingerprint)
  assert.equal(JSON.stringify(result).includes('鸡蛋'), false)
  assert.equal(result.body, undefined)
})

test('disabled diagnostic, anonymous console call and non-owner never fetch', async () => {
  let calls = 0
  const probe = async () => { calls++; return {} }
  assert.equal((await createProbeHandler(owner, { env: {}, probe })(input(), identity)).error.code, 'FEATURE_UNAVAILABLE')
  assert.equal((await createProbeHandler(owner, { env: enabled, probe })(input(), {})).error.code, 'UNAUTHENTICATED')
  const member = { async context() { return { member: { role: 'member' } } } }
  assert.equal((await createProbeHandler(member, { env: enabled, probe })(input(), identity)).error.code, 'FORBIDDEN')
  assert.equal(calls, 0)
})

test('uses trusted identity, rejects forged payloads, retains cloud evidence and throttles per instance', async () => {
  const handler = createProbeHandler(owner, { env: enabled, probe: fakeProbe, clock: () => 100000 })
  const forged = input()
  forged.payload.openid = 'forged'
  assert.equal((await handler(forged, identity)).error.code, 'VALIDATION_ERROR')
  for (let count = 0; count < 5; count++) {
    const result = await handler(input(), identity)
    assert.equal(result.ok, true)
    assert.equal(result.data.environment, 'dev-env')
    assert.equal(result.data.invocationId, 'cloud-invocation')
    assert.equal(result.data.sampleId, 'xcf-long-01')
  }
  assert.equal((await handler(input(), identity)).error.code, 'RATE_LIMITED')
})

test('checks membership each call and sanitizes database failures', async () => {
  let calls = 0
  const handler = createProbeHandler({ async context() {
    calls++
    if (calls > 1) throw Object.assign(new Error('成员已失效'), { code: 'NOT_FAMILY_MEMBER' })
    return { member: { role: 'owner' } }
  } }, { env: enabled, probe: fakeProbe })
  assert.equal((await handler(input(), identity)).ok, true)
  assert.equal((await handler(input(), identity)).error.code, 'NOT_FAMILY_MEMBER')
  const failure = await createProbeHandler({ async context() { throw new Error('secret database details') } }, { env: enabled })(input(), identity)
  assert.equal(failure.error.code, 'INTERNAL_ERROR')
  assert.equal(JSON.stringify(failure).includes('secret'), false)
})
