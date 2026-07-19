import fs from "fs";
import path from "path";

/**
 * Loads knowledge or lists available knowledge from the .yoof1337-mem directory.
 */
export async function getIntel(sandboxRoot: string, query?: string): Promise<string> {
  const memDir = path.join(sandboxRoot, ".yoof1337-mem");
  
  // Ensure the directory exists
  if (!fs.existsSync(memDir)) {
    fs.mkdirSync(memDir, { recursive: true });
    return `The .yoof1337-mem/ directory was just created. It is currently empty.`;
  }

  const files = fs.readdirSync(memDir).filter(f => f.endsWith(".md"));

  if (files.length === 0) {
    return `No intelligence files (.md) found in .yoof1337-mem/`;
  }

  // If a specific file is requested
  if (query && files.includes(query)) {
    const content = fs.readFileSync(path.join(memDir, query), "utf-8");
    return `--- Intel: ${query} ---\n\n${content}`;
  }

  // If query loosely matches a file
  if (query) {
    const match = files.find(f => f.toLowerCase().includes(query.toLowerCase()));
    if (match) {
      const content = fs.readFileSync(path.join(memDir, match), "utf-8");
      return `--- Intel: ${match} ---\n\n${content}`;
    }
  }

  // Otherwise, list available knowledge
  let output = `Available Intelligence Files in .yoof1337-mem/:\n\n`;
  for (const file of files) {
    const content = fs.readFileSync(path.join(memDir, file), "utf-8");
    let description = "No description.";
    
    // Attempt to extract YAML frontmatter or first heading/paragraph
    const lines = content.split("\n");
    if (lines[0]?.trim() === "---") {
      // Very basic frontmatter extraction
      const descLine = lines.slice(1).find(l => l.startsWith("description:"));
      if (descLine) {
        description = descLine.replace("description:", "").trim();
      }
    } else {
      const firstTextLine = lines.find(l => l.trim().length > 0 && !l.startsWith("#"));
      if (firstTextLine) {
        description = firstTextLine.substring(0, 100) + "...";
      }
    }

    output += `- **${file}**: ${description}\n`;
  }

  output += `\nCall intel_day with the filename to load its full contents.`;
  return output;
}
