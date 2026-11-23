import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { storage } from '@libs/storage';

/**
 * Boti Translation (https://www.botitranslation.com)
 *
 * The site is a front end for a public JSON API. Paid chapters are NOT
 * bypassed: the API only sends a short preview for them, and the plugin shows
 * a locked note instead of a cut-off chapter.
 */
const SITE = 'https://www.botitranslation.com';
const API = 'https://api.mystorywave.com/story-wave-backend/api/v1';
const PAGE_SIZE = 20;
const CHAPTER_PAGE_SIZE = 200;

type ApiBook = {
  id: number;
  title: string;
  coverImgUrl?: string | null;
  authorPseudonym?: string | null;
  synopsis?: string | null;
  status?: number | null;
  genreName?: string | null;
  tag?: string | null;
};

type ApiChapter = {
  id: number;
  title?: string | null;
  chapterOrder: number;
  paywallStatus?: string | null;
  paid?: boolean;
  publishTime?: number | null;
  content?: string | null;
  authorNote?: string | null;
};

class BotiTranslationPlugin implements Plugin.PluginBase {
  id = 'botiTranslation';
  name = 'Boti Translation';
  icon = 'src/en/botitranslation/icon.png';
  site = SITE;
  version = '1.0.0';

  pluginSettings = {
    hideLocked: {
      value: false,
      label: 'Hide paid chapters',
      type: 'Switch',
    },
  };

  filters = {
    genre: {
      type: FilterTypes.Picker,
      label: 'Genre',
      value: '',
      options: [
        { label: 'All', value: '' },
        { label: 'Fantasy', value: '1' },
        { label: 'Sci-fi', value: '2' },
        { label: 'Sports', value: '3' },
        { label: 'Urban', value: '4' },
        { label: 'Eastern Fantasy', value: '5' },
        { label: 'Horror & Thriller', value: '6' },
        { label: 'Video Game', value: '7' },
        { label: 'History', value: '8' },
        { label: 'War', value: '9' },
        { label: 'Urban Romance', value: '10' },
        { label: 'Fantasy Romance', value: '11' },
        { label: 'Historical Romance', value: '12' },
        { label: 'Teen', value: '13' },
        { label: 'LGBT+', value: '14' },
        { label: 'Others', value: '16' },
      ],
    },
    status: {
      type: FilterTypes.Picker,
      label: 'Status',
      value: '',
      options: [
        { label: 'All', value: '' },
        { label: 'Ongoing', value: '0' },
        { label: 'Completed', value: '1' },
      ],
    },
    type: {
      type: FilterTypes.Picker,
      label: 'Type',
      value: '',
      options: [
        { label: 'All', value: '' },
        { label: 'Original', value: 'original' },
        { label: 'Translation', value: 'translation' },
      ],
    },
    withinDay: {
      type: FilterTypes.Picker,
      label: 'Updated',
      value: '',
      options: [
        { label: 'Any time', value: '' },
        { label: 'Within 3 days', value: '3' },
        { label: 'Within 7 days', value: '7' },
        { label: 'Within 15 days', value: '15' },
        { label: 'Within 30 days', value: '30' },
      ],
    },
  } satisfies Filters;

  resolveUrl = (path: string) => SITE + '/' + path;

  private async api(path: string, params: Record<string, string | number> = {}): Promise<any> {
    const query = Object.keys(params)
      .filter(k => params[k] !== '')
      .map(k => k + '=' + encodeURIComponent(String(params[k])))
      .join('&');
    const res = await fetchApi(API + path + (query ? '?' + query : ''), {
      headers: { 'site-domain': 'www.botitranslation.com', 'lang': 'en' },
    });
    if (!res.ok) throw new Error('Boti Translation error ' + res.status);
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.message || 'Boti Translation error');
    return json.data;
  }

  private toItem(b: ApiBook): Plugin.NovelItem {
    return { name: b.title.trim(), path: 'book/' + b.id, cover: b.coverImgUrl || defaultCover };
  }

  async popularNovels(
    pageNo: number,
    { showLatestNovels, filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const data = await this.api('/content/books', {
      pageNumber: pageNo,
      pageSize: PAGE_SIZE,
      genre: showLatestNovels ? '' : filters?.genre?.value || '',
      status: showLatestNovels ? '' : filters?.status?.value || '',
      type: showLatestNovels ? '' : filters?.type?.value || '',
      withinDay: showLatestNovels ? '7' : filters?.withinDay?.value || '',
    });
    return (data.list || []).map((b: ApiBook) => this.toItem(b));
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    const term = searchTerm.trim();
    if (!term) return [];
    const search = async (keyWord: string): Promise<ApiBook[]> => {
      const data = await this.api('/content/books/search', {
        keyWord,
        pageNumber: pageNo,
        pageSize: PAGE_SIZE,
      });
      return data.list || [];
    };
    let books = await search(term);
    // Retry with the longest word when the exact phrase finds nothing.
    if (!books.length && pageNo === 1) {
      const longest = term
        .split(/[^A-Za-z0-9]+/)
        .filter(w => w.length > 2)
        .sort((a, b) => b.length - a.length)[0];
      if (longest && longest !== term) books = await search(longest);
    }
    return books.map(b => this.toItem(b));
  }

  private isLocked(c: ApiChapter): boolean {
    return !!c.paywallStatus && c.paywallStatus !== 'free' && !c.paid;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const id = novelPath.split('/')[1];
    if (!/^\d+$/.test(id || '')) throw new Error('Bad novel path');
    const b: ApiBook = await this.api('/content/books/' + id);
    const genres = [b.genreName || ''].concat((b.tag || '').split(','));

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: b.title.trim(),
      cover: b.coverImgUrl || defaultCover,
      author: (b.authorPseudonym || '').trim() || undefined,
      status:
        b.status === 1
          ? NovelStatus.Completed
          : b.status === 0
            ? NovelStatus.Ongoing
            : NovelStatus.Unknown,
      genres: genres.map(g => g.trim()).filter(Boolean).join(','),
      summary: (b.synopsis || '').trim(),
      chapters: [],
    };

    const hideLocked = !!storage.get('hideLocked');
    const all: ApiChapter[] = [];
    for (let page = 1; ; page++) {
      const data = await this.api('/content/chapters/page', {
        bookId: id,
        pageNumber: page,
        pageSize: CHAPTER_PAGE_SIZE,
        sortDirection: 'ASC',
      });
      const list: ApiChapter[] = data.list || [];
      all.push(...list);
      if (!list.length || page >= (data.totalPages || 1)) break;
    }

    novel.chapters = all
      .filter(c => !(hideLocked && this.isLocked(c)))
      .sort((x, y) => x.chapterOrder - y.chapterOrder)
      .map(c => ({
        name: (this.isLocked(c) ? '🔒 ' : '') + (c.title || 'Chapter ' + c.chapterOrder).trim(),
        path: 'chapter/' + c.id,
        releaseTime: c.publishTime ? new Date(c.publishTime).toISOString() : undefined,
        chapterNumber: c.chapterOrder,
      }));
    return novel;
  }

  private clean(html: string): string {
    return html
      .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '')
      .replace(/<p[^>]*>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
      .trim();
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const id = chapterPath.split('/')[1];
    if (!/^\d+$/.test(id || '')) throw new Error('Bad chapter path');
    const c: ApiChapter = await this.api('/content/chapters/' + id);
    if (this.isLocked(c)) {
      return (
        '<p><b>This is a paid chapter on Boti Translation.</b> ' +
        'Open it on the website to unlock and read it.</p>'
      );
    }
    if (!c.content) throw new Error('Chapter has no text');
    let html = this.clean(c.content);
    if (c.authorNote) {
      html += '<hr><p><i>Author note:</i></p>' + this.clean(c.authorNote);
    }
    return html;
  }
}

export default new BotiTranslationPlugin();
