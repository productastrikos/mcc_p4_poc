/* ═══════════════════════════════════════════════════════════════════════
   ROUTES: every page in the app, grouped into sidebar sections.

   To add a page:
     1. Create src/pages/MyPage.js
     2. Import it below and add { path, label, icon, element } to a section
   The sidebar, header title, header search and router all read from here.

   icon      a name from src/components/ui/Icon.js
   keywords  extra words for the header search (optional)
   ═══════════════════════════════════════════════════════════════════════ */
import Dashboard from './pages/Dashboard';
import Hotspots from './pages/Hotspots';
import HotspotDetail from './pages/HotspotDetail';
import Simulator from './pages/Simulator';
import AlertCentre from './pages/AlertCentre';
import ModelPage from './pages/ModelPage';
import DigitalTwin from './pages/DigitalTwin';

export const NAV_SECTIONS = [
  {
    label: 'Operations',
    items: [
      { path: '/', label: 'Command Dashboard', icon: 'home', element: <Dashboard />, keywords: 'map live sensors forecast overview drill replay' },
      { path: '/twin', label: 'Digital Twin', icon: 'layers', element: <DigitalTwin />, keywords: 'twin hydraulic drain outfall tide river pump projection replica network assets' },
      { path: '/hotspots', label: 'Hotspots', icon: 'pin', element: <Hotspots />, keywords: 'sites areas cctv drain' },
      { path: '/simulator', label: 'Scenario Simulator', icon: 'sliders', element: <Simulator />, keywords: 'what-if scenario storm tide plan' },
      { path: '/alerts', label: 'Alert Centre', icon: 'bell', element: <AlertCentre />, keywords: 'warnings miri cares approval drafts checklist advisory all-clear' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { path: '/model', label: 'Model Performance', icon: 'analytics', element: <ModelPage />, keywords: 'accuracy feature importance events training' },
    ],
  },
];

// Pages reached from other pages rather than the sidebar.
export const HIDDEN_ROUTES = [
  { path: '/hotspots/:id', label: 'Hotspot Detail', element: <HotspotDetail /> },
];

// Extra header-search entries: each hotspot opens its detail page.
export const SEARCH_EXTRAS = [
  ['pujut-adong', 'Pujut Adong'], ['tanjung-batu', 'Tanjung Batu'], ['taman-tunku', 'Jalan Dato / Taman Tunku'],
  ['senadin-mcot', 'Senadin / MCOT'], ['desa-senadin', 'Desa Senadin'], ['tudan-desaras', 'Tudan Desaras'],
].map(([id, label]) => ({ path: `/hotspots/${id}`, label, icon: 'pin', section: 'Hotspots', keywords: 'hotspot' }));

export const ROUTES = [...NAV_SECTIONS.flatMap((s) => s.items), ...HIDDEN_ROUTES];
