import React, { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import NotificationsPanel from './NotificationsPanel';
import InsightsPanel from './InsightsPanel';
import { SignIn } from './OperatorGate';
import { useData } from '../../data/DataProvider';

/* App shell: sidebar, header, scrollable content area, and the
   slide-out side panels. */
export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState(null); // 'notifications' | 'insights' | null
  const { operator } = useData();

  const togglePanel = (name) => setPanel((p) => (p === name ? null : name));
  if (!operator) return <SignIn />;

  return (
    <div className="shell">
      <Sidebar collapsed={collapsed} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          onToggleSidebar={() => setCollapsed((c) => !c)}
          activePanel={panel}
          onTogglePanel={togglePanel}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>

      {panel === 'notifications' && <NotificationsPanel onClose={() => setPanel(null)} />}
      {panel === 'insights' && <InsightsPanel onClose={() => setPanel(null)} />}
    </div>
  );
}
