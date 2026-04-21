import { NextRequest, NextResponse } from 'next/server';
import { searchRecords } from '@/lib/pinecone';
import { nvidiaChatCompletion } from '@/lib/nvidia';

export const maxDuration = 120; // 2 min to accommodate up to 3 retries × 15s wait

interface QueryRequest {
  query: string;
  top_k?: number;
  filters?: {
    doc_type?: string;
    project?: string;
  };
}

const SYSTEM_PROMPT = `You are an intelligent document assistant.
Rules:
1. Never say not enough information if partial reasoning is possible.
2. CEO = MD = Chief Executive Officer = Head; CFO = Finance Head, COO = Operations Head
3. If documents conflict show both values and cite each source.
4. For SQL always prefer schema document over sample data when they conflict.
5. Always cite source for every fact.`;

export async function POST(request: NextRequest) {
  try {
    const body: QueryRequest = await request.json();
    const { query, top_k, filters } = body;


    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { status: 'Error', error: 'Query is required' },
        { status: 400 }
      );
    }

    // =================== STEP 1: SEARCH PINECONE ===================
    let hits: Array<{ text: string; filename: string; score: number }>;
    try {
      hits = await searchRecords(query, top_k || 8, 0.70, filters);
    } catch (error: any) {
      console.error('Pinecone search error:', error);
      return NextResponse.json(
        { status: 'Error', error: `Search failed: ${error.message}` },
        { status: 500 }
      );
    }

    if (!hits || hits.length === 0) {
      return NextResponse.json({
        answer: 'No relevant documents found for your query. Please upload some documents first.',
        sources: [],
      });
    }

    // =================== STEP 2: BUILD CONTEXT ===================
    const context = hits
      .map((hit) => `[Document: ${hit.filename}]\n${hit.text}`)
      .join('\n\n---\n\n');

    // Collect unique source filenames
    const sources = [...new Set(hits.map((h) => h.filename))];


    // =================== STEP 3: CALL NVIDIA LLM (with built-in retry) ===================
    const messages = [
      {
        role: 'system' as const,
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user' as const,
        content: `Context:\n${context}\n\n---\n\nQuestion: ${query}`,
      },
    ];

    try {
      // nvidiaChatCompletion now retries up to 3 times on timeout / rate-limit (429/5xx)
      const completion = await nvidiaChatCompletion({
        messages,
        temperature: 0.3, // Lower temperature for factual RAG responses
        maxTokens: 2048,
      });

      const answer = completion.choices[0]?.message?.content || 'No answer generated.';

      return NextResponse.json({
        answer,
        sources,
      });
    } catch (error: any) {
      console.error('LLM error after retries:', error);
      const errMsg = error?.status === 429
        ? 'LLM rate limit exceeded — please try again in a moment'
        : error?.status >= 500
          ? 'LLM server error — please try again later'
          : `LLM error: ${error.message}`;
      return NextResponse.json(
        { status: 'Error', error: errMsg },
        { status: 502 }
      );
    }
  } catch (error: any) {
    console.error('Query error:', error);
    return NextResponse.json(
      { status: 'Error', error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}