import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { storage } from '@libs/storage';

/**
 * Lunox Novels (https://lunoxscans.com)
 *
 * A WordPress site on the Madara theme, read as HTML:
 *  - list:    /all-series[/page/N/]?m_orderby=...
 *  - genre:   /series-genre/<genre>[/page/N/]?m_orderby=...
 *  - search:  [/page/N/]?s=...&post_type=wp-manga
 *  - novel:   /series/<slug>/  (lists every chapter)
 *  - chapter: /series/<slug>/chapter-N/
 *
 * Premium chapters are NOT bypassed: the site sends no text for them, and the
 * plugin shows a short note instead.
 */
const SITE = 'https://lunoxscans.com';

const GENRES: [string, string][] = [
  ['Action', 'action'], ['Adult', 'adult'], ['Adventure', 'adventure'], ['Chaebol', 'chaebol'],
  ['Comedy', 'comedy'], ['Drama', 'drama'], ['Fantasy', 'fantasy'], ['Genius', 'genius'],
  ['Growth', 'growth'], ['Harem', 'harem'], ['Historical', 'historical'], ['Horror', 'horror'],
  ['Isekai', 'isekai'], ['Josei', 'josei'], ['Magic', 'magic'], ['Martial Arts', 'martial-arts'],
  ['Mature', 'mature'], ['Mecha', 'mecha'], ['Modern', 'modern'], ['Mystery', 'mystery'],
  ['Possession', 'possession'], ['Progression', 'progression'],
  ['Psychological', 'psychological'], ['Regression', 'regression'],
  ['Reincarnation', 'reincarnation'], ['Revenge', 'revenge'], ['Reverse', 'reverse'],
  ['Romance', 'romance'], ['Royalty', 'royalty'], ['School Life', 'school-life'],
  ['Sci-fi', 'sci-fi'], ['Seinen', 'seinen'], ['Shoujo', 'shoujo'], ['Shounen', 'shounen'],
  ['Slice of Life', 'slice-of-life'], ['Sports', 'sports'], ['Supernatural', 'supernatural'],
  ['Tragedy', 'tragedy'], ['Warrior', 'warrior'], ['Wuxia', 'wuxia'],
];

const LOCKED_NOTE =
  '<p><b>This is a premium chapter on Lunox Novels.</b> ' +
  'Open it on the website to unlock and read it.</p>';

class LunoxScansPlugin implements Plugin.PluginBase {
  id = 'lunoxScans';
  name = 'Lunox Novels';
  icon = 'src/en/lunoxscans/icon.png';
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
      value: 'views',
      options: [
        { label: 'Most viewed', value: 'views' },
        { label: 'Latest update', value: 'latest' },
        { label: 'New', value: 'new-manga' },
        { label: 'A-Z', value: 'alphabet' },
      ],
    },
    genre: {
      type: FilterTypes.Picker,
      label: 'Genre',
      value: '',
      options: [{ label: 'All', value: '' }].concat(
        GENRES.map(g => ({ label: g[0], value: g[1] })),
      ),
    },
  } satisfies Filters;

  resolveUrl = (path: string) => SITE + '/' + path.split('?')[0];

  private toPath(href: string): string {
    const path = href.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '').replace(/[?#].*$/, '');
    return path && !path.endsWith('/') ? path + '/' : path;
  }

  private async html(path: string): Promise<string> {
    const res = await fetchApi(SITE + path);
    if (!res.ok) throw new Error('Lunox Novels error ' + res.status);
    return res.text();
  }

  private parseList(html: string): Plugin.NovelItem[] {
    const $ = parseHTML(html);
    const novels: Plugin.NovelItem[] = [];
    const seen: Record<string, boolean> = {};
    $('.page-listing-item .page-item-detail').each((_, el) => {
      const card = $(el);
      const link = card.find('.post-title a').first();
      const path = this.toPath(link.attr('href') || '');
      if (!path || seen[path]) return;
      seen[path] = true;
      const img = card.find('.item-thumb img').first();
      novels.push({
        name: link.text().trim(),
        path,
        cover: img.attr('data-src') || img.attr('src') || defaultCover,
      });
    });
    return novels;
  }

  async popularNovels(
    pageNo: number,
    { showLatestNovels, filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const sort = showLatestNovels ? 'latest' : filters?.sort?.value || 'views';
    const genre = showLatestNovels ? '' : filters?.genre?.value || '';
    const base = genre ? '/series-genre/' + encodeURIComponent(genre) + '/' : '/all-series/';
    const page = pageNo > 1 ? 'page/' + pageNo + '/' : '';
    return this.parseList(await this.html(base + page + '?m_orderby=' + sort));
  }

  private async search(term: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    const page = pageNo > 1 ? '/page/' + pageNo + '/' : '/';
    return this.parseList(
      await this.html(page + '?s=' + encodeURIComponent(term) + '&post_type=wp-manga'),
    );
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    const term = searchTerm.trim();
    if (!term) return [];
    const found = await this.search(term, pageNo);
    if (found.length || pageNo > 1) return found;
    // Retry with the longest word when the exact phrase finds nothing.
    const longest = term
      .split(/[^A-Za-z0-9]+/)
      .filter(w => w.length > 2)
      .sort((a, b) => b.length - a.length)[0];
    return longest && longest !== term ? this.search(longest, 1) : found;
  }

  private mapStatus(s: string): string {
    const v = s.toLowerCase();
    if (v.indexOf('ongoing') >= 0) return NovelStatus.Ongoing;
    if (v.indexOf('complete') >= 0) return NovelStatus.Completed;
    if (v.indexOf('hiatus') >= 0 || v.indexOf('hold') >= 0) return NovelStatus.OnHiatus;
    if (v.indexOf('cancel') >= 0 || v.indexOf('drop') >= 0) return NovelStatus.Cancelled;
    return NovelStatus.Unknown;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const $ = parseHTML(await this.html('/' + novelPath));

    const row = (label: string) =>
      $('.post-content_item')
        .filter((_, el) => $(el).find('.summary-heading').text().trim().indexOf(label) === 0)
        .first()
        .find('.summary-content');

    const paragraphs = $('.summary__content p, .description-summary p')
      .map((_, el) => $(el).text().replace(/ /g, ' ').trim())
      .get()
      .filter(Boolean);
    // The first line is often just "Read novel <title>".
    if (paragraphs.length > 1 && /^Read novel /i.test(paragraphs[0])) paragraphs.shift();

    const img = $('.summary_image img').first();
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: $('h1').first().text().trim(),
      cover:
        img.attr('data-src') ||
        img.attr('src') ||
        $('meta[property="og:image"]').attr('content') ||
        defaultCover,
      author: row('Author').text().replace(/\s+/g, ' ').trim() || undefined,
      status: this.mapStatus(row('Status').text()),
      genres: row('Genre')
        .find('a')
        .map((_, el) => $(el).text().trim())
        .get()
        .join(','),
      summary: paragraphs.join('\n\n'),
      chapters: [],
    };

    const hideLocked = !!storage.get('hideLocked');
    const seen: Record<string, boolean> = {};
    const chapters: Plugin.ChapterItem[] = [];
    $('a.lunox-chapter-item').each((_, el) => {
      const a = $(el);
      const locked = a.hasClass('premium');
      if (locked && hideLocked) return;
      const name = (a.attr('data-name') || a.find('.lunox-chapter-name').text()).trim();
      const num = name.match(/(\d+(?:\.\d+)?)/);
      let path = this.toPath(a.attr('href') === '#' ? '' : a.attr('href') || '');
      if (!path) {
        // Premium rows have no link. Use the address the chapter gets once it's
        // free, so it doesn't show up twice in the library later.
        const whole = name.match(/^Chapter (\d+)$/i);
        path = whole
          ? novelPath + 'chapter-' + whole[1] + '/'
          : novelPath + '?premium=' + a.attr('data-chapter-id');
      }
      if (seen[path]) return;
      seen[path] = true;
      const date = a.find('.lunox-chapter-date').text().trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      chapters.push({
        name: (locked ? '🔒 ' : '') + name,
        path,
        releaseTime: date ? date[3] + '-' + date[1] + '-' + date[2] : undefined,
        chapterNumber: num ? Number(num[1]) : undefined,
      });
    });
    // The site lists newest first.
    novel.chapters = chapters.reverse();
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    if (chapterPath.indexOf('?premium=') >= 0) return LOCKED_NOTE;
    const $ = parseHTML(await this.html('/' + chapterPath));
    const reading = $('.reading-content').first();
    if (!reading.length) throw new Error('Chapter text not found');
    if (reading.text().indexOf('This chapter is locked') >= 0) return LOCKED_NOTE;

    const textBox = reading.find('.text-left').first();
    const box = textBox.length ? textBox : reading;
    box.find('script,style,iframe,ins').remove();
    // Lines are separated by <br>, which the reader shows with no spacing.
    const html = (box.html() || '')
      .trim()
      .replace(/(\s*<br\s*\/?>\s*)+/gi, '</p><p>')
      .replace(/<p[^>]*>(\s|&nbsp;| )*<\/p>/gi, '');
    if (!html) throw new Error('Chapter has no text');
    return html;
  }
}

export default new LunoxScansPlugin();
