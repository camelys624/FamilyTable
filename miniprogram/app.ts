import { initializeCloudRuntime } from './config/runtime'
import { ensureSession } from './modules/session/index'

App({
  globalData: {
    startupError: '',
  },

  async onLaunch() {
    try {
      initializeCloudRuntime()
      await ensureSession()
    } catch (error) {
      const message = error instanceof Error ? error.message : '应用初始化失败'
      this.globalData.startupError = message
      console.error('[startup]', error)
    }
  },
})
