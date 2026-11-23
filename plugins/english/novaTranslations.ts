import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { storage } from '@libs/storage';

/**
 * Nova Translations (https://www.novatls.com)
 *
 * A server-rendered Next.js site. Only public pages are read, because the
 * site's robots rules ask automated clients to stay out of /api/:
 *  - /browse holds the whole catalog in its page data
 *  - /series/<slug> holds the full chapter list
 *  - /series/<slug>/<number> holds the chapter text in <article>
 *
 * Chapters that cost stardust are NOT bypassed: the site sends no text for
 * them, and the plugin shows a short note instead.
 */
const SITE = 'https://www.novatls.com';
const PAGE_SIZE = 30;

type NovaNovel = {
  slug: string;
  title: string;
  original_title?: string | null;
  author?: string | null;
  synopsis?: string | null;
  cover_image_url?: string | null;
  status?: string | null;
  genre_tags?: string[] | null;
  created_at?: string | null;
  chapter_count?: number | null;
};

type NovaChapter = {
  chapter_number: number;
  title?: string | null;
  stardust_cost?: number | null;
  published_at?: string | null;
};

class NovaTranslationsPlugin implements Plugin.PluginBase {
  id = 'novaTranslations';
  name = 'Nova Translations';
  icon = 'src/en/novatranslations/icon.png';
  site = SITE;
  version = '1.0.0';

  pluginSettings = {
    hideLocked: {
      value: false,
      label: 'Hide locked (stardust) chapters',
      type: 'Switch',
    },
  };

  filters = {
    sort: {
      type: FilterTypes.Picker,
      label: 'Sort by',
      value: 'added',
      options: [
        { label: 'Recently added', value: 'added' },
        { label: 'Most chapters', value: 'chapters' },
        { label: 'A-Z', value: 'az' },
      ],
    },
    status: {
      type: FilterTypes.Picker,
      label: 'Status',
      value: '',
      options: [
        { label: 'All', value: '' },
        { label: 'Ongoing', value: 'ongoing' },
        { label: 'Completed', value: 'completed' },
        { label: 'Hiatus', value: 'hiatus' },
      ],
    },
    genre: {
      type: FilterTypes.TextInput,
      label: 'Genre (e.g. Fantasy)',
      value: '',
    },
  } satisfies Filters;

  resolveUrl = (path: string) => SITE + '/' + path;

  private async page(path: string): Promise<string> {
    const res = await fetchApi(SITE + path);
    if (!res.ok) throw new Error('Nova Translations error ' + res.status);
    return res.text();
  }

  /** Joins the data Next.js embeds in the page's inline scripts. */
  private pageData(html: string): string {
    const $ = parseHTML(html);
    const prefix = 'self.__next_f.push(';
    let data = '';
    $('script').each((_, el) => {
      const code = $(el).html() || '';
      if (code.indexOf(prefix) !== 0) return;
      try {
        const chunk = JSON.parse(code.slice(prefix.length, code.lastIndexOf(')')));
        if (chunk[0] === 1) data += chunk[1];
      } catch {
        // Not a text chunk.
      }
    });
    return data;
  }

  /** Reads the JSON array that follows `key`, or returns [] if it's absent. */
  private readArray<T>(data: string, key: string): T[] {
    const at = data.indexOf(key);
    if (at < 0) return [];
    const start = data.indexOf('[', at);
    let depth = 0;
    let inString = false;
    for (let i = start; i < data.length; i++) {
      const c = data[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') {
        depth--;
        if (depth === 0) return JSON.parse(data.slice(start, i + 1));
      }
    }
    throw new Error('Could not read page data');
  }

  private async catalog(): Promise<NovaNovel[]> {
    const novels = this.readArray<NovaNovel>(
      this.pageData(await this.page('/browse')),
      '"novels":[',
    );
    if (!novels.length) throw new Error('Could not read the catalog');
    return novels;
  }

  private toItem(n: NovaNovel): Plugin.NovelItem {
    return {
      name: n.title,
      path: 'series/' + n.slug,
      cover: n.cover_image_url || defaultCover,
    };
  }

  private paged(novels: NovaNovel[], pageNo: number): Plugin.NovelItem[] {
    return novels
      .slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE)
      .map(n => this.toItem(n));
  }

  async popularNovels(
    pageNo: number,
    { showLatestNovels, filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    let novels = await this.catalog();
    const sort = showLatestNovels ? 'added' : filters?.sort?.value || 'added';
    if (!showLatestNovels) {
      const status = filters?.status?.value;
      const genre = (filters?.genre?.value || '').trim().toLowerCase();
      if (status) novels = novels.filter(n => n.status === status);
      if (genre) {
        novels = novels.filter(n =>
          (n.genre_tags || []).some(g => g.toLowerCase() === genre),
        );
      }
    }
    novels = novels.slice().sort((a, b) => {
      if (sort === 'chapters') return (b.chapter_count || 0) - (a.chapter_count || 0);
      if (sort === 'az') return a.title.localeCompare(b.title);
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
    return this.paged(novels, pageNo);
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    const clean = (s: string) => s.toLowerCase().replace(/['’‘`]/g, '');
    const words = clean(searchTerm).split(/[\s,.!?:;"()[\]{}\-–—]+/).filter(Boolean);
    if (!words.length) return [];
    const matches = (await this.catalog()).filter(n => {
      const text = clean([n.title, n.original_title, n.author, n.slug].join(' '));
      return words.every(w => text.indexOf(w) >= 0);
    });
    return this.paged(matches, pageNo);
  }

  private mapStatus(s?: string | null): string {
    if (s === 'ongoing') return NovelStatus.Ongoing;
    if (s === 'completed') return NovelStatus.Completed;
    if (s === 'hiatus') return NovelStatus.OnHiatus;
    return NovelStatus.Unknown;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const slug = novelPath.split('/')[1];
    const [html, novels] = await Promise.all([this.page('/' + novelPath), this.catalog()]);
    const n = novels.filter(x => x.slug === slug)[0];
    if (!n) throw new Error('Novel not found');

    const list = this.readArray<NovaChapter>(this.pageData(html), '"chapters":[{');
    const hideLocked = !!storage.get('hideLocked');
    return {
      path: novelPath,
      name: n.title,
      cover: n.cover_image_url || defaultCover,
      author: n.author || undefined,
      status: this.mapStatus(n.status),
      genres: (n.genre_tags || []).join(','),
      summary: (n.synopsis || '').replace(/\r/g, '').trim(),
      chapters: list
        .filter(c => !(hideLocked && c.stardust_cost))
        .sort((a, b) => a.chapter_number - b.chapter_number)
        .map(c => ({
          name:
            (c.stardust_cost ? '🔒 ' : '') +
            'Chapter ' + c.chapter_number + (c.title ? ': ' + c.title : ''),
          path: 'series/' + slug + '/' + c.chapter_number,
          releaseTime: c.published_at || undefined,
          chapterNumber: c.chapter_number,
        })),
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const html = await this.page('/' + chapterPath);
    const $ = parseHTML(html);
    const article = $('article').first();
    if (!article.length) {
      if ($('main').text().indexOf('This chapter is locked') >= 0) {
        return (
          '<p><b>This chapter is locked on Nova Translations.</b> ' +
          'Open it on the website to unlock and read it.</p>'
        );
      }
      throw new Error('Chapter text not found');
    }
    article.find('script,style,iframe,ins').remove();
    const text = (article.html() || '').trim();
    if (!text) throw new Error('Chapter has no text');
    return text;
  }
}

export default new NovaTranslationsPlugin();
