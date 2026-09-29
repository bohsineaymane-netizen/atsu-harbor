// Harbor native manga plugin for Atsumaru (atsu.moe).
//
// Rewritten against Harbor's real, documented MangaProvider plugin API
// (harbor-manga-plugin-api.md), replacing the earlier Mangayomi-style
// MProvider/mangayomiSources version. That format was borrowed from a
// separate open-source project (kodjodevf/mangayomi) based on an early
// assumption that Harbor loaded those extensions directly - it worked, but
// clearly through some compatibility path, not this native one. This
// version targets the real API directly: a sandboxed Web Worker with no
// DOM/fetch, only the `harbor` bridge (harbor.http, harbor.log) and the
// MangaProvider interface Harbor calls directly.
//
// Two things this format cannot do that the old one attempted:
// - No settings/preferences system exists here at all, so there's no
//   equivalent of the old "Preferred Translation Group" preference.
// - MangaSummary has no `genre` field, so genres (and the artist name) are
//   folded into `description` as labeled lines instead of a dedicated field.

const BASE = "https://atsu.moe";
const API = "https://atsu.moe/api";
const PAGE_SIZE = 48; // matches Harbor's own MANGA_PAGE offset unit

// Turns a relative path into an absolute cdn.atsu.moe URL. Different
// endpoints format this differently - Popular/Search poster fields already
// include a leading "/static/" (e.g. "/static/posters/x.jpg"), but the
// manga detail page's poster.image field doesn't ("posters/x.png", no
// leading slash, no "static/" segment). Normalize both to the same form.
function absoluteImage(path) {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  let clean = path.replace(/^\/+/, "");
  if (!clean.startsWith("static/")) clean = `static/${clean}`;
  return `https://cdn.atsu.moe/${clean}`;
}

// Harbor's MangaSummary.status is a free string, unlike the old Mangayomi
// integer-enum convention - pass through atsu.moe's own status text
// lowercased, which is close enough to the "ongoing"/"completed" style
// Harbor's own UI (and its Completed/Ongoing tabs) seem to expect.
function toStatus(status) {
  if (!status) return undefined;
  return String(status).toLowerCase();
}

function summaryFromDoc(doc) {
  const id = doc?.id != null ? String(doc.id) : undefined;
  if (!id || !doc.title) return null;
  return {
    id,
    title: doc.title,
    cover: absoluteImage(doc.posterMedium || doc.posterSmall || doc.poster),
    status: toStatus(doc.status),
  };
}

// Shared by popular() and search() - both hit the same Typesense endpoint,
// the only difference is q="*" (browse all) vs a real query string, and
// whether a tagId is set. filter_by clauses (views:>0, hidden:!=true) are
// copied from a captured real request; the isAdult/mbContentRating
// exclusion atsu.moe's own frontend applies is deliberately left out so
// adult content is included (the plugin manifest also flags nsfw: true).
async function searchInternal(query, offset, tagId) {
  const page = Math.floor((offset || 0) / PAGE_SIZE) + 1;
  const q = query && query.length ? query : "*";
  let url =
    `${BASE}/collections/manga/documents/search` +
    `?q=${encodeURIComponent(q)}` +
    `&query_by=title,englishTitle,otherNames,authors,acronyms` +
    `&page=${page}` +
    `&per_page=${PAGE_SIZE}` +
    `&include_fields=id,title,poster,posterMedium,posterSmall,type,isAdult,status,mbRating,popularity`;

  const conditions = [];
  // tagId is a real atsu.moe "tags" id (e.g. Swordplay=337), NOT a "genres"
  // id - those are two separate id spaces on atsu.moe's backend, confirmed
  // by a captured live request where selecting "Swordplay" on atsu.moe
  // itself produced filter_by=tagIds:=`337`.
  if (tagId) {
    conditions.push(`tagIds:=\`${tagId}\``);
  }
  conditions.push("views:>0");
  conditions.push("hidden:!=true");
  url += `&filter_by=${encodeURIComponent(conditions.join(" && "))}`;
  // Without this, a q="*" match-all query has no relevance score to sort
  // by and results come back in a near-arbitrary order.
  url += `&sort_by=${encodeURIComponent("views:desc")}`;

  const data = await harbor.http(url, { responseType: "json" });
  const hits = data?.hits ?? [];
  return hits.map(h => summaryFromDoc(h.document)).filter(Boolean);
}

const plugin = {
  id: "atsumaru",
  name: "Atsumaru (atsu.moe)",

  async popular(offset, tagId) {
    return searchInternal("", offset, tagId);
  },

  async search(query, offset, tagId) {
    return searchInternal(query, offset, tagId);
  },

  // GET /api/manga/page?id=<id>
  // The whole payload is nested under "mangaPage", not top-level - confirmed
  // against a real response.
  async detail(id) {
    const data = await harbor.http(`${API}/manga/page?id=${id}`, { responseType: "json" });
    const page = data?.mangaPage;
    if (!page) return null;

    const authors = page.authors ?? [];
    const authorNames = authors.filter(a => a.type === "Author").map(a => a.name);
    const artistNames = authors.filter(a => a.type === "Artist").map(a => a.name);
    const genres = (page.genres ?? []).map(g => g.name);

    // MangaSummary has no genre field and no separate artist field, so fold
    // both into description as labeled lines rather than lose them.
    let description = page.synopsis ?? "";
    const extraLines = [];
    if (artistNames.length && artistNames.join(",") !== authorNames.join(",")) {
      extraLines.push(`Artist: ${artistNames.join(", ")}`);
    }
    if (genres.length) {
      extraLines.push(`Genres: ${genres.join(", ")}`);
    }
    if (extraLines.length) {
      description = `${description}\n\n${extraLines.join("\n")}`.trim();
    }

    return {
      id,
      title: page.title,
      cover: absoluteImage(page.poster?.image || page.poster?.smallImage || page.poster?.id),
      description: description || undefined,
      status: toStatus(page.status),
      author: authorNames.join(", ") || undefined,
      contentRating: page.isAdult ? "adult" : undefined,
    };
  },

  // GET /api/manga/allChapters?mangaId=<id>
  // Each chapter carries a scanlationMangaId linking it to one of several
  // translation groups, each of which numbers its own "Chapter 1",
  // "Chapter 2"... independently - that's the source of atsu.moe's
  // duplicate-chapter problem, which its own site now has a dropdown to
  // filter. Since this plugin format has no settings/preferences system,
  // the best we can do is resolve and expose the real group name per
  // chapter via the `group` field, rather than filter chapters ourselves.
  async chapters(id) {
    const data = await harbor.http(`${API}/manga/allChapters?mangaId=${id}`, { responseType: "json" });
    const chapters = data?.chapters ?? [];

    let scanlatorMap = {};
    try {
      const detailData = await harbor.http(`${API}/manga/page?id=${id}`, { responseType: "json" });
      (detailData?.mangaPage?.scanlators ?? []).forEach(s => { scanlatorMap[s.id] = s.name; });
    } catch (e) {
      // Non-fatal - chapters still work, just without group labels.
    }

    return chapters
      .map(ch => ({
        id: `${id}|${ch.id}`,
        chapter: ch.number != null ? String(ch.number) : null,
        title: ch.title,
        pages: ch.pageCount ?? 0,
        language: "en",
        group: scanlatorMap[ch.scanlationMangaId] || undefined,
        publishAt: ch.createdAt ? new Date(ch.createdAt).toISOString() : undefined,
      }))
      .filter(c => c.id);
  },

  // GET /api/read/chapter?mangaId=<mangaId>&chapterId=<chapterId>
  async pageUrls(chapterId) {
    const [mangaId, realChapterId] = chapterId.split("|");
    const data = await harbor.http(
      `${API}/read/chapter?mangaId=${mangaId}&chapterId=${realChapterId}`,
      { responseType: "json" }
    );
    const pages = data?.readChapter?.pages ?? [];
    return pages.map(p => absoluteImage(p.image)).filter(Boolean);
  },

  // Real, confirmed tag data pulled from atsu.moe's own
  // /api/explore/availableFilters catalog (2401 tags total), filtered to
  // non-adult, non-metadata groups (skipping "Work Info"/"Sexual Content"/
  // "Derivative Work" noise like "Full Color" or "Based on a Novel") and
  // sorted by real popularity (safeCount), not guessed.
  async tags() {
    return [
      ["Shounen", "38"], ["Seinen", "8"], ["School Life", "42"], ["Shoujo", "40"],
      ["Magic", "121"], ["Isekai", "94"], ["Reincarnation", "126"], ["Josei", "43"],
      ["Love Triangle", "125"], ["Royalty", "128"], ["Demons", "160"], ["Revenge", "227"],
      ["Coming of Age", "117"], ["Super Powers", "236"], ["Urban Fantasy", "261"],
      ["Fantasy World", "642"], ["Monsters", "395"], ["Military", "230"],
      ["Special Ability", "883"], ["Swordplay", "337"], ["Pirates", "705"],
      ["21st century", "132"], ["Female Empowerment", "1816"], ["Family Life", "282"],
      ["Nobility", "127"], ["Yuri", "33"], ["Time Skip", "172"], ["European Ambience", "450"],
      ["Violence", "830"], ["Non-human", "547"], ["LGBTQ+", "326"], ["Weak to Strong", "1064"],
      ["Family Drama", "848"], ["Bullying", "235"], ["Unrequited Love", "226"],
      ["Dead Family Member", "831"], ["Flashbacks", "449"], ["Past Plays a Big Role", "648"],
      ["Time Travel", "249"], ["Tsundere", "313"], ["Shoujo Ai", "47"], ["Anti-Hero", "419"],
      ["Game Elements", "399"], ["War", "238"], ["Misunderstandings", "647"],
      ["Betrayal", "403"], ["Gods", "176"], ["Orphans", "237"], ["Character Growth", "879"],
      ["Obsessive Love", "893"], ["Romantic Subplot", "1005"], ["Secret Identity", "260"],
      ["Time Manipulation", "311"], ["Tragic Past", "898"], ["Yandere", "315"],
      ["Ghosts", "229"], ["Urban", "338"], ["Gender Bender", "12"], ["Amnesia", "283"],
      ["Survival", "265"], ["Game World", "641"], ["Death of Loved One", "884"],
      ["Politics", "378"], ["Dragons", "317"], ["Protagonist Strong from the Start", "1822"],
      ["Gourmet", "2"], ["Guns", "341"], ["Dead Parents", "983"], ["Conspiracy", "673"],
      ["Cohabitation", "228"], ["Religion", "498"], ["Delinquents", "239"], ["Marriage", "360"],
      ["Assassins", "357"], ["Sports", "30"]
    ].map(([name, id]) => ({ id, name, group: "Tags" }));
  },
};
