// Type stubs that mirror LNReader's plugin API (see docs/docs.md in
// https://github.com/lnreader/lnreader-plugins). They exist only so that
// `npm run typecheck` works; at runtime the LNReader app supplies the real
// implementations of everything imported from '@libs/*'.
import type { NovelStatus } from '@libs/novelStatus';
import type { Filters, FilterToValues } from '@libs/filterInputs';

export namespace Plugin {
  export interface NovelItem {
    name: string;
    path: string;
    cover?: string;
  }

  export interface ChapterItem {
    name: string;
    path: string;
    releaseTime?: string;
    chapterNumber?: number;
    page?: string;
    scanlator?: string | string[];
  }

  export interface SourceNovel extends NovelItem {
    genres?: string;
    summary?: string;
    author?: string;
    artist?: string;
    status?: NovelStatus | string;
    rating?: number;
    chapters: ChapterItem[];
    totalPages?: number;
  }

  export interface SourcePage {
    chapters: ChapterItem[];
  }

  export interface ImageRequestInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }

  export interface PopularNovelsOptions<T extends Filters = Filters> {
    showLatestNovels: boolean;
    filters: FilterToValues<T>;
  }

  export interface PluginBase {
    id: string;
    name: string;
    icon: string;
    site: string;
    version: string;
    imageRequestInit?: ImageRequestInit;
    filters?: Filters;
    pluginSettings?: Record<string, unknown>;
    webStorageUtilized?: boolean;
    customJS?: string;
    customCSS?: string;
    popularNovels(
      pageNo: number,
      options: PopularNovelsOptions<any>,
    ): Promise<NovelItem[]>;
    parseNovel(novelPath: string): Promise<SourceNovel>;
    parseChapter(chapterPath: string): Promise<string>;
    searchNovels(searchTerm: string, pageNo: number): Promise<NovelItem[]>;
    resolveUrl?(path: string, isNovel?: boolean): string;
    parsePage?(novelPath: string, page: string): Promise<SourcePage>;
  }
}
