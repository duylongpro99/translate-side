import { render } from 'preact';

// Placeholder options page (M0 scope: no settings yet).
function Options() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '16px' }}>
      <h1>Translate Side settings</h1>
      <p>Settings are not available yet.</p>
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<Options />, root);
