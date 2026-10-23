import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import NotificationsPanel from './NotificationsPanel';
import InsightsPanel from './InsightsPanel';
import { SignIn } from './OperatorGate';
import { useData } from '../../data/DataProvider';

// Below this width the sidebar is an off-canvas drawer (theme.css, §7.1).
const DRAWER_QUERY = '(max-width: 1023px)';

/* App shell: sidebar, header, scrollable content area, and the
   slide-out side panels. */
export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panel, setPanel] = useState(null); // 'notifications' | 'insights' | null
  const { operator } = useData();
  const { pathname } = useLocation();

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  const toggleSidebar = () => {
    if (window.matchMedia(DRAWER_QUERY).matches) setDrawerOpen((o) => !o);
    else setCollapsed((c) => !c);
  };
  const togglePanel = (name) => setPanel((p) => (p === name ? null : name));
  if (!operator) return <SignIn />;

  return (
    <div className="shell">
      <Sidebar collapsed={collapsed} open={drawerOpen} />
      <div className={`sidebar-backdrop ${drawerOpen ? 'is-open' : ''}`} onClick={() => setDrawerOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          onToggleSidebar={toggleSidebar}
          activePanel={panel}
          onTogglePanel={togglePanel}
        />
        <main className="shell-main">
          <div className="app-content">{children}</div>
        </main>
      </div>

      {panel === 'notifications' && <NotificationsPanel onClose={() => setPanel(null)} />}
      {panel === 'insights' && <InsightsPanel onClose={() => setPanel(null)} />}
    </div>
  );
}
