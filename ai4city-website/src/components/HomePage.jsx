import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

import { MapPin, Mail, Linkedin, Twitter, Github, Menu, X, ChevronDown, ChevronUp, ChevronRight, Calendar, Clock, Video, ArrowRight, Globe, FileText, Database, GraduationCap } from 'lucide-react';
import { FadeInSection } from './FadeInSection';
import { ARTICLE_CONTENT } from '../data/articles';
import { ArticlePage} from '../components/ArticlePage';
import { RESEARCH_FOCUS } from '../data/research_field';
import { HOME_RESOURCES_ITEMS } from '../data/resources_field';

export const HomePage = ({ 
  setPage, 
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // 将文章对象转换为数组
  const allArticles = Object.entries(ARTICLE_CONTENT);
  
  // 切片逻辑：默认只显示前 6 条
  const visibleArticles = isExpanded ? allArticles : allArticles.slice(0, 6);

  return (
    <div className="w-full pb-[240px] bg-white text-black">
      
{/* -----------------------------------------------------------------------------------
网页顶端大图模块样式与逻辑
----------------------------------------------------------------------------------- */}

      {/* 1. Hero Section */}
      <div className="relative w-full h-[320px] md:h-[100vh] bg-gray-900 text-white flex justify-center">
        <video
          className="absolute inset-0 w-full h-full object-cover opacity-30"
          autoPlay loop muted playsInline
        >
          <source src="/3drebuildshort.mp4" type="video/mp4" />
        </video> 
        
        <div className="absolute bottom-16 md:bottom-24 w-full max-w-[1920px] mx-auto z-10 px-6">
          <FadeInSection>
            <h1 className="text-5xl md:text-[81px] font-bold leading-tight mb-8 drop-shadow-2xl">
              AI4CITY LAB
            </h1>
            
            {ARTICLE_CONTENT['urban-science-conference-2026'] && (() => {
              const s = ARTICLE_CONTENT['urban-science-conference-2026'];
              const hasExternal = s.link && s.link.trim();
              const hasInternal = s.body && s.body.length > 0;
              const canClick = hasExternal || hasInternal;

              return (
                <div
                  className={`transition group max-w-3xl ${canClick ? 'cursor-pointer' : 'cursor-default'}`}
                  onClick={() => {
                    if (!canClick) return;
                    if (hasExternal) window.open(s.link, '_blank');
                    else setPage('article', 'urban-science-conference-2026');
                  }}
                >
                  <h2 className="text-xl md:text-2xl font-bold mb-2 text-white">Latest News</h2>
                  <p className="text-lg md:text-xl font-medium leading-snug">{s.title}</p>
                  <div className="flex items-center gap-4 mt-4 text-sm text-gray-300">
                    <span className="flex items-center gap-2"><Calendar size={16}/> {s.date}</span>
                    <span className="flex items-center gap-2"><Clock size={16}/> {s.site || 'HKUST(GZ)'}</span>
                  </div>
                </div>
              );
            })()}
          </FadeInSection>
        </div>
      </div>

      {/* 2. 内容容器 */}

{/* -----------------------------------------------------------------------------------
新闻模块样式与逻辑
----------------------------------------------------------------------------------- */}

      <div className="max-w-[1920px] mx-auto space-y-64 py-24">
        
        {/* --- News & Events 模块 --- */}
        <FadeInSection className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row gap-12 lg:gap-20">
            {/* 左侧标题区域 */}
            <div className="w-full lg:w-1/4 flex-shrink-0">
              <h2 className="text-5xl md:text-7xl font-bold leading-none sticky top-24">
                News <br className="hidden lg:block"/>
                <span className="text-gray-300">&</span> <br className="hidden lg:block"/>
                Events
              </h2>
            </div>
          
            {/* 右侧列表区域 - 滚动列表 + 渐变蒙版 */}
            <div className="w-full lg:w-3/4 flex flex-col">
              {/* 滚动容器：固定最大高度 + 可滚动 + 渐变蒙版 */}
              <div 
                className="relative overflow-y-auto max-h-[600px] pr-2 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent"
                style={{ 
                  // 渐变蒙版背景：底部向上渐变透明，避免内容生硬消失
                  maskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)'
                }}
              >
                {/* 列表内容：保留原有间距和条目样式，取消折叠逻辑 */}
                <div className="flex flex-col gap-2 pb-16"> {/* pb-16 给渐变蒙版留空间 */}
                  {allArticles.map(([id, item]) => { // 直接渲染所有文章，取消 visibleArticles
                    // 跳转逻辑验证：有外部链接 OR 内部文章有正文内容
                    const hasExternalLink = item.link && item.link.trim() !== "";
                    const hasInternalContent = item.body && item.body.length > 0;
                    const canNavigate = hasExternalLink || hasInternalContent;

                    return (
                      <div 
                        key={id} 
                        className={`group relative w-full bg-white border border-gray-100 p-4 md:p-5 transition-all duration-300 
                          ${canNavigate 
                            ? 'hover:border-blue-500 hover:shadow-md cursor-pointer hover:-translate-y-0.5' 
                            : 'cursor-default'
                          }`}
                        onClick={() => {
                          if (!canNavigate) return;
                          if (hasExternalLink) {
                            window.open(item.link, '_blank');
                          } else if (setPage) {
                            setPage('article', id);
                            window.scrollTo(0, 0);
                          }
                        }}
                      >
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                          <div className="flex-1">
                            <p className="text-xs font-semibold text-gray-500 mb-1 tracking-wide">
                              {item.date}
                            </p>
                            <h3 className={`text-base md:text-lg font-semibold leading-snug transition-colors
                              ${canNavigate ? 'group-hover:text-blue-600 text-gray-800' : 'text-gray-800'}
                            `}>
                              {item.title}
                            </h3>
                            
                          </div>

                          {/* 交互提示箭头：仅在可跳转时显示 */}
                          {canNavigate && (
                            <div className="flex md:flex items-center justify-center w-8 h-8 rounded-full bg-gray-50 group-hover:bg-blue-600 transition-colors shrink-0">
                              <ArrowRight size={16} className="text-gray-300 group-hover:text-white transform group-hover:-rotate-45 transition-all duration-300" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            </div>
        </FadeInSection>

        {/* --- 其他模块 (Research, People, Resources) --- */}

{/* -----------------------------------------------------------------------------------
研究领域模块样式与逻辑
----------------------------------------------------------------------------------- */}

        <FadeInSection>
          <h2 className="px-5 text-4xl sm:text-[64px] font-bold mb-6">Research Focus</h2>
          {RESEARCH_FOCUS.map((focus, index) => (
            // 移除 gap, 背景透明/白色 (无底色), 直角
            <div key={focus.id} className={`flex flex-col md:flex-row ${index % 2 !== 0 ? 'md:flex-row-reverse' : ''} gap-0 items-center mb-8 group hover-zoom-container overflow-hidden`}> 
              <div 
                className="w-full md:w-3/4 aspect-[3/2] md:h-[350px] bg-gray-200 overflow-hidden rounded-none relative cursor-pointer" 
                onClick={() => setPage('research')}
              >
                <img 
                  src={focus.img} 
                  className="w-full h-full object-cover hover-zoom-img" 
                  alt={focus.title} 
                />
              </div>
              {/* 文字区域无背景色 bg-white/transparent */}
              <div className="w-full md:w-1/4 p-6 flex flex-col justify-center">
                  <h3 className="text-2xl font-bold mb-4">{focus.title}</h3>
                  <p className="text-lg text-black mb-6 text-left whitespace-pre-line">{focus.desc}</p>
                  <button 
                  onClick={() => {
                    if (focus.link && focus.link.startsWith('http')) {
                      window.open(focus.link, '_blank');  // 外部链接开新标签
                    } else {
                      setPage(focus.link);  // 内部页面路由
                    }
                  }} 
                  className="text-black font-bold hover:underline flex items-center">{focus.example} <ChevronRight size={16}/> </button>
              </div>
            </div>
          ))}
        </FadeInSection>

{/* -----------------------------------------------------------------------------------
团队模块样式与逻辑
----------------------------------------------------------------------------------- */}

        <FadeInSection>
          {/* 移除 gap, 背景透明/白色, 直角 */}
          <div className="flex flex-col md:flex-row gap-0 h-auto overflow-hidden rounded-none">
            <div className="w-full md:w-1/4 pt-0 pr-6 pb-6 pl-6 flex flex-col justify-top">
              <h2 className="px-5 text-4xl sm:text-[64px] font-bold leading-none text-left">People</h2>
              <div className="p-6 flex flex-col justify-center text-left">
                <p className="text-lg lg:text-lg text-black mb-6 text-left">
                  Our team is a diverse and talented group of researchers, including PhD candidates, MPhil students, Research Assistant (RAs), and visiting students from around the world. Each member brings unique expertise and perspectives from varied academic and professional backgrounds, creating a dynamic collaborative environment. Together, we are committed to advancing cutting-edge research in AI-driven urban modeling and making meaningful contributions to sustainable city development.
                </p>
                <button onClick={() => setPage('team')} className="text-black font-bold hover:underline flex items-center">Meet Our Team <ChevronRight size={16}/> </button>
              </div>
            </div>
            <div className="md:w-3/4 aspect-[3/2] md:aspect-auto md:h-[800px] bg-gray-300 relative overflow-hidden hover-zoom-container ">
              <img src="images/people/group.jpg" className="aspect-[1/2] inset-0 w-full h-full object-cover hover-zoom-img " alt="Team" />
            </div>
          </div>
        </FadeInSection>

{/* -----------------------------------------------------------------------------------
资源模块样式与逻辑
----------------------------------------------------------------------------------- */}

        <FadeInSection className="flex flex-col md:flex-row gap-0 lg:gap-0">
          <div className="w-full md:w-1/4">
              <h2 className="px-5 text-4xl sm:text-[64px] font-bold leading-none">Resource <br/>& <br/>Data</h2>
              <button onClick={() => setPage('resources')} className="px-5 mt-6 text-lg font-bold hover:underline flex items-center gap-2">
                  Find something good <ChevronRight size={16}/>
              </button>
          </div>
          <div className="w-full md:w-3/4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-3 gap-6 lg:gap-8">
              {HOME_RESOURCES_ITEMS.map(item => (
                <div 
                    key={item.id} 
                    className="flex flex-col gap-3 group cursor-pointer hover-zoom-container" 
                    onClick={() => {
                        if (item.link) {
                            window.location.href = item.link;  // 如果有链接，跳转到链接
                        } else {
                            setPage('resources');  // 否则返回原本的资源页
                        }
                    }}
                > 
                  
                  {/* 图片容器 */}
                  <div className="aspect-square w-full bg-gray-200 overflow-hidden rounded-none relative">
                    {item.img ? (
                      // --- 方案 A: 如果有图片路径，渲染图片 ---
                      <img 
                        src={item.img} 
                        alt={item.title}
                        className="w-full h-full object-cover hover-zoom-img" 
                      />
                    ) : (
                      // --- 方案 B: 如果没有图片，保留原来的文字占位样式 ---
                      <div className="w-full h-full bg-gray-300 flex items-center justify-center hover-zoom-img text-gray-500 text-center p-4">
                        {item.title}
                      </div>
                    )}
                  </div>

                  <h3 className="font-bold text-xl leading-tight group-hover:text-blue-600">{item.title}</h3>
                </div>
              ))}
          </div>
        </FadeInSection>
      </div>
    </div>
  );
};

export default HomePage;
