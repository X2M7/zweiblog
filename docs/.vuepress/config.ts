import { defineUserConfig } from 'vuepress';
import { searchProPlugin } from 'vuepress-plugin-search-pro';
import theme from './theme.js';

export default defineUserConfig({
  base: '/',

  lang: 'zh-CN',
  title: 'ZweiBlog',
  description: 'ZweiBlog 的官方网站',

  head: [['link', { rel: 'icon', href: '/logo.svg' }]],

  plugins: [searchProPlugin({ indexContent: true })],

  theme,

  pagePatterns: ['**/*.md', '!**/*.snippet.md', '!.vuepress', '!node_modules'],
});
