# Sky Team Ife — clickable prototype (source)

Front-end only. No build step, no npm, no server needed — open `index.html` in a browser.

```
index.html          markup shell, loads the four scripts in order
css/styles.css      design tokens and every style rule
js/data.js          the dummy dataset + all constants (weeks, plan price, niches)
js/core.js          state, helpers, metrics, charts, navigation, the tour text
js/views.js         every screen, one function per page
js/app.js           auth screens, router, and all click handlers
```

Load order matters: `data → core → views → app`. `app.js` calls `route()` on the last line, which paints the first screen.

## Where things live

| Looking for | File | Search for |
|---|---|---|
| Prices, weeks, trial length | `js/data.js` | `PLAN`, `WEEKS`, `BASE_NICHES` |
| Centers, offices, distributors | `js/data.js` | `const centers`, `const offices` |
| Who sees which menu items | `js/core.js` | `const NAV` |
| Rankings formula | `js/core.js` | `rankOffices` |
| Most-sold-niche maths | `js/core.js` | `nicheTally`, `topNiche` |
| The 7-step tour copy | `js/core.js` | `const TOUR` |
| A specific screen | `js/views.js` | `VIEWS.<pagename>` |
| A button's behaviour | `js/app.js` | `A['<action-name>']` |
| Sign-up codes | `js/data.js` | `JOIN_CODES` |
| The scan-in flow | `js/app.js` | `renderScan` |

## How the code is wired

**Routing** is hash-based: `#/{role}/{page}/{id}`. Roles are `sa`, `pa`, `of`. `route()` looks up `VIEWS[page]`, which returns `{ title, crumbs, picker, html }`, and paints sidebar + topbar + page.

**Actions** are declarative. Any element with `data-act="thing"` is handled by `A['thing']` in `app.js` — one delegated listener on `document`, so re-rendering never breaks bindings. Add a button, add a handler, done.

**State** is one object in `core.js`. Nothing persists: refreshing the page resets everything to the seeded data. That is deliberate for a prototype.

## What this is not

There is no backend, no database, no real authentication and no real payments. Passwords are not checked, the QR codes are drawn rather than encoded, and the "Paystack" modal is a stand-in. See the go-live PDF for what turning this into a working product involves.
