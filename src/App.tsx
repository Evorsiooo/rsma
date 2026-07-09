import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import Landing from "./pages/Landing"
import Tower from "./pages/Tower"
import Driver from "./pages/Driver"
import Steward from "./pages/Steward"
import Admin from "./pages/Admin"
import { AppSidebar } from "./components/app-sidebar"
import { SidebarProvider, SidebarTrigger } from "./components/ui/sidebar"

// Layout for the staff routes containing the sidebar
function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="flex-1 w-full relative">
        <div className="absolute top-4 left-4 md:hidden">
          <SidebarTrigger />
        </div>
        <div className="p-4 md:p-8 pt-16 md:pt-8 w-full min-h-screen overflow-x-hidden">
          {children}
        </div>
      </main>
    </SidebarProvider>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/tower" element={<Tower />} />
        <Route path="/driver" element={<Driver />} />
        
        {/* Staff Routes */}
        <Route path="/staff" element={<Navigate to="/staff/steward" replace />} />
        <Route 
          path="/staff/steward" 
          element={
            <StaffLayout>
              <Steward />
            </StaffLayout>
          } 
        />
        <Route 
          path="/staff/admin" 
          element={
            <StaffLayout>
              <Admin />
            </StaffLayout>
          } 
        />
        
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
