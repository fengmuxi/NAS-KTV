// Polyfill globalThis for older Android WebView (Chrome < 71)
// 部分 CJS 库（qrcode 等）内部通过 globalThis 挂载变量，
// 旧 WebView 不支持该标识符会导致 ReferenceError
if (typeof globalThis === 'undefined') {
  (window as any).globalThis = window;
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
