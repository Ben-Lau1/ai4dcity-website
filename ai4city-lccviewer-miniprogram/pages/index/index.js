const app = getApp();

Page({
  data: {
    webviewUrl: '',
  },

  onLoad(options) {
    const url = options.url ? decodeURIComponent(options.url) : app.globalData.viewerUrl;
    this.setData({ webviewUrl: url });
  },

  handleLoad(event) {
    console.log('[LCCViewer web-view] loaded', event.detail);
  },

  handleError(event) {
    console.error('[LCCViewer web-view] failed', event.detail);
  },
});
