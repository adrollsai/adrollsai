/* adrollsai/adrollsai/adrollsai-builder-app/app/dashboard/layout.tsx */
import BottomNav from "@/components/BottomNav";
import FloatingAgent from "@/components/FloatingAgent"; 
import OrganizationWrapper from "@/components/OrganizationWrapper"; // Import

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <OrganizationWrapper>
      <div className="min-h-screen bg-surface pb-32 relative transition-colors duration-500"> 
        {children}
        <FloatingAgent /> 
        <BottomNav />
      </div>
    </OrganizationWrapper>
  );
}