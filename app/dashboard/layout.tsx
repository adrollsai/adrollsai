import BottomNav from "@/components/BottomNav";
import OrganizationWrapper from "@/components/OrganizationWrapper";
import TopBar from "@/components/TopBar";
import PullToRefresh from "@/components/PullToRefresh";

// NOTE: PushManager removed from here. It is now in Profile Page.

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <OrganizationWrapper>
      <div className="min-h-screen bg-slate-50 relative"> 
        
        {/* Pull To Refresh Wrapper 
            Now wraps the TopBar so it pulls down with the rest of the page 
        */}
        <PullToRefresh>
            {/* Fixed Top Bar (Behaves as fixed when idle, moves when pulled) */}
            <TopBar />

            {/* Main Content Area 
                - pt-16: Pushes content down to clear the TopBar
                - pb-32: Leaves space for BottomNav
            */}
            <div className="pt-16 pb-32">
                {children}
            </div>
        </PullToRefresh>
        
        <BottomNav />
      </div>
    </OrganizationWrapper>
  );
}