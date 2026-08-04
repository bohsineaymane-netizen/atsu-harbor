const mangayomiSources = [{
    "name": "Atsumaru (atsu.moe)",
    "lang": "en",
    "baseUrl": "https://atsu.moe",
    "apiUrl": "https://atsu.moe/api",
    "iconUrl": "https://raw.githubusercontent.com/bohsineaymane-netizen/atsu-harbor/main/icon.png",
    "typeSource": "single",
    "itemType": 0,
    "version": "1.0.0",
    "pkgPath": "atsu.js"
}];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    getHeaders(url) {
        return {
            "user-agent": this.getPreference("custom_user_agent"),
        };
    }

    // Turns a relative path into an absolute cdn.atsu.moe URL. Different
    // endpoints format this differently - Popular/Search poster fields
    // already include a leading "/static/" (e.g. "/static/posters/x.jpg"),
    // but the manga detail page's poster.image field doesn't
    // ("posters/x.png", no leading slash, no "static/" segment). Without
    // normalizing both to the same form, the detail page's cover image
    // built a broken URL missing "/static/" entirely, which is why it was
    // blank while Popular/Search thumbnails (already in the right format)
    // worked fine.
    absoluteImage(path) {
        if (!path) return "";
        if (path.startsWith("http")) {
            return path;
        }
        let clean = path.replace(/^\/+/, "");
        if (!clean.startsWith("static/")) {
            clean = `static/${clean}`;
        }
        return `https://cdn.atsu.moe/${clean}`;
    }

    toStatus(status) {
        if (!status) return 5;
        const s = String(status).toLowerCase();
        if (s.includes("ongoing")) return 0;
        if (s.includes("complet")) return 1;
        if (s.includes("hiatus")) return 2;
        if (s.includes("cancel") || s.includes("dropped")) return 3;
        return 5;
    }

    // ---- Shared browse/search URL builder ----
    // Both Popular/Latest and Search hit the same Typesense endpoint, the
    // only difference is q="*" (browse all) vs a real query string, and
    // whether any Tags checkboxes are checked in `filters`.
    //
    // filter_by clauses below are copied directly from a captured real
    // request (tag filter applied on atsu.moe itself), not guessed:
    // tagIds:=`337` && isAdult:=false && (mbContentRating:=[`Safe`,
    // `Suggestive`,`Erotica`] || mbContentRating:!=*) && views:>0 &&
    // hidden:!=true
    buildSearchUrl(query, page, filters) {
        const perPage = 40;
        const q = query && query.length ? query : "*";
        let url =
            `${this.source.baseUrl}/collections/manga/documents/search` +
            `?q=${encodeURIComponent(q)}` +
            `&query_by=title,englishTitle,otherNames,authors,acronyms` +
            `&page=${page}` +
            `&per_page=${perPage}` +
            `&include_fields=id,title,poster,posterMedium,posterSmall,type,isAdult,status,mbRating,popularity`;

        // filters[0] is the "Tags" GroupFilter from getFilterList(). Each
        // entry is a CheckBox; state === true means the user checked it.
        // Values are real "tags" ids (e.g. Swordplay=337), NOT "genres" ids -
        // those are two separate id spaces on atsu.moe's backend and only
        // tags ids are valid for the tagIds field.
        const tagsFilter = filters?.[0];
        const selectedTagIds = (tagsFilter && Array.isArray(tagsFilter.state))
            ? tagsFilter.state.filter(box => box.state === true).map(box => box.value)
            : [];

        const conditions = [];
        if (selectedTagIds.length === 1) {
            conditions.push(`tagIds:=\`${selectedTagIds[0]}\``);
        } else if (selectedTagIds.length > 1) {
            conditions.push(`tagIds:=[${selectedTagIds.map(id => `\`${id}\``).join(",")}]`);
        }
        conditions.push("isAdult:=false");
        conditions.push("(mbContentRating:=[`Safe`,`Suggestive`,`Erotica`] || mbContentRating:!=*)");
        conditions.push("views:>0");
        conditions.push("hidden:!=true");

        url += `&filter_by=${encodeURIComponent(conditions.join(" && "))}`;
        // Without this, a q="*" match-all query has no relevance score to
        // sort by and results come back in a near-arbitrary order - this was
        // missing before, which is the likely cause of "results aren't
        // accurate" (the right manga were probably in there, just buried).
        url += `&sort_by=${encodeURIComponent("views:desc")}`;
        return url;
    }

    // ---- Popular / Latest ----
    // Harbor never passes a filter argument to getPopular/getLatestUpdates -
    // only search() receives the user's actual filter selections. So these
    // just delegate to search() with an empty query and default (unchecked)
    // filter state, matching how every reference extension (e.g.
    // weebcentral.js) handles it.
    async getPopular(page) {
        return this.search("", page, this.getFilterList());
    }

    async getLatestUpdates(page) {
        return this.search("", page, this.getFilterList());
    }

    // ---- Search ----
    // GET https://atsu.moe/collections/manga/documents/search
    // Confirmed working (GET + query string) against real Naruto search
    // traffic. This is also where tag filtering actually has to live, since
    // Harbor only ever passes `filters` into search(), never into
    // getPopular/getLatestUpdates.
    async search(query, page, filters) {
        const url = this.buildSearchUrl(query, page, filters ?? []);
        const response = await this.client.get(url, this.getHeaders());
        const data = JSON.parse(response.body);
        const items = data.hits?.map(x => x.document) ?? [];

        return {
            list: items.map(e => ({
                name: e.title,
                imageUrl: this.absoluteImage(
                    e.posterMedium || e.posterSmall || e.poster
                ),
                link: String(e.id)
            })),
            hasNextPage: items.length === 40
        };
    }

    // ---- Manga Details (+ chapters, fetched inline like MangaDex does) ----
    // GET /api/manga/page?id=<mangaId>
    //
    // CONFIRMED against a real response. The whole payload is nested under
    // "mangaPage", not top-level - that's the one thing worth flagging for
    // future edits. Everything below is a direct field mapping, no guessing.
    async getDetail(url) {
        const mangaId = url;
        const detailUrl = `${this.source.apiUrl}/manga/page?id=${mangaId}`;
        const response = await this.client.get(detailUrl, this.getHeaders());
        const page = JSON.parse(response.body).mangaPage;


        const manga = {};

manga.name = page.title;

const poster =
    page.poster?.image ||
    page.poster?.smallImage ||
    page.poster?.id ||
    "";

const posterUrl = this.absoluteImage(poster);

manga.imageUrl = posterUrl;
manga.thumbnailUrl = posterUrl;
manga.cover = posterUrl;

manga.description = page.synopsis ?? "";
        const authors = page.authors ?? [];
        manga.author = authors.filter(a => a.type === "Author").map(a => a.name).join(", ");
        manga.artist = authors.filter(a => a.type === "Artist").map(a => a.name).join(", ");
        manga.genre = (page.genres ?? []).map(g => g.name);
        manga.status = this.toStatus(page.status);
        // page.chapters is capped (see page.hasMoreChapters) so the full list
        // still needs the dedicated allChapters endpoint below.
        manga.chapters = await this.fetchChapters(mangaId);
        return manga;
    }

    // GET /api/manga/allChapters?mangaId=<id>
    async fetchChapters(mangaId) {
        const url = `${this.source.apiUrl}/manga/allChapters?mangaId=${mangaId}`;
        const response = await this.client.get(url, this.getHeaders());
        const data = JSON.parse(response.body);
        const chapters = data.chapters ?? [];
        return chapters.map(ch => ({
            name: ch.title,
            url: `${mangaId}|${ch.id}`,
            scanlator: "",
            dateUpload: String(ch.createdAt)
        }));
    }

    // ---- Reader / page list ----
    // GET /api/read/chapter?mangaId=<mangaId>&chapterId=<chapterId>
    async getPageList(url) {
        const [mangaId, chapterId] = url.split("|");
        const pageUrl = `${this.source.apiUrl}/read/chapter?mangaId=${mangaId}&chapterId=${chapterId}`;
        const response = await this.client.get(pageUrl, this.getHeaders());
        const data = JSON.parse(response.body);
        const pages = data.readChapter?.pages ?? [];
        return pages.map(p => `${this.source.baseUrl}${p.image}`);
    }

    // Real Harbor filter schema (type_name/state/values), confirmed against
    // weebcentral.js. Values below are real "tags" ids (from atsu.moe's own
    // "tags" array, not "genres") - confirmed by a captured live request
    // where selecting "Swordplay" on atsu.moe itself produced
    // `filter_by=tagIds:=`337`` and 337 is Swordplay's id in the tags array.
    // This list is drawn from atsu.moe's own full tag catalog (2401 tags,
    // each with a real safeCount), filtered to non-adult, non-metadata
    // groups (skipping "Work Info"/"Sexual Content"/"Derivative Work" noise
    // like "Full Color" or "Based on a Novel") and sorted by real safeCount,
    // rather than hand-picked guesses.
    getFilterList() {
        return [
            {
                type_name: "GroupFilter",
                name: "Tags",
                state: [
                    ["Shounen", "38"],
                    ["Seinen", "8"],
                    ["School Life", "42"],
                    ["Shoujo", "40"],
                    ["Magic", "121"],
                    ["Isekai", "94"],
                    ["Reincarnation", "126"],
                    ["Josei", "43"],
                    ["Love Triangle", "125"],
                    ["Royalty", "128"],
                    ["Demons", "160"],
                    ["Revenge", "227"],
                    ["Coming of Age", "117"],
                    ["Super Powers", "236"],
                    ["Urban Fantasy", "261"],
                    ["Fantasy World", "642"],
                    ["Monsters", "395"],
                    ["Military", "230"],
                    ["Special Ability", "883"],
                    ["Swordplay", "337"],
                    ["Pirates", "705"],
                    ["21st century", "132"],
                    ["Female Empowerment", "1816"],
                    ["Family Life", "282"],
                    ["Nobility", "127"],
                    ["Yuri", "33"],
                    ["Time Skip", "172"],
                    ["European Ambience", "450"],
                    ["Violence", "830"],
                    ["Non-human", "547"],
                    ["LGBTQ+", "326"],
                    ["Weak to Strong", "1064"],
                    ["Family Drama", "848"],
                    ["Bullying", "235"],
                    ["Unrequited Love", "226"],
                    ["Dead Family Member", "831"],
                    ["Flashbacks", "449"],
                    ["Past Plays a Big Role", "648"],
                    ["Time Travel", "249"],
                    ["Tsundere", "313"],
                    ["Shoujo Ai", "47"],
                    ["Anti-Hero", "419"],
                    ["Game Elements", "399"],
                    ["War", "238"],
                    ["Misunderstandings", "647"],
                    ["Betrayal", "403"],
                    ["Gods", "176"],
                    ["Orphans", "237"],
                    ["Character Growth", "879"],
                    ["Obsessive Love", "893"],
                    ["Romantic Subplot", "1005"],
                    ["Secret Identity", "260"],
                    ["Time Manipulation", "311"],
                    ["Tragic Past", "898"],
                    ["Yandere", "315"],
                    ["Ghosts", "229"],
                    ["Urban", "338"],
                    ["Gender Bender", "12"],
                    ["Amnesia", "283"],
                    ["Survival", "265"],
                    ["Game World", "641"],
                    ["Death of Loved One", "884"],
                    ["Politics", "378"],
                    ["Dragons", "317"],
                    ["Protagonist Strong from the Start", "1822"],
                    ["Gourmet", "2"],
                    ["Guns", "341"],
                    ["Dead Parents", "983"],
                    ["Conspiracy", "673"],
                    ["Cohabitation", "228"],
                    ["Religion", "498"],
                    ["Delinquents", "239"],
                    ["Marriage", "360"],
                    ["Assassins", "357"],
                    ["Sports", "30"]
                ].map(x => ({ type_name: "CheckBox", name: x[0], value: x[1] }))
            }
        ];
    }

    getPreference(key, defaultValue) {
        const preferences = new SharedPreferences();
        return preferences.get(key, defaultValue);
    }

    getSourcePreferences() {
        return [
            {
                "key": "custom_user_agent",
                "editTextPreference": {
                    "title": "Custom User-Agent",
                    "summary": "",
                    "value": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "dialogTitle": "Set custom User-Agent",
                    "dialogMessage": "Specify a custom user agent"
                }
            },
            {
                "key": "typesense_api_key",
                "editTextPreference": {
                    "title": "Search API key (if required)",
                    "summary": "Only needed if search returns 401/403 - see comments in search()",
                    "value": "",
                    "dialogTitle": "Typesense API key",
                    "dialogMessage": "Paste the x-typesense-api-key value captured from atsu.moe's network requests, if search fails without it."
                }
            }
        ];
    }
}