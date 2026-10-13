import { defineConfig } from 'vite';

// Development and headless scripts keep their root URLs; build/preview use Pages' project path.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/scoutlight/' : '/',
}));
