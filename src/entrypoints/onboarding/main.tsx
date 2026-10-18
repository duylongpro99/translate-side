import { render } from 'preact';
import { browser } from 'wxt/browser';
import { applyThemeSync, followTheme } from '@/ui/theme';
import { i18n } from '#i18n';
import { Onboarding } from './Onboarding.tsx';
import '../options/style.css';
import './style.css';

// The theme first, from the synchronous mirror, so the first paint is already in it; storage.sync then reconciles.
applyThemeSync();
followTheme(browser);

// The page's title and language follow the browser's UI language (the static ones in index.html are the English default).
document.title = i18n.t('onboarding.title');
document.documentElement.lang = browser.i18n.getUILanguage();

const root = document.getElementById('app');
if (root) render(<Onboarding api={browser} />, root);
