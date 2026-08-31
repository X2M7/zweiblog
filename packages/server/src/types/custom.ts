export interface CustomPage {
  name: string;
  path: string;
  html: string;
  sandboxMode?: CustomPageSandboxMode;
}
export type CustomType = 'file' | 'folder';
export type CustomPageSandboxMode = 'isolated' | 'trusted';
