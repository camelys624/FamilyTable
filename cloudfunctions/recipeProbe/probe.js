'use strict'

const https = require('node:https')
const dns = require('node:dns').promises
const net = require('node:net')
const { createHash } = require('node:crypto')

const HOSTS = new Map([
  ...['xiachufang.com', 'www.xiachufang.com', 'm.xiachufang.com'].map((host) => [host, 'xiachufang']),
  ...['xiangha.com', 'www.xiangha.com', 'm.xiangha.com'].map((host) => [host, 'xiangha']),
  ...['xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com', 'www.xhslink.com'].map((host) => [host, 'xiaohongshu']),
])
const MAX_BYTES = 1024 * 1024
const MAX_REDIRECTS = 4
const TOTAL_TIMEOUT_MS = 20000
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const FAILURE_REASONS = new Set([
  'url_rejected', 'single_url_required', 'dns_rejected', 'response_too_large', 'unsupported_charset',
  'timeout', 'redirect_limit', 'invalid_redirect', 'redirect_rejected', 'network_error',
])
const captchaPattern = /humancheck|captcha|\/website-login\/captcha|安全验证|人机验证|访问过于频繁|异常流量/i
const nonPublic = new net.BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['192.88.99.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
]) nonPublic.addSubnet(address, prefix, 'ipv4')

const probeError = (reason) => Object.assign(new Error(reason), { reason })

function validateUrl(input, expectedPlatform) {
  let url
  try { url = new URL(input) } catch { throw probeError('url_rejected') }
  const platform = HOSTS.get(url.hostname)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !platform
    || (expectedPlatform && platform !== expectedPlatform)) throw probeError('url_rejected')
  url.hash = ''
  return { url, platform }
}

function extractUrl(shareText) {
  if (typeof shareText !== 'string' || shareText.length > 4096) throw probeError('url_rejected')
  const matches = shareText.match(/https?:\/\/[^\s<>"'，。；！）》】]+/gi) || []
  const urls = [...new Set(matches.map((value) => value.replace(/[.,;!?)\]]+$/, '')))]
  if (urls.length !== 1) throw probeError('single_url_required')
  return validateUrl(urls[0])
}

function isPublicIPv4(address) {
  return net.isIPv4(address) && !nonPublic.check(address, 'ipv4')
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(probeError('timeout'))
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function requestPage(url, { signal, lookup = dns.lookup, get = https.get } = {}) {
  // IPv4-only probe: validate every A record, then pin a vetted address to the TLS connection.
  const addresses = await abortable(lookup(url.hostname, { family: 4, all: true }), signal)
  if (!addresses.length || addresses.some(({ address }) => !isPublicIPv4(address))) throw probeError('dns_rejected')
  if (signal.aborted) throw probeError('timeout')
  return new Promise((resolve, reject) => {
    const req = get(url, {
      signal,
      family: 4,
      agent: false,
      lookup: (_host, _options, done) => done(null, addresses[0].address, 4),
      headers: {
        'User-Agent': 'FamilyTableRecipeProbe/0.1.0',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'identity',
      },
    }, (response) => {
      const status = response.statusCode
      const headers = response.headers
      if (REDIRECTS.has(status)) {
        response.destroy()
        resolve({ status, headers, body: '', bytes: 0 })
        return
      }
      let bytes = 0
      const chunks = []
      response.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > MAX_BYTES) {
          reject(probeError('response_too_large'))
          response.destroy()
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        const charset = headers['content-type']?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8'
        try { resolve({ status, headers, body: new TextDecoder(charset).decode(Buffer.concat(chunks)), bytes }) }
        catch { reject(probeError('unsupported_charset')) }
      })
      response.on('error', reject)
      response.on('aborted', () => reject(probeError('network_error')))
    })
    req.on('error', reject)
  })
}

function inspectPage(body, platform) {
  const title = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''
  const signals = {
    title: Boolean(title.trim()),
    jsonLdRecipe: /["']@type["']\s*:\s*(?:\[\s*)?["']Recipe["']/i.test(body),
    ingredients: /["']recipeIngredient["']\s*:|itemprop\s*=\s*["']recipeIngredient["']|class\s*=\s*["'][^"']*\bingredients\b/i.test(body),
    instructions: /["']recipeInstructions["']\s*:|itemprop\s*=\s*["']recipeInstructions["']|class\s*=\s*["'][^"']*\bsteps\b/i.test(body),
    initialState: /(?:window\.)?__INITIAL_STATE__\s*=/.test(body),
    noteTitle: /"title"\s*:\s*"(?:[^"\\]|\\.)+"/.test(body),
    noteDescription: /"desc"\s*:\s*"(?:[^"\\]|\\.)+"/.test(body),
  }
  const candidate = platform === 'xiaohongshu'
    ? signals.initialState && signals.noteTitle && signals.noteDescription
    : signals.title && signals.ingredients && signals.instructions
  const fingerprint = createHash('sha256').update(JSON.stringify(signals)).digest('hex').slice(0, 16)
  return { signals, fingerprint, candidate, captcha: captchaPattern.test(title) || /humancheck_captcha|访问过于频繁|异常流量/.test(body.slice(0, 20000)) }
}

async function probeShare(shareText, { request = requestPage, timeoutMs = TOTAL_TIMEOUT_MS, clock = Date.now } = {}) {
  const started = clock()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const result = { platform: '', outcome: '', hops: [], structure: null, elapsedMs: 0 }
  try {
    const initial = extractUrl(shareText)
    result.platform = initial.platform
    let url = initial.url
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      const hop = { url: `${url.origin}${url.pathname}`, status: null, bytes: 0 }
      result.hops.push(hop)
      if (captchaPattern.test(url.pathname)) { result.outcome = 'captcha'; break }
      const page = await abortable(request(url, { signal: controller.signal }), controller.signal)
      Object.assign(hop, { status: page.status, bytes: page.bytes })
      if (REDIRECTS.has(page.status)) {
        if (redirect === MAX_REDIRECTS) throw probeError('redirect_limit')
        if (!page.headers.location) throw probeError('invalid_redirect')
        try { url = validateUrl(new URL(page.headers.location, url).href, initial.platform).url }
        catch { throw probeError('redirect_rejected') }
        continue
      }
      const html = /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(page.headers['content-type'] || '')
      const identityEncoding = !page.headers['content-encoding'] || page.headers['content-encoding'] === 'identity'
      if (html && identityEncoding) result.structure = inspectPage(page.body, initial.platform)
      if (result.structure?.captcha) { result.outcome = 'captcha'; break }
      if (page.status === 403) { result.outcome = 'forbidden'; break }
      if (page.status === 401) { result.outcome = 'login_required'; break }
      if (page.status === 429) { result.outcome = 'rate_limited'; break }
      if (page.status < 200 || page.status >= 300) { result.outcome = 'http_error'; break }
      if (!html) {
        result.outcome = 'unsupported_content'; break
      }
      if (!identityEncoding) {
        result.outcome = 'unsupported_encoding'; break
      }
      result.outcome = result.structure.candidate ? 'structure_detected' : 'no_recipe_signals'
      break
    }
  } catch (error) {
    result.outcome = controller.signal.aborted ? 'timeout' : FAILURE_REASONS.has(error?.reason) ? error.reason : 'network_error'
  } finally {
    clearTimeout(timer)
    result.elapsedMs = clock() - started
  }
  return result
}

module.exports = { probeShare, requestPage, inspectPage, validateUrl, extractUrl, isPublicIPv4, MAX_BYTES, MAX_REDIRECTS }
