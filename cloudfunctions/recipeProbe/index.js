'use strict'

const cloud = require('wx-server-sdk')
const { BaseRepository } = require('./common')
const { createProbeHandler } = require('./handler')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const handler = createProbeHandler(new BaseRepository(cloud))

exports.main = async (event, context = {}) => {
  const wxContext = cloud.getWXContext()
  return handler(event, {
    openid: wxContext.OPENID || '',
    invocationId: context.request_id || '',
    environment: wxContext.ENV || '',
  })
}
