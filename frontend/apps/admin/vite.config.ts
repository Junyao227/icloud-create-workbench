import { defineConfig } from '@skyroc/web-admin-vite';

export default defineConfig({
  application: {
    css: {
      additionalData: '@use "@/styles/scss/global.scss" as *;'
    },
    plugins: {
      babel: false,
      devtools: false,
      inspect: false,
      projectInfo: false,
      router: { autoCodeSplitting: false },
      removeConsole: false
    }
  }
});
