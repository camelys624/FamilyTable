'use strict'
const cloud = require('wx-server-sdk')
const { createPreferenceHandler } = require('./handler')
const { CloudBasePreferenceRepository } = require('./repository')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const handler = createPreferenceHandler(new CloudBasePreferenceRepository(cloud), console)
exports.main = async (event) => handler(event, { openid: cloud.getWXContext().OPENID || '' })
