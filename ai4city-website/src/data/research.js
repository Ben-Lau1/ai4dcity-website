export const RESEARCH_PROJECTS = [
  {
    id: 1774849010173,
    title: "NeighborMAE: Exploiting Spatial Dependencies between Neighboring Earth Observation Images in Masked Autoencoders Pretraining",
    desc: "We propose NeighborMAE, which learns spatial dependencies by joint reconstruction of neighboring Earth Observation images. To ensure that the reconstruction remains challenging, we leverage a heuristic strategy to dynamically adjust the mask ratio and the pixel-level loss weight. Experimental results across various pretraining datasets and downstream tasks show that NeighborMAE significantly outperforms existing baselines, underscoring the value of neighboring images in Masked Image Modeling for Earth Observation and the efficacy of our designs.",
    mediaType: "image",
    mediaContent: "/images/publication/NeighborMAE.png",
    link: "https://mp.weixin.qq.com/s/BNgW3xkXwxuTFll1cOIWCA",
    date: "Mar 4 2026",
    topic: "Spatio-temporal (4D) Data Fusion",
    year: "2026"
  },
  {
    id: 1774771457506,
    title: "BuildingMultiView",
    desc: "Through meta-analysis, 11 key visual building attributes are identified; satellite and street-view imagery are then integrated and processed by fine-tuned large language models (LLMs) to systematically extract multi-scale building features. Experiments across five U.S. cities yield an F1 score of 79.77%, significantly outperforming non-fine-tuned models, providing a scalable tool for urban planning.",
    mediaType: "image",
    mediaContent: "/images/research/workflow.png",
    link: "https://github.com/ai4city-hkust/buildingmultiview",
    date: "Mar 3 2026",
    topic: "Urban Env-Understanding",
    year: "2026"
  },
  {
    id: 1774775944202,
    title: "BuildAnyPoint 3D Building Structured Abstraction from Diverse Point Clouds",
    desc: "We are the first to tame Artist-Mesh (AM) generation models for severely disturbed input point clouds commonly encountered in large-scale urban observations, by introducing 3D generative priors. We design a Loosely Cascaded Diffusion Transformer (Loca-DiT) that initially recovers the underlying distribution from noisy or sparse points, followed by autoregressively encapsulating them into compact meshes.",
    mediaType: "image",
    mediaContent: "/images/research/BAP.png",
    link: "https://ai4city-hkust.github.io/BuildAnyPoint/",
    date: "Mar 2 2026",
    topic: "AI based 3D City Modeling",
    year: "2026"
  },
  {
    id: "ulsr-gs",
    title: "ULSR-GS: Urban-scale Large Surface Reconstruction based on Gaussian Splatting",
    desc: "Building upon MVG-Splatting, ULSR-GS proposes a 'point-to-photo partitioning + multi-view guided densification + cross-view depth/normal consistency constraint' framework. It supports cross-GPU parallel training and enables independent mesh extraction with seamless stitching across sub-regions. On multiple urban-scale aerial survey datasets, it consistently outperforms existing GS methods and traditional MVS-based pipelines, opening new pathways for remote sensing mapping and digital twins.",
    mediaType: "image",
    mediaContent: "/images/news/ULSR/640.png",
    link: "https://ulsrgs.github.io/",
    date: "Oct 10 2025",
    topic: "AI based 3D City Modeling",
    year: "2026",
    articleId: "research-multimodal"
  },
  {
    id: "sat2city",
    title: "Sat2City: High-Fidelity 3D City Generation from a Single Satellite Image via Cascaded Latent Diffusion Models",
    desc: "Sat2City achieves effective integration of diffusion models with voxel representations, demonstrating for the first time the feasibility of efficiently generating city-scale 3D models from a single 2D satellite image. The team will focus on improving generalization capability and computational efficiency on real-world urban remote sensing data, paving new pathways for remote sensing mapping and digital twins.",
    mediaType: "image",
    mediaContent: "/images/research/s2c.png",
    link: "https://ai4city-hkust.github.io/Sat2City/",
    demoLink: "https://ai4city-hkust.github.io/Sat2City/",
    date: "Oct 10 2025",
    topic: "AI based 3D City Modeling",
    year: "2025",
    venue: "ICCV 2025",
    articleId: "research-multimodal"
  },
  {
    id: "depth2elevation",
    title: "Depth2Elevation: Single-View Remote Sensing Image Elevation Estimation via Visual Foundation Model Transfer",
    desc: "The Depth2Elevation model effectively transfers the depth estimation capability of DAM to the elevation estimation task for single-view remote sensing images by introducing a scale modulator and a resolution-adaptive decoder. It achieves outstanding performance across multiple benchmark datasets, demonstrating applicability and generalization at varying scales and scenes.",
    mediaType: "image",
    mediaContent: "/images/research/D2Ehr.png",
    link: "https://mp.weixin.qq.com/s/JEKPHoqYUTONDszWnLk1uQ",
    date: "Sep 05 2025",
    topic: "AI based 3D City Modeling",
    year: "2025",
    articleId: "Depth2Elevation"
  },
  {
    id: "gdverse",
    title: "gdverse: An Integrated Spatial Stratified Heterogeneity Modeling Toolkit",
    desc: "We developed an R package gdverse dedicated to spatial stratified heterogeneity modeling. By designing a unified API interface and efficient algorithm implementations, it aims to facilitate the broader application of spatial stratified heterogeneity models across geographic information science.",
    mediaType: "image",
    mediaContent: "/images/research/gdverse.png",
    date: "Sep 05 2025",
    topic: "Spatio-temporal (4D) Data Fusion",
    year: "2025"
  }
];
