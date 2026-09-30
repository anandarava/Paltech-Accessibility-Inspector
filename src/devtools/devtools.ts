/**
 * DevTools page entry: registers the "PalTech A11y Inspector" panel. The panel itself
 * (src/devtools/panel.html -> panel.tsx) renders the same App as the side panel
 * with tabId = chrome.devtools.inspectedWindow.tabId.
 */
const PANEL_TITLE = "PalTech A11y Inspector";
const PANEL_ICON = "icons/16.png";
const PANEL_PAGE = "src/devtools/panel.html";

function createPanel(): void {
  try {
    chrome.devtools.panels.create(PANEL_TITLE, PANEL_ICON, PANEL_PAGE, () => {
      const err = chrome.runtime.lastError;
      if (err) console.warn(`[a11y-checker] DevTools panel creation failed: ${err.message}`);
    });
  } catch (e) {
    console.warn(`[a11y-checker] DevTools panel creation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

createPanel();
