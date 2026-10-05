# S5 manual check: Alt+T and the context menu

These paths can't be driven through CDP. A person checks them in about 2 minutes.

1. Start a throwaway profile: `open -na "Google Chrome" --args --user-data-dir=/tmp/s5-manual --no-first-run https://example.com`
2. Go to `chrome://extensions`, turn on Developer mode, then "Load unpacked" and pick this folder. Pin the extension.
3. Open https://example.com (or any normal https page). The panel opens with the first step; its log updates live.

| # | Do this | Record from the panel log |
|---|---|---|
| 1 | Behavior OFF (default). Press **Alt+T** (⌥T) | `action.onClicked`, `sidePanel.open OK/FAIL`, `inject OK/FAIL` |
| 2 | Navigate to another site (e.g. https://wikipedia.org). Click **probe active tab now** | expect `inject FAIL` (grant revoked, panel click is not a grant) |
| 3 | Right-click the page → **S5: open panel + inject** | `contextMenus.onClicked`, `sidePanel.open`, `inject` |
| 4 | Press **Alt+Shift+Y** (named command) | `commands.onCommand`, `inject` |
| 5 | Click **behavior ON**. Close the panel. Navigate to a new site. Press **Alt+T** | panel opens? Then click **probe active tab now**: `inject OK` or `FAIL`? |
| 6 | Same as 5, but click the toolbar icon instead of Alt+T | same question |

Paste the log text (select all in the panel) into `results/manual.txt`.
