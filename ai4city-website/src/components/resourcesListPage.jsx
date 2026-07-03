import React, { useState, useMemo } from 'react';
import { Database } from 'lucide-react';
import { FadeInSection } from './FadeInSection';

const RESOURCE_TYPES = ['All', 'Demo', 'Dataset', 'Open Package', 'Code(Github)'];

export const ResourcesListPage = ({ title, description, items }) => {
  const [selectedType,  setSelectedType]  = useState('All');
  const [selectedTopic, setSelectedTopic] = useState('All');
  const [selectedYear,  setSelectedYear]  = useState('All');

  const { years, topics } = useMemo(() => {
    const uniqueYears = [
      ...new Set(items.map(i => String(i.year ?? '')).filter(Boolean)),
    ].sort((a, b) => b - a);
    const uniqueTopics = [...new Set(items.map(i => i.topic).filter(Boolean))];
    return { years: ['All', ...uniqueYears], topics: ['All', ...uniqueTopics] };
  }, [items]);

  const filteredItems = useMemo(() =>
    items.filter(item => {
      const matchType  = selectedType  === 'All' || item.resourceType === selectedType;
      const matchTopic = selectedTopic === 'All' || item.topic === selectedTopic;
      const matchYear  = selectedYear  === 'All' || String(item.year ?? '') === selectedYear;
      return matchType && matchTopic && matchYear;
    }),
  [items, selectedType, selectedTopic, selectedYear]);

  const FilterBtn = ({ label, active, onClick }) => (
    <button
      onClick={onClick}
      className={`text-base transition-colors duration-200 ${
        active ? 'font-bold text-black' : 'font-medium text-gray-500 hover:text-gray-800'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="pt-[81px] w-full min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <h1 className="text-4xl md:text-6xl font-bold mb-4">{title}</h1>
        <p className="text-gray-500 mb-12">{description}</p>

        {/* ── Resource Type filter (always shown) ── */}
        <div className="flex flex-wrap gap-x-8 gap-y-3 mb-8 items-center">
          {RESOURCE_TYPES.map(t => (
            <FilterBtn
              key={t}
              label={t}
              active={selectedType === t}
              onClick={() => setSelectedType(t)}
            />
          ))}
        </div>

        {/* ── Topic filter (only if topics exist) ── */}
        {topics.length > 1 && (
          <div className="flex flex-wrap gap-x-8 gap-y-3 mb-8 items-center">
            {topics.map(t => (
              <FilterBtn
                key={t}
                label={t}
                active={selectedTopic === t}
                onClick={() => setSelectedTopic(t)}
              />
            ))}
          </div>
        )}

        {/* ── Year filter ── */}
        {years.length > 1 && (
          <div className="w-full border-b border-gray-200 mb-12">
            <div className="flex flex-wrap gap-x-8">
              {years.map(year => (
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

        {/* ── Cards ── */}
        <div className="flex flex-col gap-8">
          {filteredItems.length > 0 ? (
            filteredItems.map(item => (
              <FadeInSection
                key={item.id}
                className="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row gap-6 md:gap-8 hover:shadow-xl transition-shadow duration-300"
              >
                {/* Text */}
                <div className="flex-1 flex flex-col justify-center order-2 md:order-1">
                  <div className="mb-2 flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wider text-orange-600">
                    {item.resourceType && <span>{item.resourceType}</span>}
                    {item.resourceType && (item.topic || item.year) && <span>•</span>}
                    {item.topic && <span>{item.topic}</span>}
                    {item.topic && item.year && <span>•</span>}
                    {item.year && <span>{item.year}</span>}
                  </div>

                  <a
                    href={item.link}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-blue-600 transition-colors duration-300 block w-fit"
                  >
                    <h2 className="text-xl md:text-2xl font-bold mb-4">{item.title}</h2>
                  </a>

                  <p className="text-sm md:text-base text-gray-600 mb-4 leading-relaxed text-justify whitespace-pre-line">
                    {item.desc}
                  </p>

                  <div className="mt-auto pt-4 border-t border-gray-100 text-sm text-gray-400">
                    {item.date}
                  </div>
                </div>

                {/* Media */}
                <div className="w-full md:w-1/3 aspect-video md:h-[250px] flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden order-1 md:order-2">
                  {item.mediaType === 'video' && item.mediaContent ? (
                    <video
                      className="w-full h-full object-cover bg-black"
                      controls
                      muted
                      playsInline
                      preload="metadata"
                    >
                      <source src={item.mediaContent} type="video/mp4" />
                    </video>
                  ) : item.mediaContent ? (
                    <a href={item.link} target="_blank" rel="noreferrer" className="block w-full h-full">
                      <img
                        src={item.mediaContent}
                        alt={item.title}
                        className="w-full h-full object-cover hover:scale-105 transition duration-500"
                      />
                    </a>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-400">
                      <Database size={48} />
                    </div>
                  )}
                </div>
              </FadeInSection>
            ))
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
