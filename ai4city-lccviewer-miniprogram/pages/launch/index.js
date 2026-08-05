const LOAD_TIMEOUT_MS = 45000;

Page({
  data: {
    errorDetail: '',
    hasError: false,
    progress: 0,
    statusText: '正在加载核心组件',
  },

  onLoad() {
    this.loadAttempt = 0;
    this.startLaunch();
  },

  onUnload() {
    this.clearLaunchTimer();
    this.loadAttempt += 1;
  },

  retryLaunch() {
    this.startLaunch();
  },

  clearLaunchTimer() {
    if (!this.launchTimer) return;
    clearTimeout(this.launchTimer);
    this.launchTimer = null;
  },

  startLaunch() {
    this.clearLaunchTimer();
    const attempt = this.loadAttempt + 1;
    this.loadAttempt = attempt;
    this.setData({
      errorDetail: '',
      hasError: false,
      progress: 0,
      statusText: '正在加载核心组件',
    });

    if (typeof wx.loadSubpackage !== 'function') {
      this.openViewer(attempt);
      return;
    }

    let settled = false;
    const succeed = () => {
      if (settled || attempt !== this.loadAttempt) return;
      settled = true;
      this.openViewer(attempt);
    };
    const fail = (error) => {
      if (settled || attempt !== this.loadAttempt) return;
      settled = true;
      console.error('[Native v2 launcher] failed to load subpackage', error);
      this.showLaunchError('核心组件加载失败，请检查网络后重试');
    };

    try {
      const task = wx.loadSubpackage({
        name: 'native-viewer-v2',
        success: succeed,
        fail,
      });
      if (task && typeof task.onProgressUpdate === 'function') {
        task.onProgressUpdate((state) => {
          if (settled || attempt !== this.loadAttempt) return;
          const progress = Math.max(0, Math.min(100, Number(state.progress) || 0));
          this.setData({ progress });
        });
      }
    } catch (error) {
      fail(error);
      return;
    }

    this.launchTimer = setTimeout(() => {
      if (settled || attempt !== this.loadAttempt) return;
      settled = true;
      this.showLaunchError('加载时间较长，请检查网络后重试');
    }, LOAD_TIMEOUT_MS);
  },

  openViewer(attempt) {
    if (attempt !== this.loadAttempt) return;
    this.clearLaunchTimer();
    this.setData({
      progress: 100,
      statusText: '正在进入场景',
    });
    wx.redirectTo({
      url: '/native-v2/index/index',
      fail: (error) => {
        if (attempt !== this.loadAttempt) return;
        console.error('[Native v2 launcher] failed to open viewer', error);
        this.showLaunchError('场景页面打开失败，请重试');
      },
    });
  },

  showLaunchError(message) {
    this.clearLaunchTimer();
    this.setData({
      errorDetail: message,
      hasError: true,
      statusText: '',
    });
  },
});
