'use strict'
const cloud = require('wx-server-sdk')
const { guardRepository } = require('./content-safety')
const { createVoteHandler } = require('./handler')
const { CloudBaseVoteRepository } = require('./repository')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const handler = createVoteHandler(guardRepository(new CloudBaseVoteRepository(cloud), cloud, {"createPoll":{"fields":["title"]}}), console)
exports.main = async (event) => handler(event, { openid: cloud.getWXContext().OPENID || '' })
