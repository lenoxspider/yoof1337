import * as cheerio from "cheerio";

/**
 * Fetch a webpage and return its extracted text content.
 */
export async function webFetch(url: string): Promise<{ title: string; content: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  
  if (contentType.includes("application/json")) {
    const json = await response.json();
    return { title: "JSON Data", content: JSON.stringify(json, null, 2) };
  }
  
  if (contentType.includes("text/plain")) {
    const text = await response.text();
    return { title: "Text Data", content: text };
  }

  // Parse HTML
  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove scripts, styles, noscript, etc.
  $("script, style, noscript, iframe, svg, img").remove();

  const title = $("title").text().trim() || "Webpage";
  
  // Extract text and compress multiple newlines/spaces
  let content = $("body").text();
  content = content.replace(/\s+/g, " ").replace(/\n\s*\n/g, "\n").trim();

  return { title, content };
}
