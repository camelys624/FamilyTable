'use strict'
const cloud = require('wx-server-sdk')
const { guardRepository } = require('./content-safety')
const { createShoppingHandler } = require('./handler')
const { CloudBaseShoppingRepository } = require('./repository')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const handler = createShoppingHandler(guardRepository(new CloudBaseShoppingRepository(cloud), cloud, {"addItem":{"fields":["name"]}}), console)
exports.main = async (event) => handler(event, { openid: cloud.getWXContext().OPENID || '' })
