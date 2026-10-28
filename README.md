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
| **Journal** | This month's net P&L, win rate, trade count and profit factor, plus today's daily-loss meter if you set a limit. Filter chips (All, Wins, Losses, each entry reason), search, and a filter sheet (trend, pullback to, depth, instrument, grade, mistake). Trades are grouped by day, newest first, and the day header stays pinned while you scroll. Tap a trade to edit it; swipe it left for **Duplicate** and **Delete** (with Undo). |
| **+** | Log a trade. The result card updates live as you type. Long-press + to start from a copy of your last trade. |
| **Calendar** | Month grid, Mon–Fri plus a weekly total. Days are shaded by result. Swipe sideways to change month, or tap the month name to jump to any month (each shows its net). Switch what the days show: **$** P&L, **%** of account size, **Trades** taken or **Win %** (colours always follow P&L). Tap a day to see its trades. Weekend trades count in the week total. |
| **Stats** | Week / Month / 3M / All (tap, or swipe the page sideways). Trailing-drawdown meter if you set a limit, equity curve (drag along it to read any day), six stat tiles, P&L by entry reason, by time of day and by weekday, a Trend Pullback breakdown (P&L and win rate by trend, pullback to and depth), and cost of mistakes. |
| **Settings** | Instruments, commission, account limits, entry reason and mistake lists, backup and restore, sample data, app version. |

### Logging faster
- **New trades start from your last one**: same instrument, contracts and entry reason. Trend/pullback/depth are left blank on purpose.
- **Type only the last digits of a price.** With an entry of 25812.25, typing `836.5` for the exit gives 25836.50 and `05` gives 25805.00. For the entry itself, the last trade's exit is the reference (shown greyed in the box). Type the full price whenever you want.
- **Prices snap to the tick** (0.25 for MNQ) when you leave the field, instead of showing an error.
- **Stop & target in points**: switch the toggle above Stop to **Points** and type `8.25` instead of a price; the price it works out to is shown underneath. The app remembers your choice. Trades always store prices.
- **Time shortcuts** under the date: Now, −15m, −5m, −1m, +5m.
- **Duplicate** (swipe a trade left) copies everything except notes and screenshots, at the same time. Long-press + copies your last trade, timed now.
- **Close the form** by dragging its header down or swiping in from the left edge. You're asked first if anything changed.
- **Screenshots** open full screen: pinch or double-tap to zoom, swipe sideways for the next one, swipe down to close.

### Account limits (Tradeify)
Settings → Account limits takes your **account size** (the starting balance, e.g. 50000; used for % on the Calendar, where % = day net ÷ account size) and two dollar amounts from your Tradeify account rules. Leave either blank to hide its meter.

- **Daily loss limit**: the Journal shows today's loss against it. The bar turns amber at 50% used and red at 75%.
- **Trailing drawdown**: Stats shows how far the balance can fall before it reaches the floor. The floor is the highest **end-of-day** balance minus the limit; today's close only counts once the day is over.
- **Count trades from**: set this when you start a new account so older trades don't count toward the limits.

These meters are a guide only. Your Tradeify dashboard is the source of truth, because their exact rules (for example when the drawdown stops trailing) depend on the account type.

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
- **Import trades from CSV** — see [Logging trades from a spreadsheet](#logging-trades-from-a-spreadsheet). The app's own CSV export can be imported back.

### Logging trades from a spreadsheet
Start from [`templates/trade-import-template.csv`](templates/trade-import-template.csv). Open it in Excel, Numbers or Google Sheets, delete the three example rows, add one row per trade, and save as **CSV**. Get the file onto your iPhone (AirDrop, iCloud Drive, or email it to yourself and tap **Save to Files**), then in the app go to **Settings → Import trades from CSV** and pick the file.

| Column | Required | What to put |
| --- | --- | --- |
| `date` | yes | `2026-10-21` (Excel's `10/21/2026` also works) |
| `time` | yes | Entry time on your phone's clock, 24-hour `09:42` or `9:42 AM` |
| `side` | yes | `long` or `short` |
| `contracts` | yes | `1`, `2`, … |
| `entry`, `exit` | yes | Prices on the 0.25 tick, e.g. `25812.25` |
| `stop`, `target` | no | Prices; `stop` is needed for R and risk |
| `setup` | no | `Trend Pullback`, `Disconnect Fade` or `Range Fade` |
| `trend` | no | `Price Trend`, `Trend` or `Strong Trend` (Trend Pullback only) |
| `pullbackTo` | no | `EMA` or `VWAP` (Trend Pullback only) |
| `depth` | no | `Shallow` or `Deep` (Trend Pullback only) |
| `mistakes` | no | Separate several with `;`, e.g. `Early entry; Chased` |
| `grade` | no | `A`, `B`, `C` or `D` |
| `fees` | no | Leave empty to use $1.82 × contracts |
| `notes` | no | Anything. Wrap it in quotes if it has a comma (spreadsheet apps do this for you). |

A single `dateTime` column (`2026-10-21 09:42`) works instead of `date` + `time`, and so does an `instrument` column (default `MNQ`). Upper or lower case doesn't matter. Rows that match a trade already in the app (same time, side, contracts, entry and exit) are skipped, so importing the same file twice is safe. Rows the app can't read are skipped too, and listed by row number after the import.

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
    ├── ui.js             icons, toast (with Undo), bottom sheets
    ├── gestures.js       swipe / drag / long-press helpers
    ├── viewer.js         full-screen screenshot viewer (pinch zoom)
    ├── image.js          screenshot compression (1600 px, JPEG 0.8)
    ├── backup.js         JSON/CSV export + import, share sheet
    ├── csv.js            CSV parse/write
    ├── sample.js         sample data
    ├── pwa.js            service-worker registration + update banner
    ├── tests/calc.test.js
    └── views/            journal, trade (log/edit), calendar, stats, settings, rules (limit meters)
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
