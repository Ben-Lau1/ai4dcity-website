Page({
  onLoad() {
    const openViewer = () => {
      wx.redirectTo({
        url: '/native-v2/index/index',
        fail(error) {
          console.error('[Native v2 launcher] failed to open viewer', error);
        },
      });
    };

    if (typeof wx.loadSubpackage !== 'function') {
      openViewer();
      return;
    }

    wx.loadSubpackage({ name: 'native-viewer-v2' })
      .then(openViewer)
      .catch((error) => {
        console.error('[Native v2 launcher] failed to load subpackage', error);
      });
  },
});
