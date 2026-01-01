import BottomNav from "@/components/BottomNav";
import OrganizationWrapper from "@/components/OrganizationWrapper";
import WalletHeader from "@/components/WalletHeader"; // IMPORT THIS

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <OrganizationWrapper>
      <div className="min-h-screen bg-surface pb-32 relative transition-colors duration-500"> 
        <WalletHeader /> {/* ADD THIS */}
        {children}
        <BottomNav />
      </div>
    </OrganizationWrapper>
  );
}