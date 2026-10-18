// Sets the reading theme on <html> before the page paints. A classic script in each page's <head>
// runs before the body is laid out; the page's module (src/ui/theme.ts) runs later and reconciles
// with storage.sync. Only the theme is read here, from the same localStorage mirror.
try {
  var theme = (JSON.parse(localStorage.getItem('ts.reading') || 'null') || {}).theme;
  if (theme === 'light' || theme === 'paper' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // No mirror yet, or no storage: the system theme until the module runs.
}
