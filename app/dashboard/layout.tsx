import BottomNav from "@/components/BottomNav";
import OrganizationWrapper from "@/components/OrganizationWrapper";
import WalletHeader from "@/components/WalletHeader"; 
import NotificationSystem from "@/components/NotificationSystem"; // IMPORT THIS

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <OrganizationWrapper>
      <div className="min-h-screen bg-surface pb-32 relative transition-colors duration-500"> 
        
        {/* NOTIFICATION BELL POSITIONING */}
        <div className="fixed top-4 right-4 z-[60] flex items-center gap-2 pointer-events-none">
             {/* We use pointer-events-none on wrapper so it doesn't block clicks, 
                 but enable pointer-events-auto on the children components */}
             
             {/* Wallet Header (Existing) */}
             <div className="pointer-events-auto">
                {/* Note: WalletHeader itself has fixed positioning in its own file, 
                    but here we can just let it be or adjust. 
                    Actually, your WalletHeader component ALREADY has 'fixed top-0 right-0'. 
                    To avoid overlap, we should position the Bell to the LEFT of the Wallet.
                */}
             </div>

             {/* Notification Bell - Positioned manually to avoid Wallet overlap */}
             <div className="fixed top-4 right-32 z-[60] pointer-events-auto">
                 <NotificationSystem />
             </div>
        </div>

        <WalletHeader />
        
        {children}
        <BottomNav />
      </div>
    </OrganizationWrapper>
  );
}