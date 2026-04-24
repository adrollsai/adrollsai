import BottomNav from "@/components/BottomNav";
import FloatingAgent from "@/components/FloatingAgent";
import PushManager from "@/components/PushManager"; // <--- Import this

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface pb-32 relative"> 
      
      {children}
      
      {/* Global Components */}
      <FloatingAgent /> 
      <PushManager /> {/* <--- Mount it here */}
      
      <BottomNav />
    </div>
  );
}