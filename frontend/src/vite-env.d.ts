/// <reference types="vite/client" />

declare module '*.css';

interface CadriaDesktop {
  pickMediaFiles(): Promise<string[]>;
}

interface Window {
  cadria?: CadriaDesktop;
}
