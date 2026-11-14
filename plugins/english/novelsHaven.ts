import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { storage } from '@libs/storage';

/**
 * Novels Haven (https://novelshaventranslations.com)
 *
 * A server-rendered React site:
 *  - listing and search are HTML pages: /series?page=N&sort=..., /series?query=...
 *  - novel details and chapter text come from the page's RSC data, fetched
 *    with the `RSC: 1` header and `?_rsc` (the same request the site makes
 *    when you navigate inside it)
 *  - the full chapter list comes from /api/chapters-list/<series id>
 *
 * Premium chapters are NOT bypassed: the site sends them with no text, and
 * the plugin shows a short note instead.
 */
const SITE = 'https://novelshaventranslations.com';

type Chapter = {
  chapter_num: number | string;
  title?: string | null;
  is_premium?: boolean;
  created_on?: string | null;
};

class NovelsHavenPlugin implements Plugin.PluginBase {
  id = 'novelsHaven';
  name = 'Novels Haven';
  icon = 'src/en/novelshaven/icon.png';
  site = SITE;
  version = '1.0.0';

  imageRequestInit: Plugin.ImageRequestInit = {
    headers: { Referer: SITE + '/' },
  };

  pluginSettings = {
    hideLocked: {
      value: false,
      label: 'Hide premium chapters',
      type: 'Switch',
    },
  };

  filters = {
    sort: {
      type: FilterTypes.Picker,
      label: 'Sort by',
      value: 'daily-rank',
      options: [
        { label: 'Trending (daily rank)', value: 'daily-rank' },
        { label: 'Weekly rank', value: 'weekly-rank' },
        { label: 'Monthly rank', value: 'monthly-rank' },
        { label: 'All time rank', value: 'all-time-rank' },
        { label: 'Last updated', value: 'last-updated' },
        { label: 'Newest', value: 'newest' },
        { label: 'Most bookmarked', value: 'bookmark' },
        { label: 'Most chapters', value: 'total-chapters' },
      ],
    },
  } satisfies Filters;

  resolveUrl = (path: string) => SITE + '/' + path;

  // ---------- listing & search (HTML) ----------

  private async listPage(query: string): Promise<Plugin.NovelItem[]> {
    const res = await fetchApi(SITE + '/series?' + query);
    const $ = parseHTML(await res.text());
    const novels: Plugin.NovelItem[] = [];
    const seen: Record<string, boolean> = {};
    $('article').each((_, el) => {
      const card = $(el);
      const href = card.find('a[href^="/series/"]').first().attr('href') || '';
      const slug = href.replace(/^\/series\//, '').split(/[/?#]/)[0];
      if (!slug || seen[slug]) return;
      seen[slug] = true;
      const img = card.find('img').first();
      const name =
        card
          .find('a[href="/series/' + slug + '"]')
          .filter((_, a) => $(a).find('img').length === 0)
          .first()
          .text()
          .trim() || (img.attr('alt') || '').replace(/ cover$/, '');
      novels.push({
        name,
        path: 'series/' + slug,
        cover: img.attr('src') || defaultCover,
      });
    });
    return novels;
  }

  async popularNovels(
    pageNo: number,
    { showLatestNovels, filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const sort = showLatestNovels ? 'last-updated' : filters?.sort?.value || 'daily-rank';
    return this.listPage(
      'sort=' + encodeURIComponent(sort) + '&order=descending&page=' + pageNo,
    );
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    // The site returns every match on one page.
    if (pageNo > 1) return [];
    const term = searchTerm.trim();
    if (!term) return [];
    const found = await this.listPage('query=' + encodeURIComponent(term));
    if (found.length) return found;

    // The site needs exact wording ("im normal" misses "I'm Normal"). Fall
    // back to the longest word and keep novels whose slug has every word.
    const words = term
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 1);
    if (words.length < 2) return found;
    const longest = words.slice().sort((a, b) => b.length - a.length)[0];
    const wide = await this.listPage('query=' + encodeURIComponent(longest));
    return wide.filter(n => {
      const slug = '-' + n.path.replace(/^series\//, '') + '-';
      return words.every(w => slug.indexOf(w) >= 0);
    });
  }

  // ---------- RSC data helpers ----------

  private async rsc(path: string): Promise<string> {
    const res = await fetchApi(SITE + '/' + path + '?_rsc', {
      headers: { RSC: '1' },
    });
    if (!res.ok) throw new Error('Novels Haven error ' + res.status);
    return res.text();
  }

  /** Reads the JSON object or array that starts at `start`. */
  private readJson(text: string, start: number): any {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1));
      }
    }
    throw new Error('Could not read page data');
  }

  /**
   * Long strings are sent as separate text rows: "\n<id>:T<hex byte length>,<text>".
   * A value of "$<id>" points to one of them.
   */
  private textRow(data: string, id: string): string | null {
    const marker = '\n' + id + ':T';
    const at = data.indexOf(marker);
    if (at < 0) return null;
    const comma = data.indexOf(',', at + marker.length);
    let bytes = parseInt(data.slice(at + marker.length, comma), 16);
    let i = comma + 1;
    // Walk characters until their UTF-8 size adds up to the byte length.
    while (bytes > 0 && i < data.length) {
      const code = data.codePointAt(i) as number;
      bytes -= code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      i += code >= 0x10000 ? 2 : 1;
    }
    return data.slice(comma + 1, i);
  }

  private rscString(data: string, value: unknown): string | null {
    if (typeof value !== 'string') return null;
    if (value.indexOf('$$') === 0) return value.slice(1);
    if (/^\$[0-9a-z]+$/.test(value)) return this.textRow(data, value.slice(1));
    return value;
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private toParagraphs(text: string): string {
    return text
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        // The site marks thoughts and emphasis as *text* / **text**.
        const html = this.escape(line)
          .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
          .replace(/\*([^*]+)\*/g, '<i>$1</i>');
        return '<p>' + html + '</p>';
      })
      .join('');
  }

  // ---------- novel & chapters ----------

  private mapStatus(s?: string | null): string {
    const v = (s || '').toLowerCase();
    if (v.indexOf('ongoing') >= 0) return NovelStatus.Ongoing;
    if (v.indexOf('complete') >= 0) return NovelStatus.Completed;
    if (v.indexOf('hiatus') >= 0) return NovelStatus.OnHiatus;
    if (v.indexOf('drop') >= 0 || v.indexOf('cancel') >= 0) return NovelStatus.Cancelled;
    return NovelStatus.Unknown;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const data = await this.rsc(novelPath);
    const at = data.indexOf('"metadata":{"id":');
    if (at < 0) throw new Error('Novel not found');
    const meta = this.readJson(data, at + '"metadata":'.length);

    const genres: string[] = [];
    (meta.series_genres || []).forEach((g: any) => {
      if (g && g.genres && g.genres.name) genres.push(g.genres.name);
    });

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: meta.title,
      cover: meta.optimized_cover_url || meta.cover_url || defaultCover,
      author: meta.author || undefined,
      status: this.mapStatus(meta.status),
      genres: genres.join(','),
      summary: this.rscString(data, meta.synopsis) || '',
      chapters: [],
    };

    const res = await fetchApi(SITE + '/api/chapters-list/' + meta.id);
    if (!res.ok) throw new Error('Could not load chapter list (' + res.status + ')');
    const list: Chapter[] = await res.json();
    const hideLocked = !!storage.get('hideLocked');
    const slug = novelPath.replace(/^series\//, '');

    novel.chapters = list
      .filter(c => !(hideLocked && c.is_premium))
      .map(c => {
        const num = Number(c.chapter_num);
        return {
          name:
            (c.is_premium ? '🔒 ' : '') +
            'Chapter ' + c.chapter_num + (c.title ? ': ' + c.title : ''),
          path: 'series/' + slug + '/chapter-' + c.chapter_num,
          releaseTime: c.created_on || undefined,
          chapterNumber: isNaN(num) ? undefined : num,
        };
      });
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const data = await this.rsc(chapterPath);
    const match = data.match(
      /\{"id":"[0-9a-f-]{36}","series_id":"[0-9a-f-]{36}","is_premium":(true|false)/,
    );
    if (!match || match.index === undefined) throw new Error('Chapter not found');
    const chapter = this.readJson(data, match.index);
    const text = this.rscString(data, chapter.content);

    if (!text) {
      if (chapter.is_premium) {
        return (
          '<p><b>This is a premium chapter on Novels Haven.</b> ' +
          'Open it on the website to unlock and read it.</p>'
        );
      }
      throw new Error('Chapter has no text');
    }
    return this.toParagraphs(text);
  }
}

export default new NovelsHavenPlugin();
