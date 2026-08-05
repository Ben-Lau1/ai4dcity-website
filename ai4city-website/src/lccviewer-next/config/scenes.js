export const SCENES = {
  'KPJ-08-4': {
    id: 'KPJ-08-4',
    label: '五园连通',
    description: '五园连通 4 场景',
    lcc2: '/lccviewer/data/KPJ-08-4/%E4%BA%94%E5%9B%AD%E8%BF%9E%E9%80%9A-4.lcc2',
    trajectory: '/lccviewer/data/path/KPJ-08-4_path.json',
  },
  'KPJ-05-2': {
    id: 'KPJ-05-2',
    label: '大学城',
    description: '大学城场景',
    lcc2: '/lccviewer/data/KPJ-05-2/KPJ-05-2.lcc2',
    trajectory: '/lccviewer/data/path/KPJ-05-2_path.json',
  },
}

export const DEFAULT_SCENE_ID = 'KPJ-08-4'

export function getInitialScene() {
  const id = new URL(window.location.href).searchParams.get('scene')
  return SCENES[id] || SCENES[DEFAULT_SCENE_ID]
}

