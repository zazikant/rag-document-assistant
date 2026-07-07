import { NextRequest } from 'next/server';
import { searchRecords, rerankAndAggregate, buildContextFromAggregated } from '@/lib/pinecone';
import { nvidiaChatStreamControlled } from '@/lib/nvidia';
import { supabase, DOCUMENTS_TABLE } from '@/lib/supabase';

/**
 * Streaming RAG query endpoint (Server-Sent Events).
 *
 * POST /api/query-stream
 *   { query, top_k?, filters?, mode? }
 *
 * Response: text/event-stream with structured events:
 *   stage-start / log / chunk / stage-end / pipeline-end / error
 *
 * Pipeline:
 *   1. Search Pinecone
 *   2. Validate sources (Supabase)
 *   3. Aggregate by document
 *   4. Reduce (optional LLM call — only if multi-chunk)
 *   5. Answer (LLM call — streams tokens live)
 *
 * Each LLM call uses the ax-translator controlled-call pattern:
 *   - 28s per-call timeout (proven reliable for gpt-oss-120b on Vercel Edge)
 *   - 1 attempt per server call
 *   - stream:true + drain SSE chunks
 *   - Structured log lines emitted as SSE events
 *
 * Edge runtime: required because Vercel Node serverless hangs on
 * gpt-oss-120b (confirmed via extensive testing on ax-translator +
 * atomic-graph). Edge uses a different egress that works.
 */
export const maxDuration = 30;
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface QueryRequest {
  query: string;
  top_k?: number;
  filters?: {
    doc_type?: string;
    project?: string;
  };
  mode?: 'conversational' | 'precise';
}

const SYSTEM_PROMPT = `You are a helpful coding assistant and second brain. STRICT RULES:
1. Use ONLY the provided Context to answer the Question. Do NOT guess or assume details.
2. If the Context mentions something related to the question, use that information.
3. If the Context does NOT contain relevant information, say "I don't have that information in my knowledge base."
4. CRITICAL: When answering about specific entities (people, products, companies, etc.):
   - ONLY use attributes explicitly stated in the Context
   - Do NOT attribute characteristics from one entity to another
   - If you cannot verify an attribute in Context, do NOT include it
5. Be concise but comprehensive in your answers.
6. Always cite sources using [Document: filename] when using information from Context.
7. For coding questions: suggest code examples, patterns, or architecture when relevant.
8. Never make up APIs, function names, or implementation details not in Context.`;

const REDUCER_PROMPT = `You are a research assistant. Given multiple document chunks about the same topic, synthesize them into a coherent summary.

Task:
1. Extract key information from each chunk
2. Merge overlapping information
3. Note any conflicts or differences
4. Provide a unified, comprehensive response

Format your response as:
- Key Points: (bulleted list of main findings)
- Details: (comprehensive answer combining all sources)
- Conflicts: (any disagreements between sources, or "None" if consistent)
- Sources: (list of which documents contributed)`;

interface SSEEvent {
  type: string;
  [k: string]: unknown;
}

function sse(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: NextRequest) {
  const body: QueryRequest = await request.json();
  const { query, filters, mode = 'conversational' } = body;

  if (!query || query.trim().length === 0) {
    return new Response(
      JSON.stringify({ error: 'Query is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const effectiveTopK = mode === 'precise' ? 5 : 12;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SSEEvent) => {
        try {
          controller.enqueue(encoder.encode(sse({ ...event, ts: Date.now() })));
        } catch {
          // Controller may be closed if client disconnected
        }
      };

      try {
        // ─── STEP 1: SEARCH PINECONE ──────────────────────────
        emit({ type: 'stage-start', stage: 'search' });
        emit({ type: 'log', line: `[pipeline] Searching Pinecone (topK=${effectiveTopK}, mode=${mode})…` });

        let hits;
        try {
          hits = await searchRecords(query, effectiveTopK, 0.50, filters);
        } catch (error: any) {
          emit({ type: 'error', message: `Search failed: ${error.message}` });
          emit({ type: 'pipeline-end', result: { error: error.message } });
          controller.close();
          return;
        }

        emit({
          type: 'stage-end',
          stage: 'search',
          ok: true,
          elapsedMs: 0,
          summary: `${hits?.length || 0} hits`,
        });

        if (!hits || hits.length === 0) {
          const result = {
            answer: 'No relevant documents found. Upload some documents to build your knowledge base.',
            sources: [],
            aggregatedContext: null,
            debug: { hitsFound: 0, documentsAggregated: 0, reducerUsed: false },
          };
          emit({ type: 'pipeline-end', result });
          controller.close();
          return;
        }

        // ─── STEP 2: VALIDATE SOURCES ─────────────────────────
        emit({ type: 'stage-start', stage: 'validate-sources' });
        emit({ type: 'log', line: `[pipeline] Validating sources against Supabase documents table…` });

        const rawSources = [...new Set(hits.map((h) => h.filename))];
        const { data: validDocuments } = await supabase
          .from(DOCUMENTS_TABLE)
          .select('filename')
          .in('filename', rawSources);

        const validFilenames = new Set((validDocuments || []).map((d: any) => d.filename));
        const sources = rawSources.filter((f: string) => validFilenames.has(f));
        const validHits = hits.filter((h) => validFilenames.has(h.filename));

        emit({
          type: 'stage-end',
          stage: 'validate-sources',
          ok: true,
          elapsedMs: 0,
          summary: `${sources.length}/${rawSources.length} sources valid`,
        });

        if (validHits.length === 0) {
          const result = {
            answer: 'Found documents but none are in the verified index. Try re-uploading.',
            sources: [],
            aggregatedContext: null,
            debug: { hitsFound: 0, documentsAggregated: 0, reducerUsed: false },
          };
          emit({ type: 'pipeline-end', result });
          controller.close();
          return;
        }

        // ─── STEP 3: AGGREGATE BY DOCUMENT ────────────────────
        emit({ type: 'stage-start', stage: 'aggregate' });
        const aggregated = rerankAndAggregate(validHits);
        const context = buildContextFromAggregated(aggregated, 5000);
        emit({
          type: 'stage-end',
          stage: 'aggregate',
          ok: true,
          elapsedMs: 0,
          summary: `${aggregated.length} documents aggregated, ${context.length} chars context`,
        });

        // ─── STEP 4: REDUCE (optional LLM call) ───────────────
        let reducedContext = context;
        const reducerNeeded = aggregated.some((a) => a.chunkCount > 1);

        if (reducerNeeded) {
          emit({ type: 'stage-start', stage: 'reduce' });
          emit({ type: 'log', line: `[pipeline] Multi-chunk aggregation — calling NVIDIA to reduce context…` });

          try {
            const reduceResult = await nvidiaChatStreamControlled({
              messages: [
                { role: 'system', content: REDUCER_PROMPT },
                { role: 'user', content: `Question: ${query}\n\nContext:\n${context}\n\nPlease synthesize this information.` },
              ],
              temperature: 0.2,
              maxTokens: 1024,
              onLog: (line) => emit({ type: 'log', line }),
              // Don't stream reduce chunks to the user — they're internal
            });
            reducedContext = reduceResult.content;
            emit({
              type: 'stage-end',
              stage: 'reduce',
              ok: true,
              elapsedMs: reduceResult.elapsedMs,
              summary: `${reducedContext.length} chars reduced context`,
            });
          } catch (reduceError: any) {
            emit({
              type: 'stage-end',
              stage: 'reduce',
              ok: false,
              elapsedMs: 0,
              summary: `Reduce failed: ${reduceError.message?.slice(0, 100)} — using raw context`,
            });
            // Continue with raw context — reduce is optional
          }
        } else {
          emit({ type: 'log', line: `[pipeline] Single-chunk answers — skipping reduce step` });
        }

        // ─── STEP 5: FINAL ANSWER (LLM call with live streaming) ──
        emit({ type: 'stage-start', stage: 'answer' });
        emit({ type: 'log', line: `[pipeline] Generating final answer (streaming tokens live)…` });

        let answer = '';
        try {
          const answerResult = await nvidiaChatStreamControlled({
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: `Context:\n${reducedContext}\n\n---\n\nQuestion: ${query}` },
            ],
            temperature: mode === 'precise' ? 0.1 : 0.3,
            maxTokens: 2048,
            onLog: (line) => emit({ type: 'log', line }),
            onChunk: (text) => {
              answer += text;
              emit({ type: 'chunk', text });
            },
          });

          emit({
            type: 'stage-end',
            stage: 'answer',
            ok: true,
            elapsedMs: answerResult.elapsedMs,
            summary: `${answer.length} chars answer`,
          });

          const result = {
            answer: answer || 'No answer generated.',
            sources,
            aggregatedContext: reducedContext !== context ? reducedContext : null,
            debug: {
              hitsFound: validHits.length,
              documentsAggregated: aggregated.length,
              reducerUsed: reducerNeeded,
            },
          };
          emit({ type: 'pipeline-end', result });
        } catch (answerError: any) {
          emit({
            type: 'stage-end',
            stage: 'answer',
            ok: false,
            elapsedMs: 0,
            summary: `Answer failed: ${answerError.message?.slice(0, 150)}`,
          });
          emit({ type: 'error', message: answerError.message });
          emit({
            type: 'pipeline-end',
            result: {
              answer: '',
              sources,
              error: answerError.message,
              debug: {
                hitsFound: validHits.length,
                documentsAggregated: aggregated.length,
                reducerUsed: reducerNeeded,
              },
            },
          });
        }
      } catch (error: any) {
        emit({ type: 'error', message: error.message });
        emit({ type: 'pipeline-end', result: { error: error.message } });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
