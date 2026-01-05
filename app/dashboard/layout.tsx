import BottomNav from "@/components/BottomNav";
import OrganizationWrapper from "@/components/OrganizationWrapper";
import WalletHeader from "@/components/WalletHeader"; 
import NotificationSystem from "@/components/NotificationSystem";
import PushManager from "@/components/PushManager"; 

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <OrganizationWrapper>
      <div className="min-h-screen bg-slate-50 pb-32 relative"> 
        
        {/* --- NEW FIXED TOP BAR --- */}
        <header className="fixed top-0 left-0 right-0 h-14 bg-white/80 backdrop-blur-md border-b border-slate-200 z-50 flex items-center justify-end px-4 gap-3 shadow-sm">
             {/* Notification Bell */}
             <NotificationSystem />

             {/* Wallet Display (Agents Only) */}
             <WalletHeader />
        </header>

        {/* Main Content Wrapper 
            Added 'pt-14' so content starts below the fixed header 
        */}
        <div className="pt-14">
            {children}
        </div>
        
        {/* Floating Utilities */}
        <PushManager />
        <BottomNav />
      </div>
    </OrganizationWrapper>
  );
}