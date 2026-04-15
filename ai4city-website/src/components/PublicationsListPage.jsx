import React, { useState, useMemo } from 'react';
import { FadeInSection } from './FadeInSection';

export const PublicationsListPage = ({ title, description, items, type = 'default' }) => {
  const [selectedYear, setSelectedYear]   = useState('All');
  const [selectedTopic, setSelectedTopic] = useState('All');

  const { years, topics } = useMemo(() => {
    const uniqueYears = [
      ...new Set(items.map((i) => String(i.year ?? '')).filter(Boolean)),
    ].sort((a, b) => b - a);
    const uniqueTopics = [...new Set(items.map((i) => i.topic).filter(Boolean))];
    return { years: ['All', ...uniqueYears], topics: ['All', ...uniqueTopics] };
  }, [items]);

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const matchYear  = selectedYear  === 'All' || String(item.year ?? '') === selectedYear;
        const matchTopic = selectedTopic === 'All' || item.topic === selectedTopic;
        return matchYear && matchTopic;
      }),
    [items, selectedYear, selectedTopic],
  );

  return (
    <div className="pt-[81px] w-full min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-16">

        <h1 className="text-4xl md:text-6xl font-bold mb-4">{title}</h1>
        <p className="text-gray-500 mb-12">{description}</p>

        {/* Topic filter */}
        {topics.length > 1 && (
          <div className="flex flex-wrap gap-x-8 gap-y-3 mb-8 items-center">
            {topics.map((topic) => (
              <button
                key={topic}
                onClick={() => setSelectedTopic(topic)}
                className={`text-base transition-colors duration-200 ${
                  selectedTopic === topic
                    ? 'font-bold text-black'
                    : 'font-medium text-gray-500 hover:text-gray-800'
                }`}
              >
                {topic}
              </button>
            ))}
          </div>
        )}

        {/* Year filter */}
        {years.length > 1 && (
          <div className="w-full border-b border-gray-200 mb-12">
            <div className="flex flex-wrap gap-x-8">
              {years.map((year) => (
                <button
                  key={year}
                  onClick={() => setSelectedYear(year)}
                  className={`pb-3 text-base font-medium transition-all relative ${
                    selectedYear === year ? 'text-black' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {year}
                  {selectedYear === year && (
                    <div className="absolute bottom-0 left-0 w-full h-[2px] bg-orange-500 translate-y-[1px]" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Card list */}
        <div className="flex flex-col gap-4">
          {filteredItems.length > 0 ? (
            filteredItems.map((item) => {
              const hasLink      = Boolean(item.link && item.link.trim());
              const hasWechat    = Boolean(item.wechatLink && item.wechatLink.trim());
              const hasProject   = Boolean(item.projectLink && item.projectLink.trim());
              const hasExtraLinks = hasWechat || hasProject;

              const inner = (
                <div className={`w-full p-6 md:p-8 flex flex-col gap-2${hasLink ? ' group' : ''}`}>
                  {/* Topic + year badges */}
                  <div className="flex gap-2 text-xs font-bold uppercase tracking-wider text-orange-600">
                    {item.topic && <span>{item.topic}</span>}
                    {item.topic && item.year && <span>•</span>}
                    {item.year  && <span>{item.year}</span>}
                  </div>

                  {/* Title */}
                  <h2 className={`text-lg md:text-xl font-bold leading-snug${
                    hasLink ? ' group-hover:text-blue-600 transition-colors duration-200' : ' text-gray-800'
                  }`}>
                    {item.title}
                  </h2>

                  {/* Abstract */}
                  {item.desc && item.desc.trim() && (
                    <p className="text-sm text-gray-600 leading-relaxed text-justify mt-1">
                      {item.desc.trim()}
                    </p>
                  )}

                  {/* Venue / date */}
                  {item.date && item.date.trim() && (
                    <p className="text-xs text-gray-400 mt-1">{item.date.trim()}</p>
                  )}

                  {/* ── Extra links row (WeChat / Project homepage) ── */}
                  {hasExtraLinks && (
                    <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100">
                      <span className="text-xs text-gray-400 font-medium">Also available:</span>
                      {hasWechat && (
                        <a
                          href={item.wechatLink}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded-full px-3 py-1 transition-colors duration-150"
                        >
                          {/* WeChat icon (SVG) */}
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c-.303-.474-.474-.997-.474-1.542 0-3.154 3.136-5.711 7.004-5.711.05 0 .1.003.149.003C14.923 6.195 12.051 2.188 8.691 2.188zm-2.374 3.47a.875.875 0 1 1 0 1.75.875.875 0 0 1 0-1.75zm4.748 0a.875.875 0 1 1 0 1.75.875.875 0 0 1 0-1.75zM24 14.465c0-3.154-3.136-5.711-7.004-5.711S10 11.311 10 14.465c0 3.155 3.136 5.711 7.004 5.711.868 0 1.698-.126 2.467-.354a.682.682 0 0 1 .574.079l1.521.89a.26.26 0 0 0 .133.043.236.236 0 0 0 .234-.236c0-.058-.023-.115-.038-.172l-.312-1.183a.473.473 0 0 1 .17-.533C23.032 17.98 24 16.32 24 14.465zm-9.195-1.001a.7.7 0 1 1 0-1.4.7.7 0 0 1 0 1.4zm4.39 0a.7.7 0 1 1 0-1.4.7.7 0 0 1 0 1.4z"/>
                          </svg>
                          微信推文
                        </a>
                      )}
                      {hasProject && (
                        <a
                          href={item.projectLink}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-full px-3 py-1 transition-colors duration-150"
                        >
                          {/* Globe icon */}
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="2" y1="12" x2="22" y2="12"/>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                          </svg>
                          项目主页
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );

              return (
                <FadeInSection key={item.id}>
                  {hasLink ? (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                      className="block bg-white border border-gray-200 rounded-2xl hover:shadow-lg hover:border-gray-400 transition-all duration-200"
                    >
                      {inner}
                    </a>
                  ) : (
                    <div className="bg-white border border-gray-100 rounded-2xl cursor-default">
                      {inner}
                    </div>
                  )}
                </FadeInSection>
              );
            })
          ) : (
            <div className="py-20 text-center text-gray-400">
              No items found matching the selected filters.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};