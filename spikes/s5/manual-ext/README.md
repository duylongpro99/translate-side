# S5 manual check: Alt+T and the context menu

These paths can't be driven through CDP. A person checks them in about 2 minutes.

1. Start a throwaway profile: `open -na "Google Chrome" --args --user-data-dir=/tmp/s5-manual --no-first-run https://example.com`
2. Go to `chrome://extensions`, turn on Developer mode, then "Load unpacked" and pick this folder. Pin the extension.
3. Open https://example.com (or any normal https page). Nothing opens the panel yet: row 1's **Alt+T** opens it. From
   then on its log updates live.

| # | Do this | Record from the panel log |
|---|---|---|
| 1 | Behavior OFF (default). Press **Alt+T** (⌥T) | `action.onClicked`, `sidePanel.open OK/FAIL`, `inject OK/FAIL` |
| 2 | Navigate to another site (e.g. https://wikipedia.org). Click **probe active tab now** | expect `inject FAIL` (grant revoked, panel click is not a grant) |
| 3 | Right-click the page → **S5: open panel + inject** | `contextMenus.onClicked`, `sidePanel.open`, `inject` |
| 4 | Press **Alt+Shift+Y** (named command) | `commands.onCommand`, `inject` |
| 5 | Click **behavior ON**. Close the panel: with behavior ON the toolbar icon toggles it closed; otherwise use the side panel's **X**. Navigate to a new site. Press **Alt+T** | panel opens? Then click **probe active tab now**: `inject OK` or `FAIL`? |
| 6 | Same as 5, but click the toolbar icon instead of Alt+T | same question |
| 7 | Behavior OFF. With the panel open, press **Alt+T** again | does the panel stay open (expected) or close? |
| 8 | Behavior ON. With the panel open, press **Alt+T** again | does the panel close (expected toggle)? |

## What to report

1. Copy the panel log (select all in the panel, copy) and save it as `spikes/s5/results/manual.txt`. Or paste it into
   the conversation, and the implementer commits it.
2. Add one line per row, in this format:
   `row N: <what you did> → panel opened? yes/no · inject OK/FAIL · notes`
   Rows 1, 3, 5 and 6 are the ones the decision depends on.
3. Note your Chrome version (`chrome://version`) and whether **Alt+T** typed a character (e.g. `†`) instead of firing.

The S5 decision expects these results:
- row 1: opened, inject OK;
- row 2: inject FAIL;
- row 3: opened, inject OK;
- row 4: inject OK;
- rows 5 and 6: opened, inject FAIL;
- row 7: stays open;
- row 8: closes.

Any other result changes deviation (a) or (c) in `docs/decisions/S5-activetab-navigation.md`.
