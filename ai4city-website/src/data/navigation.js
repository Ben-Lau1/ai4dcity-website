export const NAV_LINKS = [
  { id: 'home', label: 'News & Events' },
  { id: 'team', label: 'People' },
  { id: 'research', label: 'Research' },
  { id: 'publication', label: 'Publication' },
  {
    id: 'resources',
    label: 'Data & Resources',
    children: [
      { id: 'resources', label: 'All Resources' },
      { id: 'demo', label: 'Demo' },
    ],
  },
  { id: 'about', label: 'About Us' },
];

export const LOGO_CONFIG = {
  labLogo: '/images/frontPage/logo.png', 
  universityLogo: '/images/frontPage/logo-e-black-2x.png',
  universityLink: 'https://www.hkust-gz.edu.cn/zh/?variant=zh-cn/'
};
