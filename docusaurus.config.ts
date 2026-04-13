import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'BlinkLife Wiki',
  tagline: '运动视频打点剪辑应用 — 工程知识库',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: process.env.VERCEL
    ? 'https://wiki.blink-life.com'
    : 'https://boyang2035922.github.io',
  baseUrl: process.env.VERCEL ? '/' : '/blinklife-docs/',

  organizationName: 'boyang2035922',
  projectName: 'blinklife-docs',

  onBrokenLinks: 'warn',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: 'https://github.com/boyang2035922/blinklife-docs/edit/main/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'BlinkLife Wiki',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'wikiSidebar',
          position: 'left',
          label: '文档',
        },
        {
          href: 'https://github.com/boyang2035922/blinklife-docs',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: '文档',
          items: [
            { label: '架构总览', to: '/engineering/architecture-overview' },
            { label: '回放流程', to: '/product/playback-flow' },
            { label: '.blink 文件格式', to: '/engineering/blink-file-format' },
          ],
        },
        {
          title: '项目',
          items: [
            { label: '官网', href: 'https://blink-life.com' },
            { label: 'GitHub', href: 'https://github.com/boyang2035922/blinklife-docs' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} 石家庄灵眸光年科技有限公司`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['dart', 'bash', 'json', 'sql', 'kotlin', 'swift'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
