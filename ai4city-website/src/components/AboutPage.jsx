import React from 'react';
import { MapPin, Mail, Linkedin, Twitter, Github, Menu, X, ChevronRight, Calendar, Clock, Video, ArrowRight, Globe, FileText, Database, GraduationCap } from 'lucide-react';
import { FadeInSection } from './FadeInSection';

export const AboutPage = (originPage = 'home') => {
            return (
                <div className="pt-[81px] w-full min-h-screen bg-white">
                    
                    <div className="max-w-7xl mx-auto px-6 py-16">
                        
                        {/* =========================================
                            1. 顶部区域：标题 + 纯文字介绍 + 大图
                          ========================================= */}
                        <FadeInSection>
                            <h1 className="text-5xl md:text-6xl font-bold mb-10">About Us</h1>
                            
                            {/* 实验室介绍文本 */}
                            <div className="w-full mb-24 text-lg text-gray-700 leading-relaxed space-y-6 gap-12  text-justify">
                                <div>
                                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                                  <a 
                                    href="https://www.hkust-gz.edu.cn/zh/?variant=zh-cn/" 
                                    target="_blank" 
                                    rel="noreferrer" 
                                    className="hover:text-blue-600 transition-colors"
                                >
                                    HKUST (Guangzhou) Introduction
                                </a>
                                </h2> 
                                <p> HKUST (Guangzhou) Introduction
                                    Hong Kong University of Science and Technology (Guangzhou) is a cooperation university between the Mainland and Hong Kong approved by the Ministry of Education. It was formally established in June 2022. HKUST (Guangzhou) is committed to innovation, featuring interdisciplinary development, and exploring innovative talent cultivation models. Its mission is to become a paradigm for the integration and development of Mainland and Hong Kong education and an internationally renowned, high-level university dedicated to cultivating high-level, innovative talents for the future.
                                </p>
                                </div>
                                <div>
                                <h2 className="text-3xl font-bold text-gray-900 mb-4">AI 4D City (AI4CITY) Lab</h2>
                                <p>
                                    4D refers to 3D space plus time series modeling. As the type and density of the remote sensing data continue to grow exponentially, 
                                    Dr. Wufan Zhao and his AI4City Lab aim to help pioneer computationally efficient AI-based processing and modeling strategies 
                                    to solve complex and practical urban problems by integrating the multi-dimensional/modal characteristics of big earth observation data.
                                </p>
                                </div>
                                {/* 招生信息高亮框 */}
                                <div className="p-6 bg-blue-50 border-l-4 border-blue-600 rounded-r-xl">
                                    <p className="font-bold text-blue-900 mb-2">🚀 Openings</p>
                                    <p className="text-base text-blue-800">
                                        Long-term openings for RA and PhD positions in the Lab. Applications are welcome, students with a master’s degree background are preferred. 
                                        PhD students will be admitted in January and September each year.
                                        <br/><br/>
                                        Undergraduate students are encouraged to apply for the <a href="https://www.hkust-gz.edu.cn/academics/education-innovation/red-bird-mphil-program/" target="_blank" rel="noreferrer" className="underline hover:text-blue-600 font-bold">RedBird MPhil of HKUST-gz</a>. <br/><br/>
                                        You can also <a href="https://www.hkust-gz.edu.cn/academics/education-innovation/red-bird-mphil-program/" target="_blank" rel="noreferrer" className="underline hover:text-blue-600 font-bold"> explore more about our lab recruitment</a>. 
                                    </p>
                                </div>
                            </div>

                            
                        </FadeInSection>
                        {/* 研究方向大图 */}
                        <div className="w-full mb-24">
                            <div className="w-full bg-gray-50 rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
                                <img src="images/frontPage/research-field.jpg" className="w-full h-auto object-cover" alt="Research Diagram" />
                            </div>
                            <p className="text-center text-sm text-gray-400 mt-3 italic">Overview of AI4City Lab Research Framework</p>
                        </div>

                        {/* =========================================
                             联系与社交链接 (5个独立卡片)
                            ========================================= */}
                          <div className="mb-24">
                              <h2 className="text-3xl font-bold mb-8">Contact & Connect</h2>
                              
                              {/* Grid 布局：手机1列，中屏及以上5列 */}
                              <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                                  
                                  {/* --- 卡片 1: Email --- */}
                                  <FadeInSection className="bg-white border border-gray-200 p-6 rounded-2xl hover:shadow-xl transition-all duration-300 group flex flex-col items-center text-center h-full">
                                      {/* 链接挂在图标容器上 */}
                                      <a href="mailto:wufanzhao@hkust-gz.edu.cn" className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 mb-4 group-hover:bg-blue-600 group-hover:text-white transition-colors duration-300 cursor-pointer">
                                          <Mail size={32} />
                                      </a>
                                      <h3 className="text-lg font-bold mb-2">Email Us</h3>
                                      <p className="text-gray-500 text-sm">
                                          For research inquiries and applications.
                                      </p>
                                  </FadeInSection>

                                  {/* --- 卡片 2: Location --- */}
                                  <FadeInSection className="bg-white border border-gray-200 p-6 rounded-2xl hover:shadow-xl transition-all duration-300 group flex flex-col items-center text-center h-full">
                                      <a href="https://www.openstreetmap.org/?#map=17/22.891298/113.476131&layers=N" target="_blank" rel="noreferrer" className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center text-green-600 mb-4 group-hover:bg-green-600 group-hover:text-white transition-colors duration-300 cursor-pointer">
                                          <MapPin size={32} />
                                      </a>
                                      <h3 className="text-lg font-bold mb-2">Visit Us</h3>
                                      <p className="text-gray-500 text-sm">
                                          HKUST(GZ) Campus, E1 Bldg, L4 408.
                                      </p>
                                  </FadeInSection>

                                  {/* --- 卡片 3: Github --- */}
                                  <FadeInSection className="bg-white border border-gray-200 p-6 rounded-2xl hover:shadow-xl transition-all duration-300 group flex flex-col items-center text-center h-full">
                                      <a href="https://github.com/ai4city-hkust" target="_blank" rel="noreferrer" className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center text-gray-700 mb-4 group-hover:bg-gray-800 group-hover:text-white transition-colors duration-300 cursor-pointer">
                                          <Github size={32} />
                                      </a>
                                      <h3 className="text-lg font-bold mb-2">Github</h3>
                                      <p className="text-gray-500 text-sm">
                                          Explore our open-source code & projects.
                                      </p>
                                  </FadeInSection>

                                  {/* --- 卡片 4: Google Scholar --- */}
                                  <FadeInSection className="bg-white border border-gray-200 p-6 rounded-2xl hover:shadow-xl transition-all duration-300 group flex flex-col items-center text-center h-full">
                                      <a href="https://scholar.google.com/citations?user=SE267o4AAAAJ" target="_blank" rel="noreferrer" className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-600 mb-4 group-hover:bg-red-600 group-hover:text-white transition-colors duration-300 cursor-pointer">
                                          {/* 使用 Globe 图标代替 Scholar，或者用首字母 G */}
                                          <GraduationCap size={32} /> 
                                      </a>
                                      <h3 className="text-lg font-bold mb-2">Google Scholar</h3>
                                      <p className="text-gray-500 text-sm">
                                          Read our latest research publications.
                                      </p>
                                  </FadeInSection>

                                  {/* --- 卡片 5: LinkedIn --- */}
                                  <FadeInSection className="bg-white border border-gray-200 p-6 rounded-2xl hover:shadow-xl transition-all duration-300 group flex flex-col items-center text-center h-full">
                                      <a href="https://www.linkedin.com/in/wufan-zhao/" target="_blank" rel="noreferrer" className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-700 mb-4 group-hover:bg-blue-700 group-hover:text-white transition-colors duration-300 cursor-pointer">
                                          <Linkedin size={32} />
                                      </a>
                                      <h3 className="text-lg font-bold mb-2">LinkedIn</h3>
                                      <p className="text-gray-500 text-sm">
                                          Connect with Dr. Wufan Zhao.
                                      </p>
                                  </FadeInSection>

                              </div>
                          </div>
                        
                    </div>
                </div>
            );
        };