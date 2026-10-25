export interface VisitSeed {
  viewer: number;
  visited: number;
  aliases: string[];
}

export class createVisitDto {
  pathname: string;
  isNew: boolean;
  seed?: VisitSeed;
}
