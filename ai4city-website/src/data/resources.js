export const RESOURCES_LIST_ITEMS = [
  {
    id: "lccviewer-demo",
    title: "LCCViewer",
    desc: "LCCViewer is an interactive web demo for exploring large-scale 3D city scenes. It runs as part of the AI4DCity website build, while the large scene data remains hosted under the same OBS bucket for efficient delivery.",
    mediaType: "image",
    mediaContent: "/lccviewer/textures/skybox/5.jpg",
    link: "/lccviewer/index.html",
    date: "Launch interactive viewer",
    year: "2026",
    resourceType: "Demo",
    topic: "3D City Modeling"
  },
  {
    id: 1774850137756,
    title: "BuildingView-Turbo",
    desc: "Buildings provide unique insights into the urban environment, encompassing physical, functional, and aesthetic dimensions. Traditional approaches often rely on remote sensing (sky-view) or street-level imagery (street-view) for building information extraction but tend to focus on isolated perspectives. These methods limit the holistic understanding of urban morphology and functionality.\nBuildingView-Turbo addresses this gap by integrating sky-view and street-view imagery using advanced computational techniques. This novel framework enables the construction of a comprehensive, multi-city building database for deeper urban analysis.",
    mediaType: "image",
    mediaContent: "/images/resource/BuildMulview.png",
    link: "https://github.com/ai4city-hkust/buildingmultiview.git",
    date: "https://github.com/ai4city-hkust/buildingmultiview.git",
    year: "2026",
    resourceType: "Code(Github)"
  },
  {
    id: 1774847951534,
    title: "SkyEvents: A Large-Scale Event-Enhanced UAV Dataset for Robust 3D Scene Reconstruction",
    desc: "SkyEvents is a large-scale multimodal UAV dataset combining event camera, RGB video, and LiDAR data, captured across 5 areas using a DJI Matrice 350 RTK drone at 70–100m altitude under varied lighting and scene conditions. It contains 45 sequences, over 8 hours of synchronized data, covering 0.72 km² at 2.64 cm/pixel point cloud precision, along with two core modules to support event-based 3D reconstruction.",
    mediaType: "image",
    mediaContent: "/images/publication/SKYEVEN.png",
    link: "https://github.com/Anthony-ECPKN/SkyEvent",
    date: "https://github.com/Anthony-ECPKN/SkyEvent",
    year: "2026",
    resourceType: "Dataset",
    topic: "3D City Modeling"
  },
  {
    id: "holo360d-dataset",
    title: "Holo360D: A Large-Scale Real-World Dataset with Continuous Trajectories for Advancing Panoramic 3D Reconstruction and Beyond",
    desc: "Holo360D provides large-scale real-world panoramic captures paired with LiDAR-derived geometry, including meshes, point clouds, depth maps, and camera poses for 360 / terrestrial 3D reconstruction research.",
    mediaType: "image",
    mediaContent: "/images/research/holo360d-cover.jpg",
    link: "https://jou719.github.io/Holo360D_homepage/",
    date: "https://jou719.github.io/Holo360D_homepage/",
    year: "2026",
    resourceType: "Dataset",
    topic: "3D City Modeling"
  },
  {
    id: "skylume-dataset",
    title: "SkyLume: A Large-Scale Aerial Dataset for Urban Scene Reconstruction Under Varying Illumination",
    desc: "SkyLume captures the same urban regions across multiple illumination periods, pairing five-direction UAV imagery with LiDAR-derived geometry for aerial-view 3D reconstruction, novel view synthesis, and inverse rendering research.",
    mediaType: "image",
    mediaContent: "/images/research/skylume-teaser.jpg",
    link: "https://zhuoxiaoli.github.io/skylume_page/",
    date: "https://zhuoxiaoli.github.io/skylume_page/",
    year: "2026",
    resourceType: "Dataset",
    topic: "3D City Modeling"
  },
  {
    id: 1774778474730,
    title: "Buildingmultiview_datasetsample",
    desc: "Through meta-analysis, 11 key visual building attributes are identified; satellite and street-view imagery are then integrated and processed by fine-tuned large language models (LLMs) to systematically extract multi-scale building features. Experiments across five U.S. cities yield an F1 score of 79.77%, significantly outperforming non-fine-tuned models, providing a scalable tool for urban planning.",
    mediaType: "image",
    mediaContent: "/images/publication/微信图片_2026-03-29_181922_037.png",
    link: "https://github.com/ai4city-hkust/buildingmultiview_datasetsample",
    date: "https://github.com/ai4city-hkust/buildingmultiview_datasetsample",
    year: "2026",
    resourceType: "Dataset"
  },
  {
    id: 6,
    title: "MeTreec v1.0",
    desc: "MeTreec is a \"one-stop\" processing pipeline designed for individual tree point clouds:\nIt receives segmented individual tree point clouds (.xyz format, Z-axis oriented upwards), calls AdTree (Du et al., 2019) to complete the 3D reconstruction, and subsequently performs mesh repair (hole filling) based on CGAL. It then calculates key tree metrics—such as Tree Height, Diameter at Breast Height (DBH), Crown Radius (CR), Crown Depth (CD), and Volume/Surface Area—from the skeleton or filtered leaf nodes. Simultaneously, it outputs a single JSON report and a batch CSV summary file.",
    mediaType: "image",
    mediaContent: "/images/resource/metree.jpg",
    link: "https://github.com/ai4city-hkust/Metreec-v1.0",
    date: "https://github.com/ai4city-hkust/Metreec-v1.0",
    resourceType: "Code(Github)"
  },
  {
    id: 5,
    title: "gdverse: An R Package for Spatial Stratified Heterogeneity Family",
    desc: "The lack of a comprehensive and user-friendly software tool has greatly limited their broader application in geospatial analysis and environmental modeling. To address this gap, an R package gdverse has been developed to integrate various SSH models, leveraging R's rich statistical and spatial data processing capabilities while natively supporting multicore parallel computing in the widely used R environment.",
    mediaType: "image",
    mediaContent: "/images/resource/gdverse.png",
    link: "https://github.com/stscl/gdverse",
    date: "https://github.com/stscl/gdverse",
    resourceType: "Open Package"
  },
  {
    id: "3-1",
    title: "spEDM: Spatial Empirical Dynamic Modeling",
    desc: "spEDM is an R package for spatial causal discovery. It extends Empirical Dynamic Modeling (EDM) from time series to spatial cross-sectional data, provides seamless support for vector and raster spatial data via tight integration with the sf and terra packages, and enables data-driven causal inference from spatial snapshots.",
    mediaType: "image",
    mediaContent: "/images/resource/spEDM.png",
    link: "https://stscl.github.io/spEDM/",
    date: "https://stscl.github.io/spEDM/",
    resourceType: "Open Package"
  },
  {
    id: "3-2",
    title: "tEDM: Temporal Empirical Dynamic Modeling",
    desc: "The tEDM package provides a suite of tools for exploring and quantifying causality in time series using Empirical Dynamic Modeling (EDM). It is particularly designed to detect, differentiate, and reconstruct causal dynamics in systems where traditional assumptions of linearity and stationarity may not hold.",
    mediaType: "image",
    mediaContent: "/images/resource/tEDM.png",
    link: "https://stscl.github.io/tEDM/",
    date: "https://stscl.github.io/tEDM/",
    resourceType: "Open Package"
  },
  {
    id: 4,
    title: "Foursquare2ArcGIS",
    desc: "Foursquare Open Source Places (FSQ OS Places) is a high-quality, open POI (Points of Interest) dataset released by Foursquare, containing over 104 million POIs worldwide. While platforms like OpenStreetMap (OSM) and Overture Maps aim to improve open POI coverage, FSQ OS Places provides a more extensive and precise dataset. This repository provides a step-by-step guide on downloading POI data and converting it from GeoJSON to Shapefile (SHP) for use in ArcGIS Pro, QGIS, and other GIS applications.",
    mediaType: "image",
    mediaContent: "/images/research/f2a.png",
    link: "https://github.com/ai4city-hkust/Foursquare2ArcGIS",
    date: "https://github.com/ai4city-hkust/Foursquare2ArcGIS",
    resourceType: "Code(Github)"
  },
  {
    id: 2,
    title: "BuildingView",
    desc: "BuildingView is an advanced tool designed to enhance urban analysis by integrating high-resolution visual data from Google Street View with spatial information from OpenStreetMap via the Overpass API. This tool focuses on creating detailed urban building exterior databases, identifying critical indicators for energy efficiency, environmental sustainability, and human-centric design. Through a systematic approach involving literature review, Street View sampling, and annotation using the ChatGPT-4.0 API, BuildingView improves the precision of urban building data.",
    mediaType: "image",
    mediaContent: "/images/resource/Buildingview.png",
    link: "https://github.com/Jasper0122/BuildingView",
    date: "https://github.com/Jasper0122/BuildingView",
    resourceType: "Code(Github)"
  }
];
