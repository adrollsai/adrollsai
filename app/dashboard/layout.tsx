import BottomNav from "@/components/BottomNav";
import OrganizationWrapper from "@/components/OrganizationWrapper";
import WalletHeader from "@/components/WalletHeader"; 
import NotificationSystem from "@/components/NotificationSystem";
import PushManager from "@/components/PushManager"; // <--- IMPORT THIS

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <OrganizationWrapper>
      <div className="min-h-screen bg-slate-50 pb-32 relative transition-colors duration-500"> 
        
        {/* HEADER AREA */}
        {/* We keep your existing layout logic for Bell and Wallet */}
        
        {/* Wallet is typically fixed top-right in its own component, 
            so we position the NotificationSystem to its left. */}
        <div className="fixed top-4 right-20 z-[60]">
             <NotificationSystem />
        </div>

        <WalletHeader />
        
        {children}
        
        {/* --- PUSH MANAGER BUTTON --- */}
        {/* This will float above the BottomNav */}
        <PushManager />

        <BottomNav />
      </div>
    </OrganizationWrapper>
  );
}