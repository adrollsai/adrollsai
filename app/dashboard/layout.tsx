import BottomNav from "@/components/BottomNav";
import OrganizationWrapper from "@/components/OrganizationWrapper";
import TopBar from "@/components/TopBar";

// NOTE: PullToRefresh removed.
// NOTE: PushManager removed from here. It is now in Profile Page.

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <OrganizationWrapper>
      <div className="min-h-screen bg-slate-50 relative"> 
        
        {/* Fixed Top Bar */}
        <TopBar />

        {/* Main Content Area 
            - pt-16: Pushes content down to clear the TopBar
            - pb-32: Leaves space for BottomNav
        */}
        <div className="pt-16 pb-32">
            {children}
        </div>
        
        <BottomNav />
      </div>
    </OrganizationWrapper>
  );
}