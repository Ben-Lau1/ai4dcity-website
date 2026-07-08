// src/data/publications.js
//
// Fields: id, title, desc(opt), topic, year, date, link,
//         wechatLink(opt), projectLink(opt), mediaContent(opt)

export const PUBLICATION_ITEMS = [
  {
    id: "urbanchange-multitask-land-cover",
    title: "Towards comprehensive multi-task land cover change detection leveraging vision-language model and LLM-driven agents",
    desc: "This work introduces UrbanChange, a multi-task dataset and framework for 2D and 3D land cover change detection using vision-language models and LLM-driven agents.",
    topic: "Spatio-temporal (4D) Data Fusion",
    year: "2026",
    date: "ISPRS Journal of Photogrammetry and Remote Sensing, 2026. DOI: 10.1016/j.isprsjprs.2026.05.025",
    link: "https://doi.org/10.1016/j.isprsjprs.2026.05.025"
  },
  {
    id: "holo360d",
    title: "Holo360D: A Large-Scale Real-World Dataset with Continuous Trajectories for Advancing Panoramic 3D Reconstruction and Beyond",
    desc: "Holo360D provides large-scale real-world panoramic captures paired with LiDAR-derived geometry, including meshes, point clouds, depth maps, and camera poses.",
    topic: "AI based 3D City Modeling",
    year: "2026",
    date: "ECCV 2026. arXiv:2604.22482",
    link: "https://arxiv.org/abs/2604.22482",
    projectLink: "https://jou719.github.io/Holo360D_homepage/",
    mediaContent: "/images/research/holo360d-cover.jpg"
  },
  {
    id: "eventvggt",
    title: "EventVGGT: Exploring Cross-Modal Distillation for Consistent Event-based Depth Estimation",
    desc: "EventVGGT models asynchronous event streams as continuous video sequences and distills spatio-temporal and multi-view geometric priors from image-based VGGT for consistent event-based depth estimation.",
    topic: "AI based 3D City Modeling",
    year: "2026",
    date: "ECCV 2026. arXiv:2603.09385",
    link: "https://arxiv.org/abs/2603.09385",
    projectLink: "https://github.com/yinruiRen/EventVGGT",
    mediaContent: "/images/research/eventvggt-teaser.jpg"
  },
  {
    id: "skylume",
    title: "Beyond a Single Light: A Large-Scale Aerial Dataset for Urban Scene Reconstruction Under Varying Illumination",
    desc: "SkyLume captures the same urban regions across multiple illumination periods, pairing five-direction UAV imagery with LiDAR-derived geometry for robust 3D reconstruction research.",
    topic: "AI based 3D City Modeling",
    year: "2026",
    date: "ECCV 2026. arXiv:2512.14200",
    link: "https://arxiv.org/abs/2512.14200",
    projectLink: "https://zhuoxiaoli.github.io/skylume_page/",
    mediaContent: "/images/research/skylume-teaser.jpg"
  },
  {
    id: "sat2city-v2",
    title: "Sat2City v2: Native 3D City Asset Generation from a Single Satellite Image",
    desc: "Sat2City v2 generates explicit city-scale geometry and satellite-consistent textured mesh assets from a single satellite image.",
    topic: "AI based 3D City Modeling",
    year: "2026",
    date: "Pre-print, 2026. arXiv:2606.24138",
    link: "https://arxiv.org/abs/2606.24138",
    projectLink: "https://ai4city-hkust.github.io/Sat2City-v2/",
    mediaContent: "/images/research/project-pages/sat2city-v2.png"
  },
  {
    id: "geoidentity-sat2street",
    title: "Bridging street view coverage disparities through geographic identity preserving generation from satellite view",
    desc: "Street view imagery (SVI) provides a human-centric view of urban environments, but its coverage is highly uneven. We propose GeoIdentity-Sat2Street, a geographic identity preserving framework that leverages satellite imagery to expand street view coverage.",
    topic: "Urban Env-Understanding",
    year: "2026",
    date: "ISPRS Journal of Photogrammetry and Remote Sensing, 2026. DOI: 10.1016/j.isprsjprs.2026.03.049",
    link: "https://doi.org/10.1016/j.isprsjprs.2026.03.049",
    projectLink: "https://github.com/ai4city-hkust/GeoIdentity-Sat2Street",
    mediaContent: "/images/research/GeoIdentity-Sat2Street.jpg"
  },
  {
    id: 1776654603298,
    title: "BuildingComSSSM: Building point cloud completion with Geometry-Aware Mambas",
    desc: "BuildingComSSSM introduces geometry-aware Mamba modules to capture geometric structural information of sparse point clouds. Moreover, the key point generation module guided by the attention mechanism is constructed to strengthen the bidirectional modeling capabilities while generating complete key points. ",
    topic: "AI based 3D City Modeling",
    year: "2026",
    date: "International Journal of Applied Earth Observation and Geoinformation",
    link: "https://doi.org/10.1016/j.jag.2026.105269",
    wechatLink: "https://mp.weixin.qq.com/s/M12tUYcQkSU4IkQ4wzvlFA"
  },
  {
    id: 2026001,
    title: "Causal Discovery in Urban Data with Temporal Empirical Dynamic Modeling: The R Package tEDM",
    desc: "We introduce tEDM, an open-source R package that extends EDM to heterogeneous, high-frequency, multivariate, and multi-spatial urban datasets. The package combines a C++ computational backbone with seamless R integration to achieve both efficiency and usability in large-scale urban time series analysis.",
    topic: "Spatio-temporal (4D) Data Fusion",
    year: "2026",
    date: "Computers, Environment and Urban Systems (CEUS), 2026",
    link: "https://www.sciencedirect.com/science/article/abs/pii/S0198971526000372",
    wechatLink: "https://mp.weixin.qq.com/s/cJvXLKKeYlZ7z1mDOvs3ww",
    projectLink: "https://github.com/stscl/tEDM"
  },
  {
    id: "gcmc-spatial-causality",
    title: "Measuring Causal Strengths from Spatial Cross-Sectional Data with Geographical Cross Mapping Cardinality",
    desc: "This work measures causal strengths from spatial cross-sectional data through geographical cross mapping cardinality, extending empirical dynamic modeling for spatial causal inference.",
    topic: "Spatio-temporal (4D) Data Fusion",
    year: "2026",
    date: "International Journal of Geographical Information Science (IJGIS), 2026. DOI: 10.1080/13658816.2026.2687121",
    link: "https://doi.org/10.1080/13658816.2026.2687121",
    projectLink: "https://stscl.github.io/spEDM/articles/GCMC.html",
    mediaContent: "/images/research/gcmc-causal-strengths.png"
  },
  {
    id: 2026002,
    title: "Revealing the Co-occurrence Patterns of Public Emotions from Social Media Data",
    desc: "Perceiving multidimensional emotions from social media data and analyzing their spatiotemporal dynamics constitute a significant topic at the intersection of geographic information science and social management.",
    topic: "Urban Env-Understanding",
    year: "2026",
    date: "International Journal of Geographical Information Science (IJGIS), 2026. DOI: 10.1080/13658816.2026.2640612",
    link: "http://dx.doi.org/10.1080/13658816.2026.2640612",
    wechatLink: "https://mp.weixin.qq.com/s/KTGfjr2rC9iZQFvc7BVRJA"
  },
  {
    id: 2026003,
    title: "UniD-Shift: Towards Unified Semantic Segmentation via Interpretable Shared–Private Multimodal Decomposition",
    topic: "Spatio-temporal (4D) Data Fusion",
    year: "2026",
    date: "CVPR Findings 2026",
    wechatLink: "https://mp.weixin.qq.com/s/qSWyE-aVgjpNHah6vRZueg",
    projectLink: "https://github.com/shuaizhang69/UniD-Shift"
  },
  {
    id: 2026004,
    title: "BuildAnyPoint: 3D Building Structured Abstraction from Diverse Point Clouds",
    desc: "We introduce BuildAnyPoint, a novel generative framework for structured 3D building reconstruction from point clouds with diverse distributions, such as those captured by airborne LiDAR and Structure-from-Motion.",
    topic: "AI based 3D City Modeling",
    year: "2026",
    date: "CVPR 2026. arXiv:2602.23645",
    link: "http://arxiv.org/abs/2602.23645",
    projectLink: "https://ai4city-hkust.github.io/BuildAnyPoint/",
    wechatLink: "https://mp.weixin.qq.com/s/gQkg9zIs72DvKChWH7MnwQ",
    mediaContent: "/images/research/BAP.png"
  },
  {
    id: 2026005,
    title: "NeighborMAE: Exploiting Spatial Dependencies between Neighboring Earth Observation Images in Masked Autoencoders Pretraining",
    desc: "We propose NeighborMAE, which learns spatial dependencies by joint reconstruction of neighboring Earth Observation images.",
    topic: "Spatio-temporal (4D) Data Fusion",
    year: "2026",
    date: "CVPR 2026. arXiv:2603.02522",
    link: "https://arxiv.org/abs/2603.02522",
    wechatLink: "https://mp.weixin.qq.com/s/BNgW3xkXwxuTFll1cOIWCA",
    projectLink: "https://github.com/LeungTsang/NeighborMAE",
    mediaContent: "/images/publication/NeighborMAE.png"
  },
  {
    id: 2026006,
    title: "Rsc-CoT: Visual-CoT Reasoning and Reinforced Optimization for Remote Sensing Change Captioning",
    topic: "Spatio-temporal (4D) Data Fusion",
    year: "2026",
    date: "ICASSP 2026",
    wechatLink: "https://mp.weixin.qq.com/s/RgUkGw-Vs0cmgObCnPbtlg"
  },
  {
    id: 1774848683155,
    title: "Contrasting Causal Pathways of Vegetation Greening between Economically Strong and Weak Towns in China's Greater Bay Area",
    desc: "By integrating high-resolution multi-angle vegetation fractional cover data with five driving factors, the research applies a spatiotemporal clustering–trajectory decomposition–causal inference framework to analyze vegetation cover dynamics at the township level from 2000 to 2020.",
    topic: "Urban Env-Understanding",
    year: "2026",
    date: "GIScience & Remote Sensing, 2026. DOI: 10.1080/15481603.2026.2623327",
    link: "https://doi.org/10.1080/15481603.2026.2623327",
    wechatLink: "https://mp.weixin.qq.com/s/AQINgWI4c3HiXQ2lOlcUFA",
    mediaContent: "/images/publication/DWQ.png"
  },
  {
    id: 1774775739519,
    title: "DSTI-Net: A Dynamic Spatial–Temporal Interaction Network with Semantic Guidance for 2D and 3D Change Detection",
    desc: "DSTI-Net is a multitask framework for joint 2D semantic and 3D structural change detection.",
    topic: "Spatio-temporal (4D) Data Fusion",
    year: "2026",
    date: "IEEE TGRS, 2026. DOI: 10.1109/TGRS.2026.3669158",
    link: "https://doi.org/10.1109/TGRS.2026.3669158",
    wechatLink: "https://mp.weixin.qq.com/s/qU3p7Q3QK5TA2eyyPQsO5Q",
    projectLink: "https://github.com/XiangyuChen666/DSTI-Net",
    mediaContent: "/images/publication/DSTI.png"
  },
  {
    id: 1774848031951,
    title: "SkyEvents: A Large-Scale Event-Enhanced UAV Dataset for Robust 3D Scene Reconstruction",
    desc: "SkyEvents is a large-scale multimodal UAV dataset combining event camera, RGB video, and LiDAR data, captured across 5 areas using a DJI Matrice 350 RTK drone.",
    topic: "Spatio-temporal (4D) Data Fusion",
    year: "2026",
    date: "ICLR 2026",
    link: "https://github.com/Anthony-ECPKN/SkyEvent",
    wechatLink: "https://mp.weixin.qq.com/s/_cf9EJeoPL79Duzh_zgmjg",
    projectLink: "https://anthony-ecpkn.github.io/SkyEvent.github.io/",
    mediaContent: "/images/publication/SKYEVEN.png"
  },
  {
    id: 1774779504458,
    title: "BuildingMultiView: Powering Multi-Scale Building Characterization with Large Language Models and Multi-Perspective Imagery",
    desc: "Through meta-analysis, 11 key visual building attributes are identified; satellite and street-view imagery are then integrated and processed by fine-tuned large language models.",
    topic: "Urban Env-Understanding",
    year: "2026",
    date: "International Journal of Applied Earth Observation and Geoinformation (JAG), 2026. DOI: 10.1016/j.jag.2025.105034",
    link: "https://doi.org/10.1016/j.jag.2025.105034",
    wechatLink: "https://mp.weixin.qq.com/s/fXknzW9aynaAw3B6N-wUsQ",
    projectLink: "https://github.com/ai4city-hkust/buildingmultiview",
    mediaContent: "/images/publication/微信图片_2026-03-29_181922_037.png"
  },
  {
    id: 4,
    title: "ULSR-GS: Urban Large-Scale Surface Reconstruction Gaussian Splatting with Multi-View Geometric Consistency",
    desc: "ULSR-GS consistently outperforms existing single- and multi-GPU Gaussian Splatting methods on large-scale aerial benchmark datasets.",
    topic: "AI based 3D City Modeling",
    year: "2025",
    date: "ISPRS Journal of Photogrammetry and Remote Sensing, 2025. DOI: 10.1016/j.isprsjprs.2025.10.008",
    link: "https://doi.org/10.1016/j.isprsjprs.2025.10.008",
    wechatLink: "https://mp.weixin.qq.com/s/aNZjGcmorOJKLHZeelAmtw",
    projectLink: "https://ulsrgs.github.io/",
    mediaContent: "/images/research/USLR-GS/1-s2.0-S092427162500396X-gr19.jpg"
  },
  {
    id: 6,
    title: "Dual-Domain Representation Alignment for Unsupervised Height Estimation from Cross-Resolution Remote Sensing Images",
    desc: "This work explores a cross-resolution case encountered in many real-world applications to investigate the task of height estimation under unsupervised domain adaptation.",
    topic: "Urban Env-Understanding",
    year: "2026",
    date: "ISPRS Journal of Photogrammetry and Remote Sensing, 2026. DOI: 10.1016/j.isprsjprs.2025.10.035",
    link: "https://doi.org/10.1016/j.isprsjprs.2025.10.035",
    wechatLink: "https://mp.weixin.qq.com/s/GvI1sci-JF1eAqFUcAOm3g",
    mediaContent: "/images/publication/dual-domain.png"
  },
  {
    id: 2,
    title: "Depth2Elevation: Scale Modulation with Depth Anything Model for Single-view Remote Sensing Image Height Estimation",
    desc: "We introduce the first application of the Depth Anything Model (DAM) to height estimation in remote sensing images.",
    topic: "AI based 3D City Modeling",
    year: "2025",
    date: "IEEE Transactions on Geoscience and Remote Sensing (TGRS), 2025. DOI: 10.1109/TGRS.2025.3564820",
    link: "https://doi.org/10.1109/TGRS.2025.3564820",
    wechatLink: "https://mp.weixin.qq.com/s/JEKPHoqYUTONDszWnLk1uQ",
    mediaContent: "/images/research/D2E.png"
  },
  {
    id: 33,
    title: "gdverse: An R Package for Spatial Stratified Heterogeneity Family",
    desc: "An R package gdverse developed to integrate various SSH models, leveraging R's rich statistical and spatial data processing capabilities while natively supporting multicore parallel computing.",
    topic: "Spatio-temporal (4D) Data Fusion",
    year: "2025",
    date: "Transactions in GIS (TGIS), 2025. DOI: 10.1111/tgis.70032",
    link: "https://doi.org/10.1111/tgis.70032",
    projectLink: "https://github.com/stscl/gdverse",
    wechatLink: "https://mp.weixin.qq.com/s/mXuPeSShnPXQQWKme_53Dw",
    mediaContent: "/images/research/gdverse.png"
  },
  {
    id: 3,
    title: "Sat2City: 3D City Generation from A Single Satellite Image with Cascaded Latent Diffusion",
    desc: "Sat2City synergizes the representational capacity of sparse voxel grids with latent diffusion models for city-scale 3D generation from a single satellite image.",
    topic: "AI based 3D City Modeling",
    year: "2025",
    date: "ICCV 2025. arXiv:2507.04403",
    link: "https://doi.org/10.48550/arXiv.2507.04403",
    wechatLink: "https://mp.weixin.qq.com/s/Kl8IiA1A_vgr0P1F-yr30Q",
    projectLink: "https://ai4city-hkust.github.io/Sat2City/",
    mediaContent: "/images/research/s2c2.png"
  },
  {
    id: 2025001,
    title: "From Visual Perception to Behavioral Insights: A Comprehensive Workflow for Collecting and Processing Human-Building Interaction Data",
    topic: "Urban Env-Understanding",
    year: "2025",
    date: "Computational Urban Planning and Urban Management (CUPUM) 2025"
  },
  {
    id: 2025002,
    title: "A Lightweight Fine-Tuning Foundation Models for Multi-Task Change Detection Using Remote Sensing Images",
    desc: "Accurate detection of 2D and 3D changes is critical for urban planning, environmental monitoring, and disaster assessment.",
    topic: "Spatio-temporal (4D) Data Fusion",
    year: "2025",
    date: "IGARSS 2025. DOI: 10.1109/IGARSS55030.2025.11242946",
    link: "https://doi.org/10.1109/IGARSS55030.2025.11242946"
  },
  {
    id: 2025003,
    title: "Exploring Multiscale Variations in Greenspace Exposure Drivers: A Perspective on the Modifiable Areal Unit Problem",
    desc: "Overall, this study bridged research gaps by providing a multiscale perspective on greenspace exposure and its drivers.",
    topic: "Urban Env-Understanding",
    year: "2025",
    date: "IGARSS 2025. DOI: 10.1109/IGARSS55030.2025.11243018",
    link: "https://doi.org/10.1109/IGARSS55030.2025.11243018"
  },
  {
    id: 1,
    title: "BuildingView: Constructing Urban Building Exteriors Databases with Street View Imagery and Multimodal Large Language Model",
    desc: "BuildingView integrates high-resolution visual data from Google Street View with spatial information from OpenStreetMap, improving the accuracy of urban building exterior data.",
    topic: "Urban Env-Understanding",
    year: "2025",
    date: "International Conference on Spatial Data and Intelligence, Springer, 2025. DOI: 10.1007/978-981-95-3102-8_1",
    link: "https://doi.org/10.1007/978-981-95-3102-8_1",
    projectLink: "https://github.com/Jasper0122/BuildingView",
    mediaContent: "/images/publication/BV.png"
  }
];
