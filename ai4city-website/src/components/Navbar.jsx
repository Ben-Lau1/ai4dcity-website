import React, { useState, useEffect } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import { NAV_LINKS, LOGO_CONFIG } from '../data/navigation';

export const Navbar = ({ currentPage, setPage}) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // 降低阈值，确保滚动瞬间就能触发颜色变化
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 核心逻辑：只有在首页且未滚动时，导航栏才显示为透明
  const isHome = currentPage === 'home';
  const shouldBeTransparent = isHome && !isScrolled;

  /**
   * 样式说明：
   * 1. 透明状态下：无背景，无边框，文字为纯白 (text-white)
   * 2. 滚动或非首页状态下：白背景 (bg-white/95)，带模糊感 (backdrop-blur)，文字为黑 (text-black)
   */
  const navClass = `fixed top-0 left-0 w-full z-50 transition-all duration-500 border-b ${
    shouldBeTransparent 
      ? 'bg-transparent border-transparent text-white' 
      : 'bg-white/95 backdrop-blur-md border-gray-200 text-black shadow-sm'
  }`;

  const handleNavClick = (id) => {
    setPage(id);
    setIsMenuOpen(false);
    window.scrollTo(0, 0);
  };

  const isLinkActive = (link) => (
    currentPage === link.id || link.children?.some(child => currentPage === child.id)
  );

  return (
    <nav className={navClass}>
      <div className="max-w-[1920px] mx-auto px-6 w-full h-[81px] flex justify-between items-center">
        {/* 实验室 Logo */}
        <div
          className={`w-[60px] h-[60px] bg-cover bg-center rounded-full cursor-pointer hover:opacity-80 transition-all duration-300 shadow-sm ${
            shouldBeTransparent ? 'ring-2 ring-white/20' : ''
          }`}
          style={{ backgroundImage: "url('/images/frontPage/logo.png')" }}
          onClick={() => handleNavClick('home')}
        />

        {/* 桌面端菜单 */}
        <ul className="max-w-7xl hidden lg:flex items-center gap-8">
          {NAV_LINKS.map(link => (
            <li key={link.id} className="group relative">
              <button
                onClick={() => handleNavClick(link.id)}
                className={`flex items-center gap-1 text-lg font-medium hover:opacity-70 capitalize transition-colors ${
                  !shouldBeTransparent && isLinkActive(link) ? 'text-blue-600 font-bold' : ''
                }`}
              >
                <span>{link.label}</span>
                {link.children && <ChevronDown size={16} className="mt-0.5 transition-transform group-hover:rotate-180" />}
              </button>
              {link.children && (
                <div className="invisible absolute left-1/2 top-full z-50 min-w-48 -translate-x-1/2 pt-4 opacity-0 transition-all duration-200 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                  <div className="rounded-lg border border-gray-200 bg-white py-2 text-black shadow-lg">
                    {link.children.map(child => (
                      <button
                        key={child.id}
                        onClick={() => handleNavClick(child.id)}
                        className={`block w-full px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-gray-50 ${
                          currentPage === child.id ? 'text-blue-600' : 'text-gray-700'
                        }`}
                      >
                        {child.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {/* 学校 Logo 区域 */}
        <div className="flex items-center gap-4">
          <a href="https://www.hkust-gz.edu.cn/" target="_blank" rel="noreferrer" className="hidden sm:block">
            <div
              className={`w-[200px] h-[80px] bg-contain bg-no-repeat bg-center transition-all duration-500 ${
                shouldBeTransparent ? 'brightness-0 invert' : '' 
              }`}
              style={{ backgroundImage: "url('/images/frontPage/logo-e-black-2x.png')" }}
            />
          </a>
          
          {/* 移动端汉堡菜单按钮 */}
          <button 
            className="lg:hidden p-2 rounded-full hover:bg-black/5 transition-colors" 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X size={28} /> : <Menu size={28} />}
          </button>
        </div>
      </div>

      {/* 移动端侧边菜单容器 */}
      {isMenuOpen && (
        <div className="lg:hidden absolute top-[81px] left-0 w-full bg-white shadow-2xl border-t border-gray-100 p-6 flex flex-col gap-4 text-black animate-in fade-in slide-in-from-top-2 duration-300">
          {NAV_LINKS.map(link => (
            <div key={link.id} className="border-b border-gray-50 last:border-0">
              <button
                onClick={() => handleNavClick(link.id)}
                className={`w-full text-left py-4 text-xl font-medium ${
                  isLinkActive(link) ? 'text-blue-600 font-bold' : 'text-gray-800'
                }`}
              >
                {link.label}
              </button>
              {link.children && (
                <div className="pb-3 pl-4">
                  {link.children.map(child => (
                    <button
                      key={child.id}
                      onClick={() => handleNavClick(child.id)}
                      className={`block w-full py-2 text-left text-base font-medium ${
                        currentPage === child.id ? 'text-blue-600' : 'text-gray-500'
                      }`}
                    >
                      {child.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </nav>
  );
};
