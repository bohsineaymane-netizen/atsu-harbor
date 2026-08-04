# \# Atsumaru Harbor Extension

# 

# A \[Harbor](https://github.com/kodjodevf/mangayomi) source extension that allows users to browse, search, and read manga from \[Atsumaru](https://atsu.moe) inside Harbor.

# 

# \---

# 

# \## Features

# 

# \- Browse popular manga

# \- Search manga by title

# \- View manga details

# \- Display manga covers

# \- Display authors and artists

# \- Display genres

# \- Load complete chapter lists

# \- Read manga chapters

# \- Support tag-based filtering

# \- Fast API-based requests

# 

# \---

# 

# \## About

# 

# This extension connects Harbor with Atsumaru and retrieves publicly available manga information, chapters, and page images.

# 

# The extension uses the same endpoints Atsumaru's own website uses to serve its front end, rather than scraping and parsing HTML pages. This makes data retrieval faster and more reliable, and keeps the extension resilient to changes in the site's visual layout. These are not official, publicly documented APIs — they are the website's own internal endpoints, used here as they're accessed by the public site itself.

# 

# \---

# 

# \## Technical Information

# 

# The extension uses publicly accessible endpoints from Atsumaru's website — the same ones your browser calls when you use atsu.moe directly.

# 

# \*\*Search\*\*

# ```

# /collections/manga/documents/search

# ```

# Looks up manga by title (or browses all manga when no search term is given), and is also used for tag-based filtering.

# 

# \*\*Manga details\*\*

# ```

# /api/manga/page?id={mangaId}

# ```

# Returns a manga's description, cover, authors/artists, genres, and status.

# 

# \*\*Chapters\*\*

# ```

# /api/manga/allChapters?mangaId={mangaId}

# ```

# Returns the complete chapter list for a manga.

# 

# \*\*Reading\*\*

# ```

# /api/read/chapter?mangaId={mangaId}\&chapterId={chapterId}

# ```

# Returns the page images for a specific chapter.

# 

# \*\*Filters\*\*

# ```

# /api/explore/availableFilters

# ```

# Returns the full list of tags and genres available on the site, used to build the filtering options in Harbor.

# 

# \---

# 

# \## Installation

# 

# Add this source URL to Harbor:

# 

# ```

# https://raw.githubusercontent.com/bohsineaymane-netizen/atsu-harbor/main/index.json

# ```

# 

# Steps:

# 

# 1\. Open Harbor.

# 2\. Go to your sources/repositories settings.

# 3\. Add the URL above as a new repository.

# 4\. Find \*\*Atsumaru (atsu.moe)\*\* in the resulting source list and install it.

# 5\. Select it as an active source and start browsing.

# 

# \---

# 

# \## Project Structure

# 

# ```

# atsu-harbor/

# ├── atsu.js

# ├── index.json

# ├── icon.png

# └── README.md

# ```

# 

# \---

# 

# \## Development

# 

# \- Written in JavaScript.

# \- Built specifically for Harbor, using Harbor's source extension format (a `mangayomiSources` manifest and a `DefaultExtension` class).

# \- Converts Atsumaru website data into a format readable by Harbor - mapping manga listings, details, chapters, and page lists into the structures Harbor expects.

# 

# \---

# 

# \## Development Notes

# 

# \- Fixed manga IDs displaying instead of titles.

# \- Added proper manga cover handling.

# \- Implemented manga details.

# \- Implemented complete chapter loading.

# \- Added tag filtering using `tagIds`.

# \- Improved API response parsing.

# 

# \---

# 

# \## Credits

# 

# Created by:

# \*\*Aymane Bohsine\*\*

# 

# GitHub:

# \[https://github.com/bohsineaymane-netizen](https://github.com/bohsineaymane-netizen)

# 

# \---

# 

# \## Disclaimer

# 

# This is an unofficial, community-made extension. It is not affiliated with or endorsed by Atsumaru. It uses publicly accessible website data for personal use.

# 

# \---

# 

# \## License

# 

# Provided for educational and personal use.

