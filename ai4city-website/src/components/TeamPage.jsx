import React from 'react';
import { Mail, Linkedin, GraduationCap, MapPin } from 'lucide-react';
import { TEAM_DATA } from '../data/team';
import { FadeInSection } from './FadeInSection';

/**
 * 内部小组件：成员卡片
 * 复刻老页面的视觉效果：边框颜色、悬停阴影及上浮位移
 */
const MemberCard = ({ member, isAlumni = false }) => (
  <FadeInSection className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col items-center text-center hover:shadow-xl transition duration-300 transform hover:-translate-y-1 group">
    {!isAlumni && (
      <div className="w-32 h-32 rounded-full overflow-hidden mb-4 bg-gray-100 shadow-sm border-4 border-white">
        <img 
          src={member.img || '/images/people/profile.png'} 
          alt={member.name} 
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" 
          onError={(e) => { e.target.src = '/images/people/profile.png'; }}
        />
      </div>
    )}
    
    {member.homepage ? (
      <a 
        href={member.homepage} 
        target="_blank" 
        rel="noreferrer" 
        className="font-bold text-lg text-gray-900 hover:text-blue-600 transition-colors"
      >
        {member.name}
      </a>
    ) : (
      <span className="font-bold text-lg text-gray-800">{member.name}</span>
    )}
    
    <p className="text-xs font-medium text-gray-500 tracking-wide mt-1 mb-3 min-h-[32px]">
      {member.role}
    </p>
    
    {member.email && (
      <a href={`mailto:${member.email}`} className="text-xs text-blue-500 flex items-center gap-1 hover:underline">
        <Mail size={12} /> {member.email}
      </a>
    )}
  </FadeInSection>
);

const SectionTitle = ({ children }) => (
  <h2 className="text-2xl md:text-3xl font-bold mb-8 pl-4 border-l-4 border-black">{children}</h2>
);

const AlumniRow = ({ member }) => (
  <FadeInSection className="border-b border-gray-200 last:border-b-0">
    <div className="grid grid-cols-1 md:grid-cols-[minmax(160px,0.8fr)_minmax(0,2fr)_minmax(180px,0.9fr)] gap-2 md:gap-6 items-start py-4 md:py-5">
      <div className="min-w-0">
        {member.homepage ? (
          <a
            href={member.homepage}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-gray-900 hover:text-blue-600 transition-colors"
          >
            {member.name}
          </a>
        ) : (
          <span className="font-semibold text-gray-900">{member.name}</span>
        )}
      </div>

      <p className="text-sm text-gray-600 leading-relaxed">{member.role}</p>

      <div className="min-w-0 flex md:justify-end">
        {member.email ? (
          <a
            href={`mailto:${member.email}`}
            className="text-sm text-blue-500 flex items-center gap-1.5 hover:underline min-w-0"
          >
            <Mail size={14} className="shrink-0" />
            <span className="truncate">{member.email}</span>
          </a>
        ) : (
          <span className="hidden md:block text-sm text-gray-300">-</span>
        )}
      </div>
    </div>
  </FadeInSection>
);

/**
 * 团队页面组件
 * 已同步老页面的 PI 侧边吸顶布局和联系方式样式
 */
export const TeamPage = () => {
  // 关键：解构键名必须与 src/data/team.js 中的 export 完全一致
  const { pi, postphd, phd, mst, ra, vst, vsc, alu } = TEAM_DATA;

  return (
    <div className="pt-[81px] w-full min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <FadeInSection>
          <h1 className="text-5xl md:text-6xl font-bold mb-12 md:mb-16 text-black">Meet our team</h1>
        </FadeInSection>

        {/* PI Section: 完整复刻老页面的 bg-slate-100 与 sticky 布局 */}
        {pi && (
          <div className="w-full bg-slate-100 p-6 md:p-12 flex flex-col md:flex-row gap-8 md:gap-16 mb-20 rounded-3xl border border-slate-200">
            {/* 左侧：照片和联系方式 (支持 md:sticky 吸顶) */}
            <div className="w-full md:w-1/3 flex flex-col items-center md:items-start md:sticky md:top-24 h-fit">
              <img 
                src={pi.img} 
                alt={pi.name} 
                className="w-48 h-48 md:w-64 md:h-64 lg:w-80 lg:h-80 mb-8 rounded-full object-cover shadow-lg border-4 border-white" 
                onError={(e) => { e.target.src = '/images/people/profile.png'; }}
              />
              
              <div className="w-full overflow-hidden">
                <div className="px-2 py-4">
                  <h4 className="text-lg font-bold text-gray-700 border-b border-gray-200 pb-2">Contact Info</h4>
                </div>
                <div className="flex flex-col gap-1">
                  {/* Email */}
                  <a href={`mailto:${pi.contact?.email || 'wufanzhao@hkust-gz.edu.cn'}`} className="flex items-center gap-4 p-2 rounded-lg hover:bg-white transition-colors group">
                    <div className="text-gray-400 group-hover:text-blue-600"><Mail size={20} /></div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Email</span>
                      <span className="text-sm font-medium text-gray-700 group-hover:text-blue-600 truncate">wufanzhao@hkust-gz.edu.cn</span>
                    </div>
                  </a>
                  {/* Office */}
                  <div className="flex items-center gap-4 p-2 rounded-lg group">
                    <div className="text-gray-400"><MapPin size={20} /></div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Office</span>
                      <span className="text-sm font-medium text-gray-700">HKUST(GZ) E1 L4 408</span>
                    </div>
                  </div>
                  {/* LinkedIn */}
                  <a href="https://www.linkedin.com/in/wufan-zhao/" target="_blank" rel="noreferrer" className="flex items-center gap-4 p-2 rounded-lg hover:bg-white transition-colors group">
                    <div className="text-gray-400 group-hover:text-blue-700"><Linkedin size={20} /></div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">LinkedIn</span>
                      <span className="text-sm font-medium text-gray-700 group-hover:text-blue-700">Wufan Zhao</span>
                    </div>
                  </a>
                  {/* Scholar */}
                  <a href="https://scholar.google.com/citations?user=SE267o4AAAAJ" target="_blank" rel="noreferrer" className="flex items-center gap-4 p-2 rounded-lg hover:bg-white transition-colors group">
                    <div className="text-gray-400 group-hover:text-blue-600"><GraduationCap size={20} /></div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Google Scholar</span>
                      <span className="text-sm font-medium text-gray-700 group-hover:text-blue-600">Wufan Zhao</span>
                    </div>
                  </a>
                </div>
              </div>
            </div>

            {/* 右侧：文字与经历 */}
            <div className="w-full md:flex-1 text-black">
              <h2 className="text-3xl md:text-4xl font-bold mb-1">{pi.name}</h2>
              <p className="text-lg text-blue-600 font-medium mb-6">{pi.role}</p>
              <p className="text-md text-gray-700 leading-relaxed text-justify whitespace-pre-line mb-19
            [&_a]:text-blue-600 [&_a]:text-blue-600 [&_a:hover]:no-underline">{pi.bio}</p>
              
              <div className="space-y-8">
                <div>
                  <h3 className="text-2xl font-bold mb-4 pt-6 border-t border-gray-200">Service</h3>
                  <ul className="list-disc pl-6 space-y-2 text-gray-700">
                    {pi.edu && pi.edu.map((item, index) => <li key={index} className="text-sm leading-relaxed">{item}</li>)}
                  </ul>
                </div>
                <div>
                  <h3 className="text-2xl font-bold mb-4 pt-6 border-t border-gray-200">Teaching</h3>
                  <ul className="list-disc pl-6 space-y-2 text-gray-700">
                    {pi.Awards && pi.Awards.map((item, index) => <li key={index} className="text-sm leading-relaxed">{item}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 成员分类渲染: 完整复刻老页面的 Section 分类与 Grid 布局 */}
        {[
          { title: "Postdoc Researchers", data: postphd },
          { title: "Ph.D. Students", data: phd },
          { title: "Master Students", data: mst },
          { title: "Research Assistants", data: ra },
          { title: "Visiting Students", data: vst },
          { title: "Visiting Scholars", data: vsc },
        ].map(section => section.data && section.data.length > 0 && (
          <div key={section.title} className="mb-20">
            <SectionTitle>{section.title}</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
              {section.data.map((member, i) => <MemberCard key={i} member={member} />)}
            </div>
          </div>
        ))}

        {/* Alumni Section: 校友默认不显示头像 */}
        {alu && alu.length > 0 && (
          <div className="mb-20">
            <SectionTitle>Alumni</SectionTitle>
            <div className="border-t border-gray-200">
              {alu.map((member) => <AlumniRow key={member.name} member={member} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
