const mangayomiSources = [{
    "name": "Atsumaru",
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

    // Turns a relative path like "posters/xxxxx.jpg" into an absolute URL.
   absoluteImage(path) {
    if (!path) return "";

    if (path.startsWith("http")) {
        return path;
    }

    return "https://cdn.atsu.moe" + path;
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

    // ---- Popular ----
    // GET /api/search/popular
    // NOTE: pagination behavior for this endpoint wasn't confirmed. We pass
    // ?page= defensively and stop paging once an empty list comes back.
    async getPopular(page) {
    const url =
        `${this.source.baseUrl}/collections/manga/documents/search` +
        `?q=*` +
        `&query_by=title,englishTitle,otherNames,authors,acronyms` +
        `&page=${page}` +
        `&per_page=40` +
        `&include_fields=id,title,poster,posterMedium,posterSmall,type,isAdult,status,mbRating,popularity`;

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

    // ---- Latest ----
    // No dedicated "latest" endpoint was found, so this currently reuses
    // Popular as a placeholder. Replace with a real endpoint if one exists
    // (e.g. /api/search/latest or /api/search/recent).
    async getLatestUpdates(page) {
        return this.getPopular(page);
    }

    // ---- Search ----
    // POST https://atsu.moe/collections/manga/documents/search
    // (baseUrl, not apiUrl - the endpoint sits at the domain root, not /api)
    //
    // CONFIRMED against a real typed query ("naruto"). query_by includes
    // englishTitle - hits like "Renge to Naruto!" (englishTitle "Renge and
    // Naruto!") and "Boruto: Naruto Next Generations" only make sense as
    // matches if englishTitle is searched alongside title. per_page:12 was
    // observed identically on two separate captures, so it's used here for
    // parity with the real client, though any per_page value works fine.
    // The response worked without visible evidence of an auth header, so the
    // typesense_api_key preference below is likely unnecessary - left in
    // place as a fallback in case a header is required in some other context.
    async search(query, page) {
    const url =
        `${this.source.baseUrl}/collections/manga/documents/search` +
        `?q=${encodeURIComponent(query)}` +
        `&query_by=title,englishTitle,otherNames,authors,acronyms` +
        `&page=${page}` +
        `&per_page=40` +
        `&include_fields=id,title,poster,posterMedium,posterSmall`;

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
        manga.imageUrl = this.absoluteImage(
    page.poster?.largeImage ||
    page.poster?.image ||
    page.posterMedium ||
    page.posterSmall ||
    page.poster
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

    getFilterList() {
        // No filters were discovered for atsu.moe's popular/search endpoints.
        return [];
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