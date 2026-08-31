import { getDirname, path } from '@vuepress/utils';
import { hopeTheme } from 'vuepress-theme-hope';

const __dirname = getDirname(import.meta.url);

export default hopeTheme({
  hostname: 'https://x2m7.github.io/zweiblog',

  docsRepo: 'X2M7/zweiblog',
  docsBranch: 'main',
  docsDir: 'docs',
  author: {
    name: 'ZweiBlog Contributors',
    url: 'https://github.com/X2M7/zweiblog/graphs/contributors',
  },

  darkmode: 'switch',
  iconAssets: 'fontawesome-with-brands',

  logo: '/logo.svg',

  repo: 'X2M7/zweiblog',

  // navbar
  navbar: [
    '/intro',
    '/guide/get-started',
    '/features/',
    '/faq/',
    {
      text: '部署',
      icon: 'fas fa-server',
      link: 'https://github.com/X2M7/zweiblog#docker-%E8%87%AA%E6%89%98%E7%AE%A1%E9%83%A8%E7%BD%B2%E6%8E%A8%E8%8D%90',
    },
  ],

  sidebar: 'structure',

  footer: 'GPL-3.0 协议',

  displayFooter: true,

  pageInfo: ['Author', 'Original', 'Date', 'Category', 'Tag', 'ReadingTime'],

  plugins: {
    mdEnhance: {
      align: true,
      codetabs: true,
      figure: true,
      imgLazyload: true,
      imgSize: true,
      include: {
        deep: true,
        resolvePath: (filePath, cwd) => {
          if (filePath.startsWith('@'))
            return filePath.replace('@', path.resolve(__dirname, '../'));

          return path.resolve(cwd, filePath);
        },
      },
      tabs: true,
      tasklist: true,
    },
  },
});
