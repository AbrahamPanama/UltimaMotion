'use client';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import Header from './header';
import { VideoLibrary } from '../video/video-library';
import { MobileLibrary } from '../video/mobile-library';
import MainControls from '../video/main-controls';
import VideoGrid from '../video/video-grid';
import { useIsMobile } from '@/hooks/use-mobile';

export default function AppLayout() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="flex flex-col h-svh overflow-hidden bg-background">
        <Header showSidebarTrigger={false} />
        <div className="flex-1 flex flex-col p-3 gap-3 overflow-hidden min-h-0">
          <MainControls />
          <VideoGrid />
        </div>
        <MobileLibrary />
      </div>
    );
  }

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
