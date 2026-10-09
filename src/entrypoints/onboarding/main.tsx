import { render } from 'preact';
import { browser } from 'wxt/browser';
import { Onboarding } from './Onboarding.tsx';
import '../options/style.css';
import './style.css';

const root = document.getElementById('app');
if (root) render(<Onboarding api={browser} />, root);
