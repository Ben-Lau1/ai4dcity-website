// src/data/team.js

export const TEAM_DATA = {
  // 1. 实验室负责人 (PI)
  pi: {
    name: "Wufan Zhao",
    role: "Principal Investigator",
    bio: (<>Wufan ZHAO is an Assistant Professor (tenure-track) and PhD supervisor at HKUST(Guangzhou), jointly appointed by <a href="https://soch.hkust-gz.edu.cn/academics/ugod/" target="_blank" rel="noopener noreferrer">Urban Governance and Design (UGOD)</a> and <a href="https://www.hkust-gz.edu.cn/academics/hubs-and-thrust-areas/systems-hub/robotics-and-autonomous-systems/" target="_blank" rel="noopener noreferrer">Robotics and Autonomous Systems (ROAS)</a>. He obtained his PhD in 2022 from the  <a href="https://www.itc.nl/" target="_blank" rel="noopener noreferrer"> Faculty of Geo-Information Science and Earth Observation (ITC)</a>, University of Twente, the Netherlands, and conducted post-doctoral research at <a href="https://iiw.kuleuven.be/onderzoek/geomatics/home" target="_blank" rel="noopener noreferrer" >KU Leuven</a>, Belgium, in 2023. His research interests include AI-based intelligent interpretation of remote-sensing images, 3D urban modeling with particular attention to high-fidelity and generative techniques, and the fusion and analytics of multi-source spatiotemporal data. His work aims to support multi-scale analysis and decision-making for urban-environment and socio-economic challenges, ultimately contributing to the UN Sustainable Development Goals. He also emphasizes the practical deployment of these technologies in fields such as smart cities, embodied intelligence, natural resources, and engineering surveying and mapping.</>),
    edu: [
      "Editorial Board Member of the Photogrammetric Engineering & Remote Sensing", 
      "Executive Committee Member, ACM SIGSPATIAL China Chapter",
      "Member of ISPRS Commission IV, WG 9 on Digital Twins",
      "Member of ISDE Young Scientist Innovation Network ISDE-YSIN"
    ],
    Awards: [
      "PG course, 24fall till now, Maching learning in Remote Sensing (5112)",
      "PG course, 24fall-25spring, Science of City (5010)", 
      "PG course, 26spring, GIS and Spatial Analysis (5030)"
    ],
    img: "/images/people/wufan.jpg" // 路径前加了 / 以适配 React public 文件夹
  },

  // 2. 博士后 (Postdoc)
  postphd: [
    { name: "Zhuoxiao Li", role: "3D Reconstruction, Gaussian Splatting", email: "Zhuoxiao.Li@liverpool.ac.uk", homepage: "", img: "/images/people/Lizhuoxiao.png" }
  ],

  // 3. 博士生 (Ph.D. Students)
  phd: [
    { name: "Tongyan Hua", role: "3D city reconstruction, NeRF and SLAM", email: "thua388@connect.hkust-gz.edu.cn", homepage: "https://thua919.github.io/", img: "/images/people/TongyanHua.png" },
    { name: "Shuai Zhang", role: "Point cloud processing and foundation model", email: "shuaizhang2@hkust-gz.edu.cn", homepage: "http://shuaizhang-hkust.cn/", img: "/images/people/ShuaiZhang.png" },
    { name: "Jing Ou", role: "3D vision，3D city localization and reconstruction", email: "jingou714@gmail.com", homepage: "", img: "/images/people/OuJing.png" },
    { name: "Liwei Zou", role: "Multimodal data mining, Disaster analysis, Urban resilience", email: "zou.liwei.levi@gmail.com", homepage: "", img: "/images/people/zouliwei.jpg" },
    { name: "Dongli Wu", role: "Generative 3D Modeling", email: "annikeroseling@gmail.com", homepage: "", img: "/images/people/wudongli.jpg" }
  ],

  // 4. 硕士生 (Master Students)
  mst: [
    { name: "Junxing Luo", role: "Built environment and infrastructure assessment, human mobility analysis", email: "junxingluo@hkust-gz.edu.cn", homepage: "", img: "/images/people/luojunxing.png" },
    { name: "Mingchen Li", role: "Multi-agent social simulation, time series, computational social science", email: "mli736@hkust-gz.edu.cn", homepage: "", img: "/images/people/limingchen.png" },
    { name: "Tengxi Wang", role: "Remote sensing image analysis, time series analysis, machine learning", email: "twang744@connect.hkust-gz.edu.cn", homepage: "", img: "/images/people/wangtengxi.png" },
    { name: "Yumiao Xiao", role: "Terrestrial carbon cycle, spatio-temporal data analysis, plant ecology", email: "yxiao224@connect.hkust-gz.edu.cn", homepage: "", img: "/images/people/xiaoyusen.png" },
    { name: "Hongrui Xiao", role: "", email: "hxiao246@connect.hkust-gz.edu.cn", homepage: "", img: "" }
  ],

  // 5. 研究助理 (Research Assistants)
  ra: [
    { name: "Wenbo Lv", role: "Spatiotemporal statistics, Remote sensing image processing", email: "lyu.geosocial@gmail.com", homepage: "https://spatlyu.github.io/", img: "/images/people/lvwenbo.png" },
    { name: "Yinrui Ren", role: "Deep learning and remote sensing image analysis", email: "2023025221@m.scnu.edu.com", homepage: "", img: "/images/people/renyanrui.png" },
    { name: "Shuxian Shi", role: "Remote sensing applications and urban environmental monitoring", email: "Shelly-Shi@outlook.comR", homepage: "", img: "/images/people/shishuxian.jpg" },
    { name: "Danyang Zhang", role: "Computer vision; 3DGS; AI for City", email: "zdy@gatech.edu", homepage: "", img: "/images/people/zhangdanyang.png" },
    { name: "Hongye Hou", role: "3D vision, multi-model learning", email: "houhongye2001@stu.xjtu.edu.cn", homepage: "", img: "/images/people/houhongye.jpg" },
    { name: "Xiaoyu Li", role: "UAV remote sensing, environmental monitoring and LULC classification", email: "xiaoyu6936@gmail.com", homepage: "", img: "/images/people/lixiaoyu.png" },
    { name: "Qinghe Liu", role: "Intelligent point cloud processing", email: "liuqinghe@nwafu.edu.cn", homepage: "", img: "/images/people/profile.png" }
  ],

  // 6. 访问学生 (Visiting Students)
  vst: [
    { name: "Bingchen Li", role: "Urban Economics & Regional Economics", email: "bingchen054@gmail.com", homepage: "", img: "/images/people/libingchen.png" },
    
    { name: "Hongyu Ye", role: "Spatial big data applications and 3D city modelling and simulation", email: "jackson513ye@qq.com", homepage: "https://www.redfish.space/", img: "/images/people/yehongyu.jpg" },
    { name: "Haoran Gong", role: "computer vision, point clouds, and 3D reconstruction", email: "gonghr@stu.xjtu.edu.cn", homepage: "", img: "/images/people/gonghaoran.jpg" },
    { name: "Sihan Li", role: "GIS, Information Visualization", email: "15902090311@163.com", homepage: "", img: "/images/people/profile.png" },
    { name: "Xuran Hu", role: "Intelligent interpretation of multimodal remote sensing data", email: "XuRanHu@stu.xidian.edu.cn", homepage: "xuran-hu.github.io", img: "/images/people/huxuran.jpg" }
  ],

  // 7. 访问学者 (Visiting Scholars)
  vsc: [
    { name: "Shaoqing Dai", role: "Spatial-temporal data analysis, geo-health, spatial statistics", email: "dsq1993qingge@163.com", homepage: "https://gisersqdai.top/mycv/", img: "/images/people/DaiShaoQing.png" },
    { name: "Ruqiao Jiang", role: "Big geodata processing", email: "jiangruqiao@gmail.com", homepage: "", img: "/images/people/JiangRuqiao.png" },
    { name: "Xijing Huang", role: "Multi-agent social simulation, Agent-Based Modeling, Computational social science", email: "huangxijing3@foxmail.com", homepage: "", img: "/images/people/huangxijing.jpg" }
  ],

  // 8. 校友 (Alumni)
  alu: [
    { name: "Hongrong Wang", role: "Pre RA, now Studying for Msc in CUHK(Shenzhen)", email: "b1520618977@163.com", homepage: "", img: "/images/people/wanghongrong.png" },
    { name: "Zongrong Li", role: "Pre RA, now Phd at TAMU", email: "zongrongli@hkust-gz.edu.cn", homepage: "https://jasper0122.github.io/", img: "/images/people/Lizongrong.png" },
    { name: "Zhongcheng Hong", role: "Pre RA, now Phd at Auckland University of Technology", email: "Zhongchengh@hkust-gz.edu.cn", homepage: "", img: "/images/people/HongZhongcheng.png" },
    { name: "Ke Xu", role: "Pre RA, now Phd at HKUST", email: "kexu0501@gmail.com", homepage: "", img: "/images/people/xuke.png" },
    { name: "Rui Zhang", role: "Pre RA, now European job-based doctoral program", email: "", homepage: "", img: "/images/people/zhangrui.png" },
    { name: "Guanyu Hou", role: "Pre RA, now Phd at TAMU", email: "houguanyu21@gmail.com", homepage: "", img: "/images/people/houguanyu.png" },
    { name: "Zhiyuan Xu", role: "Pre RA, now Phd at University of Bristol", email: "RenHonglin010407@163.com", homepage: "", img: "/images/people/profile.png" },
    { name: "Juran Zhang", role: "Pre RA, now Working", email: "zhangjurann@gmail.com", homepage: "https://www.linkedin.com/in/juran-zhang", img: "/images/people/profile.png" },
    { name: "Qican Weng", role: "Spatial science, GeoAI, Visualization", email: "626710943@QQ.com", homepage: "", img: "/images/people/profile.png" }
  ]
};
