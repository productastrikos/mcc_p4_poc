/* ═══════════════════════════════════════════════════════════════════════
   SAMPLE DATA: placeholder content for the example pages.
   Replace these with your own data, or load them through DataProvider.js.
   ═══════════════════════════════════════════════════════════════════════ */

const now = Date.now();
const minutesAgo = (m) => new Date(now - m * 60000).toISOString();

/* ─── Notifications (bell icon panel) ─────────────────────── */
export const NOTIFICATIONS = [
  { id: 'N-001', tone: 'danger',  title: 'Segment B above capacity threshold', message: 'Utilisation is at 71.2% and rising. Allocate extra capacity before the end of the shift.', createdAt: minutesAgo(18), read: false },
  { id: 'N-002', tone: 'warning', title: '3 high-priority items past SLA',      message: 'ITM-001, ITM-004 and ITM-010 have waited more than 30 minutes without an owner.',       createdAt: minutesAgo(32), read: false },
  { id: 'N-003', tone: 'warning', title: 'Scheduled maintenance overdue',        message: 'RES-003 maintenance is 2 days overdue. Book a service window.',                         createdAt: minutesAgo(58), read: false },
  { id: 'N-004', tone: 'info',    title: 'Stage 3 queue growing',                message: 'Queue depth reached 8 items. No action needed yet.',                                   createdAt: minutesAgo(75), read: false },
  { id: 'N-005', tone: 'info',    title: 'Monthly report ready',                 message: 'The monthly report is ready to review and export.',                                    createdAt: minutesAgo(110), read: true },
];

/* ─── AI insights (sparkles panel) ────────────────────────── */
export const INSIGHTS = [
  {
    id: 'INS-001',
    priority: 'high',
    category: 'Capacity',
    title: 'Segment B is above 70% utilisation: add capacity before end of shift',
    causes: [
      ['Primary', 'Segment B is at 71.2% and heading for the 75% warning threshold within about 2 hours.'],
      ['Contributing', 'Three queued items are unassigned and the shift handover is unconfirmed.'],
      ['Systemic', 'This repeats on weekday afternoons. A standing pre-allocation rule would prevent it.'],
    ],
    evidence: ['Utilisation 71.2%, rising 0.8%/hr', '3 unassigned items in queue', 'Handover confirmation pending'],
    recommendations: ['Pre-allocate RES-003 to Segment B for 14:00–18:00', 'Clear the unassigned queue before handover', 'Add an automatic alert at 68%'],
    impact: '+8% capacity headroom within 30 minutes',
    actions: ['assign', 'task'],
  },
  {
    id: 'INS-002',
    priority: 'medium',
    category: 'Service levels',
    title: 'Three requests are past their SLA: escalation recommended',
    causes: [
      ['Primary', 'ITM-001, ITM-004 and ITM-010 are high priority and have waited over 30 minutes.'],
      ['Contributing', 'No one is assigned to the queue.'],
    ],
    evidence: ['ITM-001: open 15 min, unassigned', 'ITM-004: open 30 min, unassigned', 'ITM-010: open 20 min, unassigned'],
    recommendations: ['Assign the three open requests now', 'Send an acknowledgement to each requester', 'Review staffing for peak hours'],
    impact: 'SLA compliance back above 95% within 15 minutes',
    actions: ['notify', 'task'],
  },
];

// Forms opened by insight action buttons. Field types: select | text | textarea
export const ACTION_FORMS = {
  assign: {
    title: 'Assign resource',
    fields: [
      { key: 'segment',  label: 'Segment',  type: 'select', options: ['Segment A', 'Segment B', 'Segment C', 'Segment D', 'Segment E'] },
      { key: 'resource', label: 'Resource', type: 'select', options: ['RES-001', 'RES-003', 'RES-005', 'RES-007'] },
      { key: 'priority', label: 'Priority', type: 'select', options: ['Immediate', 'High', 'Standard'] },
      { key: 'notes',    label: 'Notes',    type: 'textarea', placeholder: 'Instructions…' },
    ],
  },
  notify: {
    title: 'Send notification',
    fields: [
      { key: 'audience', label: 'Audience', type: 'select', options: ['All users', 'Group A', 'Group B', 'Group C'] },
      { key: 'channel',  label: 'Channel',  type: 'select', options: ['In-app', 'Email', 'Email + in-app'] },
      { key: 'message',  label: 'Message',  type: 'textarea', placeholder: 'Message text…' },
    ],
  },
  task: {
    title: 'Create task',
    fields: [
      { key: 'title',    label: 'Title',    type: 'text', placeholder: 'Short description' },
      { key: 'team',     label: 'Team',     type: 'select', options: ['Team A', 'Team B', 'Team C'] },
      { key: 'priority', label: 'Priority', type: 'select', options: ['Critical', 'High', 'Low'] },
      { key: 'details',  label: 'Details',  type: 'textarea', placeholder: 'What needs to be done…' },
    ],
  },
};

/* ─── Dashboard ────────────────────────────────────────────── */
// Each entry becomes a StatCard; clicking it opens MetricDetailDrawer.
// thresholds/inverted: see getStatus() in src/utils.js
export const DASHBOARD_METRICS = [
  {
    id: 'completion', label: 'Completion Rate', icon: 'gauge', value: 96.2, unit: '%', trend: 1.1,
    thresholds: { good: 95, warn: 85 },
    definition: 'Share of scheduled items completed on time.',
    subValues: [{ label: 'Exceptions', value: '1.8%' }, { label: 'Segments', value: '5/5' }],
    related: [{ label: 'Processed', value: '4,430' }, { label: 'Exceptions', value: 83 }, { label: 'At risk', value: 1 }, { label: 'Target', value: '≥ 95%' }],
    events: [{ time: '14:30', tone: 'info', text: 'Within the target range. No action needed.' }],
    insights: ['Afternoon completion dips about 3% on weekdays', 'Segment B accounts for 40% of exceptions', 'An extra resource at 14:00 would close the gap'],
  },
  {
    id: 'exceptions', label: 'Exception Rate', icon: 'alert', value: 1.8, unit: '%', trend: -0.6,
    thresholds: { good: 2, warn: 5 }, inverted: true,
    definition: 'Share of items that needed manual follow-up. Lower is better.',
    subValues: [{ label: 'Count', value: 83 }, { label: 'Open alerts', value: 2 }],
    related: [{ label: 'Open', value: 83 }, { label: 'Alerts', value: 2 }, { label: 'Avg delay', value: '18 min' }, { label: 'Auto-assigned', value: 3 }],
    events: [{ time: '09:14', tone: 'warning', text: 'Close to the warning threshold. Check interval raised to 5 min.' }],
  },
  {
    id: 'efficiency', label: 'Efficiency Gain', icon: 'trendUp', value: 22.4, unit: '%', trend: 2.3,
    thresholds: { good: 20, warn: 10 },
    definition: 'Cost reduction compared with the baseline process.',
    subValues: [{ label: 'Saved', value: '$54k' }, { label: 'Hours', value: '386' }],
    related: [{ label: 'Saved', value: '$54k' }, { label: 'Hours', value: 386 }, { label: 'Optimised', value: 21 }, { label: 'Target', value: '≥ 20%' }],
  },
  {
    id: 'volume', label: 'Daily Volume', icon: 'box', value: 1325, unit: 'items', trend: 3.2,
    thresholds: { good: 1200, warn: 900 },
    definition: 'Items processed per day.',
    subValues: [{ label: 'Target', value: '1,400' }, { label: 'Rate', value: '96%' }],
    related: [{ label: 'Target', value: '1,400' }, { label: 'Per resource', value: 28.4 }],
  },
  {
    id: 'quality', label: 'Quality Score', icon: 'star', value: 31.4, unit: '%', trend: 1.8,
    thresholds: { good: 30, warn: 15 },
    definition: 'Share of items that pass every quality check.',
    subValues: [{ label: 'Passed', value: 416 }, { label: 'Value', value: '$3.2k' }],
  },
  {
    id: 'breaches', label: 'Threshold Breaches', icon: 'signal', value: 0.7, unit: '%', trend: -0.3,
    thresholds: { good: 2, warn: 5 }, inverted: true,
    definition: 'Share of monitored items above their configured limit.',
    subValues: [{ label: 'Breaching', value: '3/445' }, { label: 'Near limit', value: 22 }],
  },
];

export const SEGMENTS = [
  { id: 'A', name: 'Segment A', groups: ['A1', 'A2', 'A3'], utilization: 62.4, processed: 1012, exceptions: 18 },
  { id: 'B', name: 'Segment B', groups: ['B1', 'B2', 'B3'], utilization: 71.2, processed: 812,  exceptions: 34 },
  { id: 'C', name: 'Segment C', groups: ['C1', 'C2', 'C3'], utilization: 54.8, processed: 818,  exceptions: 12 },
  { id: 'D', name: 'Segment D', groups: ['D1', 'D2', 'D3'], utilization: 66.8, processed: 804,  exceptions: 21 },
  { id: 'E', name: 'Segment E', groups: ['E1', 'E2', 'E3'], utilization: 83.6, processed: 984,  exceptions: 38 },
];

// 24 hourly values
export const HOURLY_ACTIVITY = [18, 12, 8, 5, 10, 42, 78, 91, 95, 89, 82, 74, 61, 58, 72, 88, 86, 79, 62, 44, 38, 31, 24, 19];
export const HOURLY_ACTIVE   = [4, 3, 3, 2, 3, 8, 16, 22, 25, 26, 24, 22, 19, 18, 21, 24, 23, 19, 13, 10, 8, 7, 6, 5];
export const HOURLY_IDLE     = [2, 1, 1, 1, 1, 3, 6, 8, 9, 9, 8, 8, 7, 7, 8, 9, 8, 7, 5, 4, 3, 2, 2, 2];

export const CATEGORY_SPLIT = {
  labels: ['Category A', 'Category B', 'Category C', 'Category D', 'Category E', 'Other'],
  values: [38, 22, 16, 12, 8, 4],
};

export const RECENT_ACTIVITY = [
  { text: 'Segment A reached its completion target (98.2%)', time: '4 min ago',  tone: 'success' },
  { text: 'Insight INS-001 acknowledged',                     time: '12 min ago', tone: 'accent' },
  { text: 'RES-003 returned to service',                      time: '28 min ago', tone: 'primary' },
  { text: 'Segment D maintenance completed',                  time: '1 hr ago',   tone: 'warning' },
  { text: 'New high-priority item ITM-010',                   time: '2 hr ago',   tone: 'danger' },
];

/* ─── Tables page ──────────────────────────────────────────── */
export const RECORDS = [
  { id: 'REC-001', name: 'Record Alpha',   category: 'Category A', status: 'done',     priority: 'high',   owner: 'Alex Kim',     updated: '2 hr ago' },
  { id: 'REC-002', name: 'Record Beta',    category: 'Category B', status: 'active',   priority: 'medium', owner: 'Sam Lee',      updated: '45 min ago' },
  { id: 'REC-003', name: 'Record Gamma',   category: 'Category A', status: 'pending',  priority: 'low',    owner: 'Jordan Park',  updated: '3 hr ago' },
  { id: 'REC-004', name: 'Record Delta',   category: 'Category C', status: 'blocked',  priority: 'high',   owner: 'Morgan Diaz',  updated: '18 min ago' },
  { id: 'REC-005', name: 'Record Epsilon', category: 'Category B', status: 'done',     priority: 'medium', owner: 'Riley Shah',   updated: '5 hr ago' },
  { id: 'REC-006', name: 'Record Zeta',    category: 'Category C', status: 'active',   priority: 'high',   owner: 'Casey Wong',   updated: '1 hr ago' },
  { id: 'REC-007', name: 'Record Eta',     category: 'Category A', status: 'pending',  priority: 'low',    owner: 'Drew Novak',   updated: '7 hr ago' },
  { id: 'REC-008', name: 'Record Theta',   category: 'Category B', status: 'done',     priority: 'medium', owner: 'Taylor Ruiz',  updated: '4 hr ago' },
];

export const RESOURCES = [
  { id: 'RES-001', name: 'Resource 1', type: 'Type A', status: 'online',      location: 'Region 1', utilization: 84, lastSeen: '2 min ago' },
  { id: 'RES-002', name: 'Resource 2', type: 'Type B', status: 'maintenance', location: 'Base',     utilization: 0,  lastSeen: '3 hr ago' },
  { id: 'RES-003', name: 'Resource 3', type: 'Type A', status: 'online',      location: 'Region 2', utilization: 71, lastSeen: 'Just now' },
  { id: 'RES-004', name: 'Resource 4', type: 'Type C', status: 'idle',        location: 'Region 3', utilization: 0,  lastSeen: '45 min ago' },
  { id: 'RES-005', name: 'Resource 5', type: 'Type B', status: 'online',      location: 'Region 1', utilization: 92, lastSeen: '5 min ago' },
  { id: 'RES-006', name: 'Resource 6', type: 'Type A', status: 'offline',     location: 'Unknown',  utilization: 0,  lastSeen: '1 day ago' },
  { id: 'RES-007', name: 'Resource 7', type: 'Type C', status: 'online',      location: 'Region 4', utilization: 63, lastSeen: '12 min ago' },
];

export const CONTAINERS = [
  { id: 'CON-001', name: 'Container A', category: 'Type 1', capacity: 500, used: 342, dailyIn: 18, updated: '10 min ago' },
  { id: 'CON-002', name: 'Container B', category: 'Type 2', capacity: 300, used: 278, dailyIn: 24, updated: '25 min ago' },
  { id: 'CON-003', name: 'Container C', category: 'Type 1', capacity: 400, used: 161, dailyIn: 12, updated: '5 min ago' },
  { id: 'CON-004', name: 'Container D', category: 'Type 3', capacity: 200, used: 187, dailyIn: 31, updated: '2 min ago' },
  { id: 'CON-005', name: 'Container E', category: 'Type 2', capacity: 600, used: 220, dailyIn: 9,  updated: '1 hr ago' },
];

/* ─── Charts page ──────────────────────────────────────────── */
export const MONTHLY_SERIES = {
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  seriesA: [62, 65, 68, 66, 71, 74, 73, 78, 80, 82, 81, 84],
  seriesB: [38, 36, 34, 37, 33, 31, 30, 27, 25, 23, 24, 21],
};

export const GOALS = [
  { name: 'Goal Alpha', progress: 82, status: 'on-track',  target: '90%', due: 'Q3' },
  { name: 'Goal Beta',  progress: 61, status: 'at-risk',   target: '75%', due: 'Q2' },
  { name: 'Goal Gamma', progress: 95, status: 'completed', target: '90%', due: 'Q1' },
  { name: 'Goal Delta', progress: 44, status: 'at-risk',   target: '70%', due: 'Q4' },
];

export const PIPELINE = [
  { id: 'STEP-1', name: 'Intake',     items: 240, throughput: 95, avgTime: '8 min',  status: 'normal' },
  { id: 'STEP-2', name: 'Validation', items: 228, throughput: 88, avgTime: '12 min', status: 'normal' },
  { id: 'STEP-3', name: 'Processing', items: 195, throughput: 72, avgTime: '22 min', status: 'warning' },
  { id: 'STEP-4', name: 'Review',     items: 150, throughput: 91, avgTime: '15 min', status: 'normal' },
  { id: 'STEP-5', name: 'Output',     items: 142, throughput: 98, avgTime: '5 min',  status: 'normal' },
];

export const UNITS = [
  { id: 'UNIT-1', name: 'Unit 1', status: 'online',  output: 42, capacity: 50, uptime: 99.1, temp: 72 },
  { id: 'UNIT-2', name: 'Unit 2', status: 'online',  output: 38, capacity: 50, uptime: 97.4, temp: 69 },
  { id: 'UNIT-3', name: 'Unit 3', status: 'warning', output: 21, capacity: 50, uptime: 88.2, temp: 91 },
  { id: 'UNIT-4', name: 'Unit 4', status: 'offline', output: 0,  capacity: 50, uptime: 0,    temp: 22 },
];

/* ─── List & detail page ───────────────────────────────────── */
export const ITEMS = [
  { id: 'ITM-001', subject: 'Item one',   category: 'Type A', status: 'open',     priority: 'high',   requester: 'J. Adams',  created: '15 min ago' },
  { id: 'ITM-002', subject: 'Item two',   category: 'Type B', status: 'progress', priority: 'medium', requester: 'P. Moreno', created: '1 hr ago' },
  { id: 'ITM-003', subject: 'Item three', category: 'Type C', status: 'closed',   priority: 'low',    requester: 'T. Walsh',  created: '3 hr ago' },
  { id: 'ITM-004', subject: 'Item four',  category: 'Type B', status: 'open',     priority: 'high',   requester: 'C. Jones',  created: '30 min ago' },
  { id: 'ITM-005', subject: 'Item five',  category: 'Type A', status: 'progress', priority: 'high',   requester: 'S. Dutta',  created: '2 hr ago' },
  { id: 'ITM-006', subject: 'Item six',   category: 'Type B', status: 'closed',   priority: 'low',    requester: 'M. Brown',  created: '5 hr ago' },
  { id: 'ITM-007', subject: 'Item seven', category: 'Type B', status: 'open',     priority: 'medium', requester: 'R. Wilson', created: '45 min ago' },
  { id: 'ITM-008', subject: 'Item eight', category: 'Type C', status: 'closed',   priority: 'low',    requester: 'L. Tran',   created: '1 day ago' },
  { id: 'ITM-009', subject: 'Item nine',  category: 'Type B', status: 'progress', priority: 'medium', requester: 'K. Harris', created: '4 hr ago' },
  { id: 'ITM-010', subject: 'Item ten',   category: 'Type A', status: 'open',     priority: 'high',   requester: 'B. Clark',  created: '20 min ago' },
];

/* ─── Map page ─────────────────────────────────────────────── */
export const MAP_CENTER = [51.505, -0.09];
export const MAP_POINTS = [
  { id: 'PT-001', label: 'Point Alpha',   lat: 51.505, lng: -0.09,  status: 'online',  layer: 'Primary',   value: 84 },
  { id: 'PT-002', label: 'Point Beta',    lat: 51.515, lng: -0.10,  status: 'warning', layer: 'Primary',   value: 62 },
  { id: 'PT-003', label: 'Point Gamma',   lat: 51.495, lng: -0.08,  status: 'online',  layer: 'Primary',   value: 91 },
  { id: 'PT-004', label: 'Point Delta',   lat: 51.510, lng: -0.075, status: 'online',  layer: 'Secondary', value: 78 },
  { id: 'PT-005', label: 'Point Epsilon', lat: 51.500, lng: -0.105, status: 'offline', layer: 'Secondary', value: 0 },
  { id: 'PT-006', label: 'Point Zeta',    lat: 51.508, lng: -0.095, status: 'online',  layer: 'Tertiary',  value: 55 },
];
