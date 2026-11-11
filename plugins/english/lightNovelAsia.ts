import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { storage } from '@libs/storage';

/**
 * LightNovelAsia (https://lightnovelasia.com)
 *
 * The site is a React SPA backed by Supabase. This plugin talks to the same
 * public REST API the website uses, with the site's public (anon) key, which
 * is the same key every visitor's browser receives.
 *
 * Paid / gated content is NOT bypassed: chapters that cost coins, chapters
 * that are not released yet, and login-exclusive novels are listed with a lock
 * but their text is never requested.
 */
const API = 'https://ouhwjbjvbjcnmbzlfrkl.supabase.co/rest/v1';
const SITE = 'https://lightnovelasia.com';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91aHdqYmp2Ympjbm1iemxmcmtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTMwNzQsImV4cCI6MjA4NTA4OTA3NH0.6_wyMFLThEyPimrEVmBLF9aYRdN1VaEGFtRHXilR8tg';
const PAGE_SIZE = 20;
const CHAPTER_PAGE = 1000;

type CatalogRow = {
  slug: string;
  title: string;
  cover_image?: string | null;
};

class LightNovelAsiaPlugin implements Plugin.PluginBase {
  id = 'lightNovelAsia';
  name = 'LightNovelAsia';
  icon = 'src/en/lightnovelasia/icon.png';
  site = SITE;
  version = '1.0.2';

  imageRequestInit: Plugin.ImageRequestInit = {
    headers: { Referer: SITE + '/' },
  };

  pluginSettings = {
    hideLocked: {
      value: false,
      label: 'Hide locked (coin / unreleased) chapters',
      type: 'Switch',
    },
  };

  filters = {
    sort: {
      type: FilterTypes.Picker,
      label: 'Sort by',
      value: 'total_views.desc',
      options: [
        { label: 'Most viewed', value: 'total_views.desc' },
        { label: 'Recently updated', value: 'updated_at.desc' },
        { label: 'Newest', value: 'created_at.desc' },
        { label: 'Rating', value: 'rating.desc' },
        { label: 'Title (A-Z)', value: 'title.asc' },
      ],
    },
    status: {
      type: FilterTypes.Picker,
      label: 'Status',
      value: '',
      options: [
        { label: 'All', value: '' },
        { label: 'Ongoing', value: 'Ongoing' },
        { label: 'Completed', value: 'Completed' },
        { label: 'Hiatus', value: 'Hiatus' },
      ],
    },
    genre: {
      type: FilterTypes.TextInput,
      label: 'Genre (exact name, e.g. Romance)',
      value: '',
    },
  } satisfies Filters;

  private headers(): Record<string, string> {
    return { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY };
  }

  private async api(query: string): Promise<any[]> {
    const res = await fetchApi(API + query, { headers: this.headers() });
    if (!res.ok) throw new Error('LightNovelAsia API error ' + res.status);
    return res.json();
  }

  private cover(row: CatalogRow): string {
    return row.cover_image || defaultCover;
  }

  private toNovels(rows: CatalogRow[]): Plugin.NovelItem[] {
    return rows
      .filter(r => r.slug && r.title)
      .map(r => ({ name: r.title, path: r.slug, cover: this.cover(r) }));
  }

  private base(): string {
    return (
      'novel_catalog?select=slug,title,cover_image' +
      '&publish_status=eq.Published&deleted_at=is.null'
    );
  }

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    let q = this.base();
    const status = filters?.status?.value;
    const genre = (filters?.genre?.value || '').trim();
    if (status) q += '&status=eq.' + encodeURIComponent(status);
    if (genre) {
      q += '&genres=cs.' + encodeURIComponent('{' + genre.replace(/[{},"]/g, '') + '}');
    }
    const order = showLatestNovels
      ? 'updated_at.desc'
      : filters?.sort?.value || 'total_views.desc';
    q += '&order=' + order;
    q += '&limit=' + PAGE_SIZE + '&offset=' + (pageNo - 1) * PAGE_SIZE;
    return this.toNovels(await this.api('/' + q));
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    // Match word by word, ignoring punctuation and apostrophe style, so
    // "don't be afraid princess" finds "Don't Be Afraid, Princess, ...".
    const words = searchTerm
      .split(/[\s,.!?:;"'`‘’“”()[\]{}*%\\\-–—]+/)
      .filter(w => w.length > 1 || /[^\x00-\x7F]/.test(w));
    if (!words.length) return [];
    const like = (w: string) => encodeURIComponent('*' + w + '*');
    const titleMatch = words.map(w => 'title.ilike.' + like(w)).join(',');
    const originalMatch = words.map(w => 'original_title.ilike.' + like(w)).join(',');
    // Slugs have no apostrophes, so "dont" still finds "Don't ...".
    const slugMatch = words.map(w => 'slug.ilike.' + like(w)).join(',');
    const q =
      this.base() +
      '&or=(and(' + titleMatch + '),and(' + originalMatch + '),and(' + slugMatch + '))' +
      '&order=total_views.desc&limit=' + PAGE_SIZE +
      '&offset=' + (pageNo - 1) * PAGE_SIZE;
    return this.toNovels(await this.api('/' + q));
  }

  private mapStatus(s?: string | null): string {
    const v = (s || '').toLowerCase();
    if (v.indexOf('ongoing') >= 0) return NovelStatus.Ongoing;
    if (v.indexOf('complete') >= 0) return NovelStatus.Completed;
    if (v.indexOf('hiatus') >= 0) return NovelStatus.OnHiatus;
    if (v.indexOf('cancel') >= 0 || v.indexOf('drop') >= 0) {
      return NovelStatus.Cancelled;
    }
    return NovelStatus.Unknown;
  }

  private htmlToText(html: string): string {
    return (html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const rows = await this.api(
      '/novels?select=id,title,author,status,genres,description,cover_image,is_login_exclusive' +
        '&slug=eq.' + encodeURIComponent(novelPath) + '&limit=1',
    );
    const n = rows[0];
    if (!n) throw new Error('Novel not found');

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: n.title,
      cover: n.cover_image || defaultCover,
      author: n.author || undefined,
      status: this.mapStatus(n.status),
      genres: Array.isArray(n.genres) ? n.genres.join(',') : undefined,
      summary: this.htmlToText(n.description || ''),
      chapters: [],
    };

    const hideLocked = !!storage.get('hideLocked');
    const loginOnly = !!n.is_login_exclusive;
    const now = Date.now();
    const chapters: Plugin.ChapterItem[] = [];

    // Never selects `content`: the list only needs metadata.
    let offset = 0;
    for (;;) {
      const page = await this.api(
        '/chapters?select=id,title,chapter_number,sort_order,release_date,coins' +
          '&novel_id=eq.' + n.id +
          '&status=eq.Published&deleted_at=is.null' +
          '&order=sort_order.asc&limit=' + CHAPTER_PAGE + '&offset=' + offset,
      );
      for (let i = 0; i < page.length; i++) {
        const c = page[i];
        const released = !c.release_date || new Date(c.release_date).getTime() <= now;
        const locked = loginOnly || (c.coins || 0) > 0 || !released;
        if (locked && hideLocked) continue;
        const num = Number(c.chapter_number);
        // Same link the website uses, kept after the id for "Open in browser".
        const webPath =
          c.chapter_number != null && c.chapter_number !== ''
            ? encodeURIComponent(novelPath) + '-chapter-' + encodeURIComponent(String(c.chapter_number))
            : 'novel/' + encodeURIComponent(novelPath) + '/chapter/' + c.id;
        chapters.push({
          name: (locked ? '🔒 ' : '') + (c.title || 'Chapter ' + c.chapter_number),
          path: 'chapter/' + c.id + '/' + webPath,
          releaseTime: c.release_date || undefined,
          chapterNumber: isNaN(num) ? undefined : num,
        });
      }
      if (page.length < CHAPTER_PAGE) break;
      offset += CHAPTER_PAGE;
    }
    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    // Path is "chapter/<id>" (older versions) or "chapter/<id>/<web link>".
    const id = chapterPath.split('/')[1] || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Bad chapter path');

    // Metadata first, without content, so gated chapters are never requested.
    const meta = (
      await this.api(
        '/chapters?select=novel_id,coins,release_date&id=eq.' + id + '&limit=1',
      )
    )[0];
    if (!meta) throw new Error('Chapter not found');

    const novel = (
      await this.api(
        '/novels?select=is_login_exclusive&id=eq.' + meta.novel_id + '&limit=1',
      )
    )[0];
    const unreleased =
      !!meta.release_date && new Date(meta.release_date).getTime() > Date.now();
    if ((meta.coins || 0) > 0 || unreleased || (novel && novel.is_login_exclusive)) {
      const when = unreleased
        ? ' It becomes available on ' + String(meta.release_date).slice(0, 10) + '.'
        : '';
      return (
        '<p><b>This chapter is locked on LightNovelAsia</b> (coins, early access or login required).' +
        when +
        ' Open it on the website to read it.</p>'
      );
    }

    const row = (
      await this.api('/chapters?select=title,content,translator_note&id=eq.' + id + '&limit=1')
    )[0];
    if (!row || !row.content) throw new Error('Chapter has no content');

    let html: string = String(row.content);
    html = html
      .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '')
      .replace(/javascript:/gi, '');
    if (row.translator_note) {
      html += '<hr><p><i>Translator note:</i></p>' + String(row.translator_note);
    }
    return html;
  }

  resolveUrl(path: string, isNovel?: boolean): string {
    if (isNovel) return SITE + '/novel/' + encodeURIComponent(path);
    const webPath = path.split('/').slice(2).join('/');
    // Chapters saved by older versions have no web link stored.
    return webPath ? SITE + '/' + webPath : SITE;
  }
}

export default new LightNovelAsiaPlugin();
