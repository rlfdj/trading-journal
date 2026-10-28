// Default settings, used until the user saves their own.

export const SCHEMA_VERSION = 1;

export const DEFAULT_INSTRUMENTS = [
  { symbol: 'MNQ', name: 'Micro Nasdaq-100', pointValue: 2, tickSize: 0.25, enabled: true, builtIn: true },
  { symbol: 'MES', name: 'Micro E-mini S&P 500', pointValue: 5, tickSize: 0.25, enabled: false, builtIn: true },
  { symbol: 'NQ', name: 'E-mini Nasdaq-100', pointValue: 20, tickSize: 0.25, enabled: false, builtIn: true },
  { symbol: 'ES', name: 'E-mini S&P 500', pointValue: 50, tickSize: 0.25, enabled: false, builtIn: true },
];

// Extra single-choice details for particular setups (entry reasons), keyed by setup name.
// Each detail is stored on the trade under its key, only when the trade has that setup.
export const DEFAULT_SETUP_DETAILS = {
  'Trend Pullback': [
    { key: 'trend', label: 'Trend', options: ['Price Trend', 'Trend', 'Strong Trend'] },
    { key: 'pullbackTo', label: 'Pullback to', options: ['EMA', 'VWAP'] },
    { key: 'depth', label: 'Depth', options: ['Shallow', 'Deep'] },
  ],
};

/** Detail groups for a setup ([] when it has none). */
export function detailsFor(settings, setup) {
  return (settings.setupDetails && settings.setupDetails[setup]) || [];
}

/** Every detail group across all setups, de-duplicated by key. */
export function allDetails(settings) {
  const seen = new Map();
  for (const groups of Object.values(settings.setupDetails || {})) {
    for (const g of groups) if (!seen.has(g.key)) seen.set(g.key, g);
  }
  return [...seen.values()];
}

export function defaultSettings() {
  return {
    id: 'settings',
    instruments: DEFAULT_INSTRUMENTS.map((i) => ({ ...i })),
    defaultInstrument: 'MNQ',
    // $ per contract, round trip, all-in (commission + exchange + NFA + clearing).
    // Default is Tradeify's MNQ rate (MES is the same; NQ/ES are $5.76):
    // https://help.tradeify.co/en/articles/10468315-trading-commission-fees (checked Oct 2026)
    commission: 1.82,
    setups: ['Trend Pullback', 'Disconnect Fade', 'Range Fade'],
    setupDetails: structuredClone(DEFAULT_SETUP_DETAILS),
    mistakes: ['Early entry', 'Oversized', 'Moved stop', 'Chased', 'Cut winner'],
    // Prop-firm limits in $, shown as meters when set (null = off).
    dailyLossLimit: null,
    drawdownLimit: null,      // trailing, from the highest end-of-day balance
    accountStart: null,       // 'YYYY-MM-DD': limits count trades from this day
    accountSize: null,        // starting balance in $, for % returns on the Calendar
    calendarMode: 'pnl',      // what calendar cells show: 'pnl' | 'pct' | 'trades' | 'winrate'
    stopUnit: 'price',        // trade form: stop & target typed as 'price' or 'points'
    lastBackupAt: null,
    sampleLoaded: false,
    createdAt: null,
    updatedAt: null,
    deleted: false,
    schemaVersion: SCHEMA_VERSION,
  };
}
