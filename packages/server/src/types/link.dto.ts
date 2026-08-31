export class LinkItem {
  updatedAt: Date;
  url: string;
  name: string;
  nameEn?: string;
  desc: string;
  descEn?: string;
  logo: string;
}
export class LinkDto {
  url: string;
  name: string;
  nameEn?: string;
  desc: string;
  descEn?: string;
  logo: string;
}

export class LinkPageDto {
  updatedAt: Date;
  content: string;
  contentEn?: string;
}

export class UpdateLinkPageDto {
  content?: string;
  contentEn?: string;
}

export class ReorderLinksDto {
  names: string[];
}
