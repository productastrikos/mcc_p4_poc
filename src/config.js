/* ═══════════════════════════════════════════════════════════════════════
   APP CONFIG: name, logo and signed-in user.
   Pages and navigation are set in routes.js; colours in theme/theme.css.
   ═══════════════════════════════════════════════════════════════════════ */

export const APP = {
  name: 'Miri FloodSense',
  subtitle: 'MSCCC Flood Early Warning',  // small line under the name in the header
  logo: '/floodsense.svg',
  logoInitials: 'FS',
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

// Placeholder user. Replace with MCC's sign-in when integrated.
export const USER = {
  name: 'MSCCC Duty Officer',
  role: 'Miri City Council',
};
