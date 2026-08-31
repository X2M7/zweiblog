export interface MenuItem {
  id: number;
  name: string;
  nameEn?: string;
  value: string;
  level: number;
  children?: MenuItem[];
}
export const defaultMenu: MenuItem[] = [
  {
    id: 0,
    name: '首页',
    nameEn: 'Home',
    value: '/',
    level: 0,
  },
  {
    id: 1,
    name: '标签',
    nameEn: 'Tags',
    value: '/tag',
    level: 0,
  },
  {
    id: 2,
    name: '分类',
    nameEn: 'Categories',
    value: '/category',
    level: 0,
  },
  {
    id: 3,
    name: '时间线',
    nameEn: 'Timeline',
    value: '/timeline',
    level: 0,
  },
  {
    id: 4,
    name: '友链',
    nameEn: 'Links',
    value: '/link',
    level: 0,
  },
  {
    id: 5,
    name: '关于',
    nameEn: 'About',
    value: '/about',
    level: 0,
  },
];
