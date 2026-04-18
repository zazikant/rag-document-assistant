/**
 * Chunk text into overlapping pieces for embedding.
 * Uses a simple fixed-size chunking strategy with overlap.
 * 
 * @param text - The full text to chunk
 * @param chunkSize - Max characters per chunk (default 1000)
 * @param overlap - Overlap characters between chunks (default 200)
 * @returns Array of chunk strings
 */
export function chunkText(
  text: string,
  chunkSize: number = 1000,
  overlap: number = 200
): string[] {
  if (!text || text.length === 0) return [];
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;

    // If not at the end, try to break at a sentence/word boundary
    if (end < text.length) {
      // Look for sentence boundary within the last 100 chars
      const searchStart = Math.max(start + chunkSize - 100, start);
      const searchRegion = text.slice(searchStart, end + 50);
      
      const sentenceEnd = searchRegion.lastIndexOf('. ');
      const newlineEnd = searchRegion.lastIndexOf('\n');
      const bestBreak = Math.max(sentenceEnd, newlineEnd);

      if (bestBreak > 0) {
        end = searchStart + bestBreak + 1;
      } else {
        // Fall back to word boundary
        const wordBreak = text.lastIndexOf(' ', end);
        if (wordBreak > start) {
          end = wordBreak;
        }
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    start = end - overlap;
    if (start <= end - chunkSize) {
      start = end; // Prevent infinite loop
    }
  }

  return chunks;
}
