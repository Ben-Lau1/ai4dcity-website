import React from 'react';
import { ExternalLink, Maximize2 } from 'lucide-react';

const VIEWER_URL = '/lccviewer/index.html';

export const DemoPage = () => {
  return (
    <div className="pt-[81px] min-h-screen bg-zinc-950 text-white">
      <section className="min-h-[calc(100vh-81px)] flex flex-col">
        <div className="border-b border-white/10 bg-zinc-950/95">
          <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">Interactive Demo</p>
              <h1 className="mt-1 text-2xl md:text-3xl font-bold">LCCViewer</h1>
              <p className="mt-2 max-w-3xl text-sm md:text-base text-zinc-300">
                Explore large-scale 3D city scenes directly inside the AI4DCity website.
              </p>
            </div>

            <a
              href={VIEWER_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-100"
            >
              <Maximize2 size={18} />
              Open Viewer
              <ExternalLink size={16} />
            </a>
          </div>
        </div>

        <div className="flex-1 min-h-[620px] bg-black">
          <iframe
            src={VIEWER_URL}
            title="LCCViewer"
            className="block h-full min-h-[620px] w-full border-0"
            allow="fullscreen; autoplay; xr-spatial-tracking"
            allowFullScreen
          />
        </div>
      </section>
    </div>
  );
};
