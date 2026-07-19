import * as cheerio from "cheerio";

/**
 * Perform an unauthenticated search via DuckDuckGo HTML version.
 */
export async function webSearch(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo returned ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  
  const results: { title: string; url: string; snippet: string }[] = [];

  $(".result").each((_, el) => {
    const title = $(el).find(".result__title").text().trim();
    const resultUrl = $(el).find(".result__url").attr("href")?.trim() || "";
    const snippet = $(el).find(".result__snippet").text().trim();

    // Clean DuckDuckGo redirect URL
    let cleanUrl = resultUrl;
    if (cleanUrl.startsWith("//duckduckgo.com/l/?uddg=")) {
      try {
        const urlObj = new URL("https:" + cleanUrl);
        const uddg = urlObj.searchParams.get("uddg");
        if (uddg) cleanUrl = decodeURIComponent(uddg);
      } catch (e) {
        // Fallback
      }
    }

    if (title && cleanUrl) {
      results.push({ title, url: cleanUrl, snippet });
    }
  });

  return results;
}
