import './styles.css'
import { THREE } from './render/SceneRuntime.js'
import { ViewerApp } from './ViewerApp.js'

window.THREE = THREE
window.LCCRender = window.LCC?.LCCRender

const app = new ViewerApp()
window.lccViewer = app
app.start().catch((error) => {
  console.error('[LCCViewer] 启动失败', error)
  app.ui.showError(error)
})

