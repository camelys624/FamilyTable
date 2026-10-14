'use strict'

function fakeCloud() {
  const rows = new Map()
  const versions = new Map()
  const key = (name, id) => `${name}/${id}`
  const clone = (value) => structuredClone(value)
  let beforeTransaction = null
  let failWrite = null
  const all = (name) => [...rows].filter(([id]) => id.startsWith(`${name}/`)).map(([, doc]) => clone(doc))
  const seed = (name, id, doc) => {
    const k = key(name, id)
    rows.set(k, { ...clone(doc), _id: id })
    versions.set(k, (versions.get(k) || 0) + 1)
  }
  const doc = (name, id, state) => {
    const k = key(name, id)
    function read() {
      if (state && !state.reads.has(k)) state.reads.set(k, versions.get(k) || 0)
      return clone(state?.writes.has(k) ? state.writes.get(k) : rows.get(k) || null)
    }
    function write(data) {
      if (failWrite?.(name, id)) throw new Error('injected write failure')
      read()
      if (state) state.writes.set(k, { ...clone(data), _id: id })
      else seed(name, id, data)
    }
    return {
      async get() { return { data: read() } },
      async set({ data }) { write(data) },
      async update({ data }) {
        const current = read()
        if (!current) throw new Error('document not found')
        write({ ...current, ...data })
      },
    }
  }
  const query = (name, filter = {}, order = null, limit = 100) => {
    const matching = () => all(name).filter((row) => Object.entries(filter).every(([field, value]) => row[field] === value))
    return {
      where: (next) => query(name, next, order, limit),
      orderBy: (field, direction) => query(name, filter, [field, direction], limit),
      limit: (next) => query(name, filter, order, next),
      async count() { return { total: matching().length } },
      async get() {
        const result = matching()
        if (order) result.sort((a, b) => (a[order[0]] < b[order[0]] ? -1 : 1) * (order[1] === 'desc' ? -1 : 1))
        return { data: result.slice(0, limit) }
      },
      doc: (id) => doc(name, id),
    }
  }
  const db = {
    collection: (name) => query(name),
    async runTransaction(callback) {
      if (beforeTransaction) { const hook = beforeTransaction; beforeTransaction = null; await hook() }
      for (let attempt = 0; attempt < 40; attempt++) {
        const state = { reads: new Map(), writes: new Map() }
        const result = await callback({ collection: (name) => ({ doc: (id) => doc(name, id, state) }) })
        if ([...state.reads].some(([id, revision]) => (versions.get(id) || 0) !== revision)) continue
        for (const [id, value] of state.writes) {
          rows.set(id, clone(value))
          versions.set(id, (versions.get(id) || 0) + 1)
        }
        return result
      }
      throw new Error('transaction conflict retries exhausted')
    },
  }
  return {
    database: () => db, seed, all,
    beforeTransaction(hook) { beforeTransaction = hook },
    failWrite(hook) { failWrite = hook },
  }
}

module.exports = { fakeCloud }
