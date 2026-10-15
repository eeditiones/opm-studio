import { defineConfig } from 'vitepress';

// The app is served at the site root; the docs live below it at /docs/.
export default defineConfig({
  title: 'OPM Studio',
  description: 'Transform XML with the Open Processing Model, entirely in the browser',
  base: '/opm-studio/docs/',
  head: [
    ['link', { rel: 'icon', href: '/opm-studio/docs/icon.svg', type: 'image/svg+xml' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap' }],
  ],
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    logo: '/icon.svg',
    nav: [
      { text: 'Tutorial', link: '/tutorials/first-project' },
      { text: 'Documentation', link: '/documentation' },
      { text: 'Open the app', link: 'https://wolfgangmm.github.io/opm-studio/', target: '_self' },
    ],
    sidebar: [
      {
        text: 'Tutorials',
        items: [
          { text: 'Your first project', link: '/tutorials/first-project' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Documentation', link: '/documentation' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/eeditiones' }],
    search: { provider: 'local' },
    footer: { message: 'Released under the AGPL-3.0-or-later license.' },
  },
});
