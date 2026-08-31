export class AboutDto {
  updatedAt: Date;
  content: string;
  contentEn?: string;
}

export class UpdateAboutDto {
  content?: string;
  contentEn?: string;
}
