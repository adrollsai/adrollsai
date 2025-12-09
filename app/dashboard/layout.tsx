import BottomNav from "@/components/BottomNav";
import FloatingAgent from "@/components/FloatingAgent"; // <--- Import this

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface pb-32 relative"> 
      
      {children}
      
      {/* The Global AI Agent Button */}
      <FloatingAgent /> 
      
      <BottomNav />
    </div>
  );
}