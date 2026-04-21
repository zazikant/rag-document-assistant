import { Pinecone } from '@pinecone-database/pinecone';
import { v4 as uuidv4 } from 'uuid';

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

export const pineconeIndex = pinecone.Index('rag-documents');
export const PINECONE_INDEX_NAME = 'rag-documents';
export const EMBEDDING_MODEL = 'multilingual-e5-large';
export const EMBEDDING_DIMENSION = 1024;

/**
 * Chunk text into overlapping pieces for embedding.
 * Simple overlapping chunker matching the reference Python implementation.
 */
function chunkText(text: string, chunkSize: number = 500, overlap: number = 50): string[] {
  if (!text || text.length === 0) return [];


  const chunks: string[] = [];
  let start = 0;


  while (start < text.length) {
    const end = start + chunkSize;
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    start = end - overlap;
  }

  return chunks;
}

export interface ChunkMetadata {
  filename: string;
  doc_type?: string;
  project?: string;
  version?: string;
  uploaded_at?: number;
}

/**
 * Upsert document chunks into Pinecone using multilingual-e5-large.
 * - Deletes previous chunks for the same filename
 * - Embeds with correct input_type="passage"
 * - Upserts with full metadata (filename, text, chunk_index, total_chunks, doc_type, project, version, uploaded_at)
 */
export async function upsertRecords(
  text: string,
  filename: string,
  metadata?: ChunkMetadata
): Promise<{ status: string; filename: string; chunks: number }> {
  if (!text || !filename) {
    throw new Error('text and filename are required');
  }

  const chunkSize = 500;
  const chunks = chunkText(text, chunkSize);

  if (chunks.length === 0) {
    return { status: 'error', filename, chunks: 0 };
  }

  await pineconeIndex.deleteMany({
    filter: { filename: { $eq: filename } },
  });

  const embeddingsResponse = await pinecone.inference.embed({
    model: EMBEDDING_MODEL,
    inputs: chunks,
    parameters: {
      input_type: 'passage',
      truncate: 'END',
    },
  });

  const vectors = embeddingsResponse.data.map((emb: any, i: number) => ({
    id: `${filename}_${i}_${uuidv4().slice(0, 8)}`,
    values: emb.values as number[],
    metadata: {
      filename,
      text: chunks[i],
      chunk_index: i,
      total_chunks: chunks.length,
      doc_type: metadata?.doc_type || 'unknown',
      project: metadata?.project || 'default',
      version: metadata?.version || '1.0',
      uploaded_at: metadata?.uploaded_at || Date.now(),
    },
  }));

  // 5. Upsert to Pinecone
  if (vectors.length > 0) {
    await pineconeIndex.upsert({ records: vectors });
  }

  return {
    status: 'success',
    filename,
    chunks: chunks.length,
  };
}

/**
 * Delete all records for a given filename from Pinecone.
 */
export async function deleteRecords(filename: string): Promise<void> {
  await pineconeIndex.deleteMany({
    filter: { filename: { $eq: filename } },
  });
}

/**
 * Search Pinecone for relevant chunks using multilingual-e5-large.
 * Uses input_type="query" for the search query.
 * Returns top-K hits with metadata (text, filename).
 */
export async function searchRecords(
  query: string,
  topK: number = 8,
  minScore: number = 0.70,
  filter?: { doc_type?: string; project?: string },
  forceAggregation?: boolean
): Promise<Array<{ text: string; filename: string; score: number }>> {
  const aggregationKeywords = ['all', 'every', 'list', 'how many', 'compare', 'show me', 'find all', 'get all', 'total', 'count'];
  const isAggregation = forceAggregation || aggregationKeywords.some(kw => query.toLowerCase().includes(kw));
  const effectiveTopK = isAggregation ? 50 : topK;
  const effectiveMinScore = isAggregation ? 0.50 : minScore;


  const queryEmbedding = await pinecone.inference.embed({
    model: EMBEDDING_MODEL,
    inputs: [query],
    parameters: {
      input_type: 'query',
      truncate: 'END',
    },
  });

  const queryVector = (queryEmbedding.data as any[])[0].values as number[];


  const queryOptions: any = {
    vector: queryVector,
    topK: effectiveTopK,
    includeMetadata: true,
  };

  if (filter && (filter.doc_type || filter.project)) {
    const metadataFilter: any = {};
    if (filter.doc_type) metadataFilter.doc_type = { $eq: filter.doc_type };
    if (filter.project) metadataFilter.project = { $eq: filter.project };
    queryOptions.filter = metadataFilter;
  }

  const searchResponse = await pineconeIndex.query(queryOptions);

  return (searchResponse.matches || [])
    .filter((match: any) => match.score >= effectiveMinScore)
    .map((match: any) => ({
      text: match.metadata?.text || '',
      filename: match.metadata?.filename || '',
      score: match.score || 0,
    }));
}

export default pinecone;