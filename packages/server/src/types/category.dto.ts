export class CreateCategoryDto {
  name: string;
  nameEn?: string;
}

export class UpdateCategoryDto {
  name?: string;
  nameEn?: string;
  password?: string;
  private?: boolean;
}
export type CategoryType = 'category' | 'column';
