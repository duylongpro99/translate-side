import { render } from 'preact';
import { browser } from 'wxt/browser';
import { Options } from './Options.tsx';
import './style.css';

const root = document.getElementById('app');
if (root) render(<Options api={browser} />, root);
