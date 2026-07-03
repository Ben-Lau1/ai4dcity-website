import React, { useMemo } from 'react';
import { Layers3 } from 'lucide-react';
import { FadeInSection } from './FadeInSection';

const SAT2CITY_V2 = {
  id: 'sat2city-v2',
  title: 'Sat2City v2: Native 3D City Asset Generation from a Single Satellite Image',
  displayTitle: 'Sat2City v2',
  desc: 'Generates explicit city-scale geometry and satellite-consistent textured mesh assets from a single satellite image.',
  topic: 'AI based 3D City Modeling',
  year: '2026',
  date: 'Pre-print, 2026. arXiv:2606.24138',
  link: 'https://arxiv.org/abs/2606.24138',
  projectLink: 'https://ai4city-hkust.github.io/Sat2City-v2/',
  mediaContent: '/images/research/project-pages/sat2city-v2.png',
};

const PROJECT_PREVIEWS = {
  'sat2city-v2': [
    '/images/research/project-pages/sat2city-v2.png',
  ],
  'geoidentity-sat2street': [
    '/images/research/GeoIdentity-Sat2Street.jpg',
  ],
  2026001: [
    '/images/research/tedm-causal-interactions.png',
    '/images/research/project-pages/tedm.png',
  ],
  2026003: [
    '/images/research/unid-shift-workflow.png',
    '/images/research/project-pages/unid-shift.png',
  ],
  2026004: [
    '/images/research/BAP.png',
    '/images/research/project-pages/buildanypoint.png',
  ],
  1774775739519: [
    '/images/publication/DSTI.png',
  ],
  1774848031951: [
    '/images/publication/SKYEVEN.png',
  ],
  holo360d: [
    '/images/research/holo360d-cover.jpg',
  ],
  skylume: [
    '/images/research/skylume-teaser.jpg',
    '/images/research/skylume-pipeline.jpg',
  ],
  1774779504458: [
    '/images/publication/微信图片_2026-03-29_181922_037.png',
    '/images/resource/BuildMulview.png',
  ],
  33: [
    '/images/research/gdverse.png',
    '/images/resource/gdverse.png',
  ],
  4: [
    '/images/research/USLR-GS/1-s2.0-S092427162500396X-gr19.jpg',
    '/images/research/project-pages/ulsr-gs.png',
  ],
  3: [
    '/images/research/s2c2.png',
    '/images/research/project-pages/sat2city.png',
  ],
  1: [
    '/images/publication/BV.png',
    '/images/resource/Buildingview.png',
  ],
};

const RESEARCH_INCLUDE_IDS = new Set([
  'sat2city-v2',
  'geoidentity-sat2street',
  '2026001',
  '2026003',
  '2026004',
  '1774775739519',
  '1774848031951',
  'holo360d',
  'skylume',
  '1774779504458',
  '33',
  '4',
  '3',
  '1',
]);

const RESEARCH_MAP = [
  {
    id: 'ai-3d-city',
    topic: 'AI based 3D City Modeling',
    summary: 'Generative and reconstructive AI for city-scale 3D assets.',
    keywords: ['Satellite-to-3D', '3D Gaussian', 'Point clouds', 'Reconstruction'],
    frameworkModules: [
      {
        position: 'top-left',
        label: 'Generation',
        title: 'Satellite-to-3D Generation',
        desc: 'Native city-scale 3D assets from satellite observations.',
        projects: [
          { id: 'sat2city-v2', displayTier: 'medium', priority: 'core' },
          { id: '3', displayTier: 'compact', priority: 'core' },
        ],
      },
      {
        position: 'top-right',
        label: 'Generation',
        title: 'Point Cloud / Structured Generation',
        desc: 'Structured 3D building abstraction from diverse point clouds.',
        projects: [{ id: '2026004', displayTier: 'medium', priority: 'core' }],
      },
      {
        position: 'bottom-left',
        label: 'Reconstruction',
        title: 'Large-scale Scene 3D Reconstruction',
        desc: 'Large-scale reconstruction methods and datasets across aerial, UAV, and terrestrial capture settings.',
        subgroups: [
          {
            title: 'Aerial-view 3D Reconstruction',
            desc: 'Aerial Gaussian reconstruction and UAV datasets for robust city-scale reconstruction.',
            projects: [
              { id: '4', displayTier: 'compact', priority: 'core' },
              { id: '1774848031951', displayTier: 'compact', priority: 'secondary' },
              { id: 'skylume', displayTier: 'compact', priority: 'secondary' },
            ],
          },
          {
            title: '360 / Terrestrial 3D Reconstruction',
            desc: 'Panoramic and ground-view datasets for continuous trajectory 3D reconstruction.',
            projects: [
              { id: 'holo360d', displayTier: 'medium', priority: 'secondary' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'spatiotemporal-fusion',
    topic: 'Spatio-temporal (4D) Data Fusion',
    summary: 'Learning representations and semantics across point clouds, images, time, and urban observations.',
    keywords: ['Point clouds', 'Multimodal fusion', 'Building attributes', 'Spatial causality'],
    frameworkModules: [
      {
        position: 'top-left',
        label: 'Representation',
        title: 'Point Cloud Semantic Segmentation / Fusion',
        desc: 'Point-cloud and multimodal semantic understanding through shared-private representation learning.',
        projects: [{ id: '2026003', displayTier: 'medium', priority: 'core' }],
      },
      {
        position: 'top-right',
        label: 'Semantics',
        title: 'Building / Asset Understanding',
        desc: 'Building-level attributes, semantic enrichment, and exterior database construction.',
        projects: [
          { id: '1774779504458', displayTier: 'medium', priority: 'core' },
          { id: '1', displayTier: 'compact', priority: 'secondary' },
        ],
      },
      {
        position: 'bottom-left',
        label: 'Reasoning',
        title: 'Spatial Causality & Statistical Modeling',
        desc: 'Open-source tools for causality, heterogeneity, and spatiotemporal inference.',
        projects: [
          { id: '2026001', displayTier: 'compact', priority: 'secondary' },
          { id: '33', displayTier: 'compact', priority: 'secondary' },
        ],
      },
      {
        position: 'bottom-right',
        label: 'Reasoning',
        title: 'GeoAI Reasoning / Benchmark',
        desc: 'Reserved for confirmed project pages on GeoAI reasoning and benchmarks.',
        projects: [],
      },
    ],
  },
  {
    id: 'urban-env',
    topic: 'Urban Env-Understanding',
    summary: 'Interpreting urban environments, changes, and applications from multimodal observations.',
    keywords: ['Street view', 'Change detection', 'Cross-view', 'Urban applications'],
    frameworkModules: [
      {
        position: 'top-left',
        label: 'Perception',
        title: 'Cross-view Urban Observation',
        desc: 'Linking human-centric urban observations across satellite and street views.',
        projects: [{ id: 'geoidentity-sat2street', displayTier: 'medium', priority: 'core' }],
      },
      {
        position: 'top-right',
        label: 'Application',
        title: 'Change Detection & Monitoring',
        desc: 'Task-driven dynamic scene monitoring and change detection from multimodal observations.',
        projects: [{ id: '1774775739519', displayTier: 'medium', priority: 'core' }],
      },
      {
        position: 'bottom-left',
        label: 'Application',
        title: 'Urban Resilience / Disaster Applications',
        desc: 'Reserved for confirmed project pages on urban resilience and disaster applications.',
        projects: [],
      },
      {
        position: 'bottom-right',
        label: 'Application',
        title: 'Cultural Heritage / Domain Applications',
        desc: 'Reserved for confirmed project pages on cultural heritage and domain applications.',
        projects: [],
      },
    ],
  },
];

const PROJECT_DISPLAY_TITLES = {
  'sat2city-v2': 'Sat2City v2',
  'geoidentity-sat2street': 'GeoIdentity-Sat2Street',
  2026001: 'tEDM',
  2026003: 'UniD-Shift',
  2026004: 'BuildAnyPoint',
  1774775739519: 'DSTI-Net',
  1774848031951: 'SkyEvents',
  holo360d: 'Holo360D',
  skylume: 'SkyLume',
  1774779504458: 'BuildingMultiView',
  33: 'gdverse',
  4: 'ULSR-GS',
  3: 'Sat2City',
  1: 'BuildingView',
};

const PROJECT_VENUE_LABELS = {
  'sat2city-v2': 'Preprint 2026',
  'geoidentity-sat2street': 'ISPRS J 2026',
  2026001: 'CEUS 2026',
  2026003: 'CVPR Findings 2026',
  2026004: 'CVPR 2026',
  1774775739519: 'TGRS 2026',
  1774848031951: 'ICLR 2026',
  holo360d: 'ECCV 2026',
  skylume: 'ECCV 2026',
  1774779504458: 'JAG 2026',
  33: 'TGIS 2025',
  4: 'ISPRS J 2025',
  3: 'ICCV 2025',
  1: 'SpatialDI 2025',
};

const TIER_CLASS = {
  hero: 'md:col-span-2',
  wide: 'md:col-span-2',
  medium: 'md:col-span-1',
  compact: 'md:col-span-1',
};

const TIER_IMAGE_CLASS = {
  hero: 'h-52 md:h-60',
  wide: 'h-44 md:h-48',
  medium: 'h-40 md:h-44',
  compact: 'h-40 md:h-44',
};

const isRepositoryLink = (url = '') => /github\.com/i.test(url);

const isPaperLink = (url = '') =>
  /(doi\.org|arxiv\.org|sciencedirect\.com|ieee\.org|springer\.com|tandfonline\.com)/i.test(url);

const getProjectActionLabel = (url) => (isRepositoryLink(url) ? 'Repository' : 'Project Page');

const normalizeProject = (item) => ({
  ...item,
  id: String(item.id),
  displayTitle: PROJECT_DISPLAY_TITLES[item.id] || item.displayTitle || item.title,
  venueLabel: PROJECT_VENUE_LABELS[item.id] || item.venueLabel || item.year,
  previewImages: PROJECT_PREVIEWS[item.id] || (item.mediaContent ? [item.mediaContent] : []),
  mediaContent: PROJECT_PREVIEWS[item.id]?.[0] || item.mediaContent || null,
});

const LinkIcon = ({ type }) => {
  if (type === 'wechat') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
        <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c-.303-.474-.474-.997-.474-1.542 0-3.154 3.136-5.711 7.004-5.711.05 0 .1.003.149.003C14.923 6.195 12.051 2.188 8.691 2.188zm-2.374 3.47a.875.875 0 1 1 0 1.75.875.875 0 0 1 0-1.75zm4.748 0a.875.875 0 1 1 0 1.75.875.875 0 0 1 0-1.75zM24 14.465c0-3.154-3.136-5.711-7.004-5.711S10 11.311 10 14.465c0 3.155 3.136 5.711 7.004 5.711.868 0 1.698-.126 2.467-.354a.682.682 0 0 1 .574.079l1.521.89a.26.26 0 0 0 .133.043.236.236 0 0 0 .234-.236c0-.058-.023-.115-.038-.172l-.312-1.183a.473.473 0 0 1 .17-.533C23.032 17.98 24 16.32 24 14.465zm-9.195-1.001a.7.7 0 1 1 0-1.4.7.7 0 0 1 0 1.4zm4.39 0a.7.7 0 1 1 0-1.4.7.7 0 0 1 0 1.4z" />
      </svg>
    );
  }

  if (type === 'project') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
};

const ActionLink = ({ href, label, type = 'project' }) => {
  if (!href) return null;

  const styleByType = {
    project: 'text-blue-700 bg-blue-50 hover:bg-blue-100 border-blue-200',
    paper: 'text-gray-700 bg-gray-50 hover:bg-gray-100 border-gray-200',
    wechat: 'text-green-700 bg-green-50 hover:bg-green-100 border-green-200',
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[10px] font-semibold transition-colors duration-150 xl:px-3 xl:text-xs ${styleByType[type]}`}
    >
      <LinkIcon type={type} />
      {label}
    </a>
  );
};

const ProjectActions = ({ item }) => {
  const showPaper = item.link && item.link !== item.projectLink && isPaperLink(item.link);
  const showCode = item.link && item.link !== item.projectLink && isRepositoryLink(item.link);

  return (
    <div className="flex min-h-16 flex-wrap content-start gap-1.5 xl:gap-2">
      <ActionLink
        href={item.projectLink}
        label={getProjectActionLabel(item.projectLink)}
        type="project"
      />
      {showPaper && <ActionLink href={item.link} label="Paper" type="paper" />}
      {showCode && <ActionLink href={item.link} label="Code" type="project" />}
      <ActionLink href={item.wechatLink} label="Wechat Post" type="wechat" />
    </div>
  );
};

const ProjectCover = ({ item, className = '', showSecondary = false }) => {
  const previewImages = item.previewImages?.length ? item.previewImages : item.mediaContent ? [item.mediaContent] : [];
  const visibleImages = showSecondary ? previewImages.slice(0, 2) : previewImages.slice(0, 1);
  const hasImages = visibleImages.length > 0;
  const wrapperClass = hasImages
    ? `block overflow-hidden border-b border-gray-100 bg-white p-2 ${className}`
    : `flex flex-col items-center justify-center gap-3 bg-gray-100 text-gray-500 ${className}`;

  if (hasImages) {
    const imageGridClass = visibleImages.length > 1
      ? 'grid h-full grid-cols-1 gap-2 md:grid-cols-[1.25fr_0.85fr]'
      : 'h-full';
    const images = (
      <div className={imageGridClass}>
        {visibleImages.map((src, index) => (
          <div key={src} className={`${index > 0 ? 'hidden md:block' : ''} h-full min-w-0 rounded-md bg-white`}>
            <img
              src={src}
              alt={`${item.displayTitle} preview ${index + 1}`}
              className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.01]"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    );

    return item.projectLink ? (
      <a
        href={item.projectLink}
        target="_blank"
        rel="noreferrer"
        className={`${wrapperClass} group`}
        aria-label={`Open ${item.displayTitle} project page`}
      >
        {images}
      </a>
    ) : (
      <div className={wrapperClass}>{images}</div>
    );
  }

  const placeholder = (
    <>
      <Layers3 size={34} />
      <span className="max-w-[220px] text-center text-sm font-semibold">{item.topic}</span>
    </>
  );

  return item.projectLink ? (
    <a
      href={item.projectLink}
      target="_blank"
      rel="noreferrer"
      className={`${wrapperClass} transition-colors hover:bg-gray-200`}
      aria-label={`Open ${item.displayTitle} project page`}
    >
      {placeholder}
    </a>
  ) : (
    <div className={wrapperClass}>{placeholder}</div>
  );
};

const ProjectCard = ({ project, displayTier = 'medium', priority = 'core', tileClass, showSecondaryPreview = false }) => {
  const cardClass = priority === 'secondary'
    ? 'border-gray-200 bg-white'
    : 'border-gray-200 bg-white';

  const titleClass = displayTier === 'hero' ? 'text-lg md:text-xl' : 'text-sm xl:text-base';
  const imageClass = TIER_IMAGE_CLASS[displayTier] || TIER_IMAGE_CLASS.medium;
  const fullTitle = project.title || project.displayTitle;
  const summary = project.desc || 'Project page and research resources are available through the external link.';

  return (
    <article className={`${tileClass || TIER_CLASS[displayTier] || TIER_CLASS.medium} flex h-full min-w-0 flex-col overflow-hidden rounded-lg border ${cardClass} shadow-sm transition-shadow hover:shadow-md`}>
      <ProjectCover item={project} className={`${imageClass} w-full`} showSecondary={showSecondaryPreview} />
      <div className="flex flex-1 flex-col p-3">
        <div className="mb-2 flex min-h-9 flex-wrap content-start items-start gap-1.5 text-[10px] font-bold uppercase tracking-wider text-orange-600">
          {project.venueLabel && (
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-700">{project.venueLabel}</span>
          )}
          {priority === 'secondary' && <span className="text-gray-400">Secondary</span>}
        </div>
        <h4 className={`${titleClass} min-h-[4.25rem] line-clamp-3 font-bold leading-snug [overflow-wrap:anywhere]`}>
          {fullTitle}
        </h4>
        <p className="mt-2 min-h-10 text-xs leading-relaxed text-gray-500 line-clamp-2">
          {summary}
        </p>
        <div className="mt-auto pt-4">
          <ProjectActions item={project} />
        </div>
      </div>
    </article>
  );
};

const MODULE_ORDER = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const resolveProjectEntries = (projects = [], projectById) =>
  projects
    .map((entry) => ({ ...entry, project: projectById.get(String(entry.id)) }))
    .filter((entry) => entry.project);

const getVisibleModules = (direction, projectById) =>
  direction.frameworkModules
    .map((module) => {
      const subgroups = (module.subgroups || [])
        .map((subgroup) => ({
          ...subgroup,
          projects: resolveProjectEntries(subgroup.projects, projectById),
        }))
        .filter((subgroup) => subgroup.projects.length > 0);
      const projects = subgroups.length
        ? subgroups.flatMap((subgroup) => subgroup.projects)
        : resolveProjectEntries(module.projects, projectById);

      return {
        ...module,
        projects,
        subgroups,
      };
    })
    .filter((module) => module.projects.length > 0)
    .sort((a, b) => MODULE_ORDER.indexOf(a.position) - MODULE_ORDER.indexOf(b.position));

const getModuleGridClass = (projectCount) => {
  if (projectCount >= 3) return 'xl:grid-cols-3';
  if (projectCount === 2) return 'xl:grid-cols-2';
  return 'grid-cols-1';
};

const getModuleTileClass = (module, moduleCount) => {
  if (module.subgroups?.length) return 'md:col-span-2';
  if (moduleCount === 1) return 'md:col-span-2';
  if (moduleCount === 3 && module.position.startsWith('bottom')) return 'md:col-span-2';
  return '';
};

const FrameworkSubgroup = ({ subgroup, isPrimary = false }) => (
  <div className="flex min-w-0 flex-col rounded-lg border border-gray-200 bg-white/80 p-3">
    <div className="mb-3 min-h-16">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">
          {subgroup.projects.length} project{subgroup.projects.length > 1 ? 's' : ''}
        </span>
      </div>
      <h4 className="text-sm font-bold leading-tight md:text-base">{subgroup.title}</h4>
      {subgroup.desc && <p className="mt-1 text-xs leading-relaxed text-gray-500">{subgroup.desc}</p>}
    </div>

    <div className={`grid flex-1 grid-cols-1 gap-3 ${isPrimary ? 'xl:grid-cols-3' : ''}`}>
      {subgroup.projects.map((entry) => (
        <ProjectCard
          key={entry.id}
          project={entry.project}
          displayTier={entry.displayTier}
          priority={entry.priority}
          tileClass={entry.tileClass}
          showSecondaryPreview={subgroup.projects.length === 1}
        />
      ))}
    </div>
  </div>
);

const FrameworkModule = ({ module, moduleCount }) => (
  <section
    className={`${getModuleTileClass(module, moduleCount)} relative z-10 flex h-full flex-col rounded-xl border border-gray-200 bg-gray-50/90 p-3 shadow-sm md:p-4`}
  >
    <div className="mb-3 md:min-h-[74px]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-orange-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          {module.label}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">
          {module.projects.length} project{module.projects.length > 1 ? 's' : ''}
        </span>
      </div>
      <h3 className="text-base font-bold leading-tight md:text-lg">{module.title}</h3>
      {module.desc && <p className="mt-1 text-xs leading-relaxed text-gray-500 md:text-sm">{module.desc}</p>}
    </div>

    {module.subgroups?.length ? (
      <div className="grid flex-1 grid-cols-1 items-stretch gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        {module.subgroups.map((subgroup, index) => (
          <FrameworkSubgroup key={subgroup.title} subgroup={subgroup} isPrimary={index === 0} />
        ))}
      </div>
    ) : (
      <div className={`grid flex-1 grid-cols-1 items-stretch gap-3 ${getModuleGridClass(module.projects.length)}`}>
        {module.projects.map((entry) => (
          <ProjectCard
            key={entry.id}
            project={entry.project}
            displayTier={entry.displayTier}
            priority={entry.priority}
            tileClass={entry.tileClass}
            showSecondaryPreview={module.projects.length === 1}
          />
        ))}
      </div>
    )}
  </section>
);

const DirectionPanel = ({ direction, projectById }) => {
  const visibleModules = getVisibleModules(direction, projectById);
  const projectCount = visibleModules.reduce((count, module) => count + module.projects.length, 0);

  return (
    <FadeInSection className="rounded-xl border border-gray-300 bg-white p-4 shadow-sm md:p-6">
      <header className="flex flex-col gap-5 border-b border-gray-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">Research Direction</p>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">{projectCount} projects</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold leading-tight md:text-3xl">{direction.topic}</h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">{direction.summary}</p>
        </div>

        <div className="flex max-w-xl flex-wrap gap-2 lg:justify-end">
          {direction.keywords.map((keyword) => (
            <span key={keyword} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
              {keyword}
            </span>
          ))}
        </div>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {visibleModules.map((module) => (
          <FrameworkModule key={`${direction.id}-${module.position}`} module={module} moduleCount={visibleModules.length} />
        ))}
      </div>
    </FadeInSection>
  );
};

export const ResearchListPage = ({ title, description, items }) => {
  const projectById = useMemo(() => {
    const publicationProjects = items
      .filter((item) => item.projectLink && item.projectLink.trim())
      .map(normalizeProject);

    const projects = [normalizeProject(SAT2CITY_V2), ...publicationProjects]
      .filter((item) => RESEARCH_INCLUDE_IDS.has(item.id));

    return new Map(projects.map((item) => [item.id, item]));
  }, [items]);

  return (
    <div className="min-h-screen w-full bg-white">
      <div className="mx-auto max-w-[1480px] px-6 py-12 md:py-14">
        <FadeInSection className="mb-10">
          <div className="max-w-4xl">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-orange-600">Research Map</p>
            <h1 className="text-4xl font-bold tracking-tight md:text-6xl">{title}</h1>
            <p className="mt-5 max-w-3xl text-base leading-relaxed text-gray-600 md:text-lg">{description}</p>
          </div>
        </FadeInSection>

        <div className="grid gap-7">
          {RESEARCH_MAP.map((direction) => (
            <DirectionPanel key={direction.id} direction={direction} projectById={projectById} />
          ))}
        </div>
      </div>
    </div>
  );
};
