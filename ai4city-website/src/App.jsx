import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { HomePage } from './components/HomePage';
import { AboutPage } from './components/AboutPage';
import { Footer } from './components/Footer';
import './index.css';
import { TeamPage } from './components/TeamPage';
import { ResourcesListPage } from './components/ResourcesListPage';
import { RESOURCES_LIST_ITEMS } from './data/resources';
import { PublicationsListPage } from './components/PublicationsListPage';
import { PUBLICATION_ITEMS } from './data/publications';
import { ResearchListPage } from './components/ResearchListPage';
import { ArticlePage } from './components/ArticlePage';
import { DemoPage } from './components/DemoPage';

const ROUTE_PAGES = new Set(['team', 'research', 'demo', 'publication', 'resources', 'about']);

const getInitialPage = () => {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  return ROUTE_PAGES.has(path) ? path : 'home';
};

const getPagePath = (page) => {
  if (page === 'home') return '/';
  return ROUTE_PAGES.has(page) ? `/${page}/` : `/${page}`;
};

export default function App() {
  const [currentPage, setCurrentPage] = useState(getInitialPage);
  const [articleId, setArticleId] = useState(null);
  const [originPage, setOriginPage] = useState('home');

  useEffect(() => {
    const page = getInitialPage();
    window.history.replaceState(
      { page, id: null },
      '',
      getPagePath(page)
    );
  }, []);

  useEffect(() => {
    const handlePopState = (e) => {
      if (e.state?.page) {
        setCurrentPage(e.state.page);
        setArticleId(e.state.id ?? null);
      } else {
        setCurrentPage('home');
      }
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // setPage now accepts an optional second argument: articleId
  const setPage = (page, id = null) => {
  if (page === 'article') setOriginPage(currentPage);
  setCurrentPage(page);
  if (id !== null) setArticleId(id);
  
  // Push a history entry so the browser back button works
  window.history.pushState({ page, id }, '', getPagePath(page));
  window.scrollTo(0, 0);  // 加这一行
  };

  const renderContent = () => {
    switch(currentPage) {
      case 'home':
        return (
          <div className="w-full min-h-screen">
            <HomePage setPage={setPage} />
          </div>
        );
      case 'article':
        return (
          <div className="w-full min-h-screen">
            <ArticlePage articleId={articleId} setPage={setPage} originPage={originPage}/>
          </div>
        );
      case 'team':
        return (
          <div className="pt-[81px] w-full min-h-screen">
            <TeamPage originPage={originPage}/>
          </div>
        );
      case 'research':
        return (
          <div className="pt-[81px] w-full min-h-screen">
            <ResearchListPage
              title="Research"
              description="Ongoing and recent projects across AI-driven urban modeling, spatiotemporal analysis, and built environment understanding."
              items={PUBLICATION_ITEMS}
              type="publication"
              originPage={originPage}
            />
          </div>
        );
      case 'publication':
        return (
          <div className="pt-[81px] w-full min-h-screen">
            <PublicationsListPage
              title="Publications"
              description="Papers from the AI4City Lab."
              items={PUBLICATION_ITEMS}
              type="publication"
              originPage={originPage}
            />
          </div>
        );
      case 'resources':
        return (
          <div className="pt-[81px] w-full min-h-screen">
            <ResourcesListPage
              title="Resource & Data"
              description="Open datasets and tools for urban research."
              items={RESOURCES_LIST_ITEMS}
              type="resources"
              originPage={originPage}
            />
          </div>
        );
      case 'demo':
        return <DemoPage />;
      case 'about':
        return (
          <div className="pt-[81px] w-full min-h-screen">
            <AboutPage originPage={originPage}/>
          </div>
        );
      default:
        return (
          <div className="pt-32 px-6 md:px-20 min-h-screen max-w-7xl mx-auto text-center">
            <h1 className="text-4xl font-bold capitalize mb-6">{currentPage} Page</h1>
            <div className="inline-block p-12 bg-gray-50 rounded-2xl border border-dashed border-gray-300">
              <p className="text-gray-400">Section Under Construction</p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen font-sans bg-white selection:bg-blue-100">
      <Navbar currentPage={currentPage} setPage={setPage} />
      <main className="transition-opacity duration-300">
        {renderContent()}
      </main>
      <Footer currentPage={currentPage} setPage={setPage} />
    </div>
  );
}
