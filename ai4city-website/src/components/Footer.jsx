import React from 'react';
import { Twitter, Linkedin, Github } from 'lucide-react';
import { NAV_LINKS } from '../data/navigation';

export const Footer = ({ setPage, scrollToAbout }) => {
            const handleNavClick = (id) => {
                if (id === 'about') {
                    scrollToAbout();
                } else {
                    setPage(id);
                }
            };

            {/*页脚容器*/}
            return (
              <footer className="bg-white border-t border-gray-200 pt-20 pb-20 mt-auto">
                <div className="max-w-[1920px] mx-auto px-6 w-full flex flex-col md:flex-row gap-12 md:gap-32">
                  <div className="flex flex-col gap-2 min-w-[130px]">
                    <h4 className="font-semibold text-lg mb-2">Features</h4>
                    {NAV_LINKS.map(link => (
                      <div key={link.id} className="flex flex-col gap-1">
                        <button
                          onClick={() => handleNavClick(link.id)}
                          className="text-left text-gray-500 hover:text-black transition"
                        >
                          {link.label}
                        </button>
                        {link.children && (
                          <div className="flex flex-col gap-1 pl-3">
                            {link.children.map(child => (
                              <button
                                key={child.id}
                                onClick={() => handleNavClick(child.id)}
                                className="text-left text-sm text-gray-400 hover:text-black transition"
                              >
                                {child.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col gap-8 flex-1">
                    <div>
                      <h3 className="font-semibold text-2xl mb-2">AI4DCity</h3>
                      <p className="text-gray-500">Pioneering AI-based processing strategies for sustainable urban development.</p>
                    </div>
                    <div className="flex gap-4">
                      <a
                          href="https://x.com/ai4citylab"
                          target="_blank"
                          rel="noreferrer"
                        >
                        <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center text-white hover:bg-blue-600 cursor-pointer transition"><Twitter size={16}/></div>
                      </a>
                      <a
                          href="https://www.linkedin.com/in/wufan-zhao"
                          target="_blank"
                          rel="noreferrer"
                        >
                        <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center text-white hover:bg-blue-700 cursor-pointer transition"><Linkedin size={16}/></div>
                      </a>
                      <a
                          href="https://github.com/ai4city-hkust"
                          target="_blank"
                          rel="noreferrer"
                        >

                        <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center text-white hover:bg-gray-800 cursor-pointer transition"><Github size={16}/></div>
                      </a>
                    </div>
                  </div>
                </div>
              </footer>
            );
        };
