import { useNavigate, useLocation } from "react-router-dom"
import { Flag, Settings, Home } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

export function AppSidebar() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b">
        <div className="flex items-center gap-2">
          <div className="font-bold text-xl tracking-tight">RSMA</div>
          <Badge variant="secondary" className="text-xs">Staff</Badge>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton 
                  isActive={location.pathname === "/staff/steward"} 
                  onClick={() => navigate("/staff/steward")}
                >
                  <Flag />
                  <span>Race Control</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton 
                  isActive={location.pathname === "/staff/admin"}
                  onClick={() => navigate("/staff/admin")}
                >
                  <Settings />
                  <span>Admin Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        <SidebarGroup>
          <SidebarGroupLabel>Exit</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => navigate("/")}>
                  <Home />
                  <span>Back to Landing</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 border-t">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback>ST</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm font-medium">Steward User</span>
            <span className="text-xs text-muted-foreground">Level 4 Access</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

// Temporary badge component for the header
function Badge({ children, variant, className }: { children: React.ReactNode, variant?: string, className?: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${variant === 'secondary' ? 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80' : ''} ${className}`}>{children}</span>
}
