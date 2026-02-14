'use client';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import Header from './header';
import { VideoLibrary } from '../video/video-library';
import MainControls from '../video/main-controls';
import VideoGrid from '../video/video-grid';

export default function AppLayout() {
  return (
    <SidebarProvider>
      <VideoLibrary />
      <SidebarInset className="flex flex-col h-full overflow-hidden">
        <Header />
        <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
          <MainControls />
          <VideoGrid />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
