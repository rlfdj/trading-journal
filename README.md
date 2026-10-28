# Trading Journal

A personal journal for intraday MNQ futures, built to live on your iPhone home screen. It's plain HTML, CSS and JavaScript with no framework, no build step and no npm, hosted free on GitHub Pages. It works fully offline.

> ## ⚠️ Your data lives only on your phone
> Trades and screenshots are stored in the browser on your iPhone. **Deleting the home-screen icon, or clearing Safari website data (Settings → Safari → Clear History and Website Data, or Advanced → Website Data), erases the journal permanently.**
> Use **Settings → Back up everything (JSON)** regularly and save the file to Files / iCloud Drive. The app reminds you on the Journal screen when your last backup is more than 7 days old.

---

## Put it on your iPhone

### 1. Create the GitHub repository
1. Sign in at <https://github.com> (create a free account if you need one).
2. Click **+** (top right) → **New repository**.
3. Name it, for example `trading-journal`. Choose **Public** (GitHub Pages on a free account needs a public repo; your *trades* are never uploaded, only the app code).
4. Leave everything else as it is and click **Create repository**.

### 2. Upload the files
1. On the new repo page, click **uploading an existing file** (or **Add file → Upload files**).
2. Open the `trading-journal` folder on your computer, select **everything inside it** (`index.html`, `sw.js`, `manifest.json`, `tests.html`, `README.md`, and the `css`, `js`, `fonts`, `icons` folders), and drag it onto the page. Folders keep their structure when dragged.
3. Click **Commit changes**.

`index.html` must be at the top level of the repo, not inside a sub-folder.

### 3. Turn on GitHub Pages
1. In the repo, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, pick **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)** → **Save**.
4. Wait a minute or two and refresh. The page shows your address: `https://<your-username>.github.io/trading-journal/`.

### 4. Install on the iPhone
1. Open that address in **Safari** (it has to be Safari for Add to Home Screen to work properly).
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open the app **from the home-screen icon** from now on. The home-screen app keeps its own storage, separate from Safari tabs, so trades you log in a Safari tab won't show up in the icon version, and the other way round.
4. Open it once while online so it caches itself. After that it works offline.

## Publishing updates

1. Change the files you need to change.
2. **Open `sw.js` and bump `VERSION`** (for example `'1.0.0'` → `'1.0.1'`). This tells phones a new version exists, and it's also the version number shown in Settings → About.
3. Upload the changed files to the repo (Add file → Upload files → drag, overwriting) and commit.
4. Wait a minute for GitHub Pages to redeploy. The next time you open the app, a **"Update available — tap to reload"** banner appears. Tap it to switch. Your data isn't touched.

If you forget to bump `VERSION`, phones keep running the cached old version.

## Using the app

| Screen | What it does |
| --- | --- |
| **Journal** | This month's net P&L, win rate, trade count and profit factor. Filter chips (All, Wins, Losses, each entry reason), search, and a filter sheet (trend, pullback to, depth, instrument, grade, mistake). Trades are grouped by day, newest first. Tap a trade to edit it. |
| **+** | Log a trade. The result card updates live as you type. Prices are checked against the instrument's tick size (0.25 for MNQ). |
| **Calendar** | Month grid, Mon–Fri plus a weekly total. Days are shaded by result. Tap a day to see its trades. Weekend trades count in the week total. |
| **Stats** | Week / Month / 3M / All. Equity curve, six stat tiles, P&L by entry reason, a Trend Pullback breakdown (P&L and win rate by trend, pullback to and depth), and cost of mistakes. |
| **Settings** | Instruments, commission, entry reason and mistake lists, backup and restore, sample data, app version. |

### Entry reasons
Every trade gets one entry reason: **Trend Pullback**, **Disconnect Fade** or **Range Fade**. Picking Trend Pullback shows three more choices:

- **Trend**: Price Trend, Trend or Strong Trend
- **Pullback to**: EMA or VWAP
- **Depth**: Shallow or Deep

Fades don't have these details, and switching a trade away from Trend Pullback clears them. In code, the entry reason is the trade's `setup` field, and the details are stored as `trend`, `pullbackTo` and `depth`. The options live in `js/defaults.js` (`DEFAULT_SETUP_DETAILS`). Renaming an entry reason in Settings carries its details along and updates past trades.

### Fees
Fees default to **commission per contract (round trip) × contracts**. The default commission is **$1.82**, [Tradeify's all-in MNQ rate](https://help.tradeify.co/en/articles/10468315-trading-commission-fees) (commission, exchange, NFA and clearing, checked October 2026). Change it in Settings → Commission if the rate changes. You can also override fees on any single trade; **Reset** in the trade form goes back to the calculated amount. Changing the commission later doesn't rewrite fees on trades you've already saved.

### How the numbers are calculated (`js/calc.js`)
- **Points** = exit − entry (long) or entry − exit (short)
- **Gross P&L** = points × point value × contracts. **Net P&L** = gross − fees. Net is shown everywhere; gross appears in the trade form.
- **R multiple** = points ÷ |entry − stop| (only when a stop is entered). **Risk $** = |entry − stop| × point value × contracts
- **Win** = net > 0, **loss** = net < 0, **breakeven** = 0 (breakevens are left out of the win rate)
- **Profit factor** = total net of winning trades ÷ total net of losing trades (as a positive number)
- **Expectancy** = total net ÷ number of trades. **Average win / loss** = winning (or losing) net ÷ count
- **Max drawdown** = the deepest peak-to-trough drop of cumulative net P&L, trade by trade, starting from $0
- **Cost of mistakes** = for each mistake, the total net P&L of *losing* trades tagged with it. A trade with two mistakes counts toward both.

Open `tests.html` (Settings → About → Run calculation tests) to run the unit tests.

### Backup & restore
- **Back up everything (JSON)** saves trades, settings and screenshots (base64) into one file. On iPhone the share sheet opens, so you can **Save to Files** or AirDrop it. On a computer the file downloads.
- **Export CSV** saves trades only, without screenshots, for Excel or Numbers.
- **Restore backup** merges a JSON backup by trade id, and the newer edit wins, so restoring an old backup never overwrites newer changes.
- **Import trades from CSV** needs the columns `dateTime, side, contracts, entry, exit`. These are optional: `id, instrument, stop, target, setup, trend, pullbackTo, depth, mistakes` (separated by `;`), `grade, fees, notes`. `trend / pullbackTo / depth` are only kept on Trend Pullback rows. Rows that match a trade already in the app are skipped. The app's own CSV export can be imported back.

### Sample data
Settings → Testing → **Load sample data** adds about 70 fake MNQ trades marked **SAMPLE**, and a banner shows on the Journal while they're loaded. Turning it off removes only the sample trades. Your own trades are never touched.

## File tree

```
trading-journal/
├── index.html            app shell + tab bar
├── manifest.json         PWA manifest
├── sw.js                 service worker (offline cache, VERSION lives here)
├── tests.html            unit tests for calc.js
├── css/app.css           all styles (light + dark)
├── fonts/                Inter Tight + JetBrains Mono (woff2, latin), OFL licence
├── icons/                apple-touch-icon (180), 192, 512, maskable 512, favicon
└── js/
    ├── app.js            boot + hash router
    ├── store.js          ALL data access (IndexedDB)
    ├── calc.js           ALL trading math
    ├── defaults.js       default settings
    ├── format.js         number/date formatting
    ├── ui.js             icons, toast, bottom sheets
    ├── image.js          screenshot compression (1600 px, JPEG 0.8)
    ├── backup.js         JSON/CSV export + import, share sheet
    ├── csv.js            CSV parse/write
    ├── sample.js         sample data
    ├── pwa.js            service-worker registration + update banner
    ├── tests/calc.test.js
    └── views/            journal, trade (log/edit), calendar, stats, settings
```

## Adding cloud sync later

The UI never touches IndexedDB. Everything goes through the async functions exported by `js/store.js`:

```
init()  listTrades(filter)  getTrade(id)  saveTrade(trade)  deleteTrade(id)
saveScreenshot(blob, id?)  getScreenshot(id)  deleteScreenshot(id)
getSettings()  saveSettings(s)  exportAll()  importAll(data)  storageInfo()
```

Every record (trade, screenshot, settings) already carries what a sync engine needs:
`id` (UUID), `createdAt`, `updatedAt` (ISO), `deleted` (soft-delete tombstone) and `schemaVersion`.

To add Supabase or Firebase:

1. **Keep IndexedDB as the local source of truth** so the app stays instant and offline. Rename the current `store.js` to `store-local.js`.
2. **Write `store-cloud.js`** with a `push(records)` / `pull(since)` pair for the backend: a `trades` table, a `screenshots` bucket (Supabase Storage or Firebase Storage) keyed by screenshot id, and a single settings row per user.
3. **Make a new `store.js`** that re-exports the same functions. Each write calls the local version, then queues the record for `push`. On `init()` and when the app becomes visible, it calls `pull(lastSyncAt)` and merges the results with the same rule `importAll` already uses: **the newer `updatedAt` wins**. Deletes sync as tombstones (`deleted: true`), so a trade deleted on one device disappears on the others.
4. Add sign-in (Supabase Auth or Firebase Auth) and a "Sync" section in Settings.

Because the function names and return shapes stay the same, none of the screens need to change.

## Running it on a computer

Any static server works, for example `python -m http.server` in this folder, then open `http://localhost:8000`. The service worker caches files aggressively. While editing, bump `VERSION` in `sw.js`, or turn on "Update on reload" / "Bypass for network" in Chrome DevTools → Application → Service Workers.

Fonts: Inter Tight and JetBrains Mono are under the SIL Open Font License 1.1.
