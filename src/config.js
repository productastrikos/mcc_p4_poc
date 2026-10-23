/* ═══════════════════════════════════════════════════════════════════════
   APP CONFIG: name, logo and signed-in user.
   Pages and navigation are set in routes.js; colours in theme/theme.css.
   ═══════════════════════════════════════════════════════════════════════ */

export const APP = {
  name: 'Miri FloodSense',
  short: 'FloodSense',                    // the name in the logo lockup
  subtitle: 'MSCCC Flood Early Warning',  // small line under the name in the header
  org: 'Miri City Council',               // owner, shown beside the crest
  orgLocal: 'Majlis Bandaraya Miri',      // the council's official Malay name (MBM)
  logo: '/mcc-logo.svg',                  // MBM crest: Wikimedia Commons "Seal of Miri.svg", public domain
  logoInitials: 'MBM',
  locale: 'en-MY',                        // header clock

  // Header features. Set to false to hide.
  features: {
    search: true,
    clock: true,
    notifications: true,
    insights: true,                  // AI briefing side panel
    themeToggle: true,
  },
};

// Fallback user shown before anyone has signed in. The duty sign-in
// (components/layout/OperatorGate.js) replaces it; swap for MCC's single sign-on when integrated.
export const USER = {
  name: 'MSCCC Duty Officer',
  role: 'Miri City Council',
};

export const ROLES = ['MSCCC Duty Officer', 'MSCCC Shift Supervisor', 'MCC Engineering liaison', 'JPBD Miri liaison'];
