/// <reference types="vite/client" />

import type { AppApi } from '../../preload';

declare global {
  interface Window {
    appApi: AppApi;
  }
}
