export const standalonePageEditorActions = [
  {
    type: 'link',
    key: 'editLinkPage',
    title: '友链',
    buttonLabel: '编辑友链',
    exportLabel: '导出友链',
    previewPath: '/link',
    emptyEnglishHint: '英文为空时优先显示中文；中英文均为空时显示内置申请说明。',
  },
  {
    type: 'about',
    key: 'editAboutMe',
    title: '关于',
    buttonLabel: '编辑关于',
    exportLabel: '导出关于',
    previewPath: '/about',
    emptyEnglishHint: '英文关于内容为空时，前台自动显示中文。',
  },
] as const;

export type StandalonePageType = (typeof standalonePageEditorActions)[number]['type'];

export function getStandalonePageConfig(type: string | undefined) {
  return standalonePageEditorActions.find((page) => page.type === type);
}

export function getStandalonePageEditorPath(type: StandalonePageType): string {
  return `/editor?type=${type}&id=0`;
}
