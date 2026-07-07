import { NextRequest } from 'next/server';
import { searchRecords, rerankAndAggregate, buildContextFromAggregated } from '@/lib/pinecone-edge';
import { nvidiaChatStreamControlled } from '@/lib/nvidia';

// Note: We use pinecone-edge (direct REST API) instead of pinecone (SDK)
// because the Pinecone SDK pulls in node:stream which is unsupported in
// Edge runtime. Same for @supabase/supabase-js — we use the REST API
// directly when source validation is needed.

/**
 * Streaming RAG query endpoint (Server-Sent Events) — DSPy-style.
 *
 * POST /api/query-stream
 *   { query, top_k?, filters?, mode? }
 *
 * Response: text/event-stream with structured events:
 *   stage-start / log / chunk / stage-end / pipeline-end / error
 *
 * DSPy-style pipeline (ax-translator pattern):
 *   1. Search Pinecone
 *   2. Validate sources (Supabase) — skipped if Supabase not configured
 *   3. Aggregate by document
 *   4. Reduce (Signature: "context, question -> synthesized_context")
 *      — only if multi-chunk aggregation
 *   5. Answer (Signature: "context, question -> intelligent_answer")
 *      — streams tokens live, up to 30K chars
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

// ─── DSPy-style Signature Prompts (ax-translator pattern) ─────
// Like DSPy Modules — each prompt is a focused Signature with clear
// input/output contracts. The model is told WHEN to be short vs long.

const SYSTEM_PROMPT = `You are an intelligent second-brain assistant with deep reasoning ability. You don't merely retrieve — you REASON through the context to produce the smartest, most useful answer.

STRICT FIDELITY RULES:
1. Use ONLY the provided Context to answer. Do NOT guess or assume details not in Context.
2. If the Context does NOT contain relevant information, say: "I don't have that information in my knowledge base."
3. When discussing specific entities (people, products, companies), use ONLY attributes explicitly stated — never transfer characteristics from one entity to another.
4. Always cite sources inline as [Document: filename] when using information from Context.
5. Never fabricate APIs, function names, or implementation details not in Context.

ADAPTIVE LENGTH (the key skill):
Match your answer length to the question's complexity. Be CONCISE when the question is simple; be COMPREHENSIVE when the question is complex.

- SHORT (2-4 sentences, ~200 chars): factual lookups — "What is X?", "Who owns Y?", "When did Z happen?"
- MEDIUM (1-3 paragraphs, ~800 chars): how/why questions about a single concept
- LONG (multiple sections, ~3000 chars): multi-faceted questions, architecture explanations, comparisons
- VERY LONG (detailed with code/examples, up to 30000 chars): complex technical questions, full implementation guides, deep architectural reasoning, multi-step tutorials

QUALITY RULES:
- Lead with the direct answer, then expand. Don't bury the lede.
- For coding questions: provide concrete code examples, patterns, and architecture when the context supports it.
- For conceptual questions: structure with headers, bullet points, and clear reasoning.
- For multi-part questions: address each part explicitly.
- When the context has gaps, say what you CAN answer and explicitly note what's missing.
- Be the smartest version of yourself — synthesize, infer logical consequences, draw connections the writer implied but didn't state.`;

const REDUCER_PROMPT = `You are a research synthesis engine. Given multiple document chunks about the same topic, REASON through them to produce a coherent, comprehensive synthesis.

Task:
1. Extract key information from each chunk
2. Merge overlapping information intelligently (don't just concatenate)
3. Note any conflicts or differences between sources
4. Infer connections that span multiple chunks
5. Provide a unified, comprehensive synthesis

Format your response as:
- Key Points: (bulleted list of main findings, each 1-2 sentences)
- Details: (comprehensive synthesis combining all sources, with inline citations)
- Conflicts: (any disagreements between sources, or "None" if consistent)
- Sources: (list of which documents contributed)

Be thorough — this synthesis will be used as context for the final answer, so include all relevant details from the chunks.`;

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
        // Use Supabase REST API directly (not the JS client) because the
        // JS client pulls in node:stream which is unsupported in Edge runtime.
        // If Supabase env vars are not set, skip validation and trust all hits.
        emit({ type: 'stage-start', stage: 'validate-sources' });

        const rawSources = [...new Set(hits.map((h) => h.filename))];
        let sources: string[];
        let validHits: typeof hits;

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
          emit({ type: 'log', line: `[pipeline] Supabase not configured — skipping source validation (trusting all ${rawSources.length} hits)` });
          sources = rawSources;
          validHits = hits;
        } else {
          emit({ type: 'log', line: `[pipeline] Validating sources against Supabase documents table…` });
          try {
            // Fetch all documents and filter client-side.
            // PostgREST's `in.()` filter breaks on filenames with parens
            // (e.g. "file (1).md"), so we fetch all and filter in JS.
            // The documents table is small (typically <100 rows).
            const restUrl = `${supabaseUrl}/rest/v1/documents?select=filename`;
            const restResponse = await fetch(restUrl, {
              headers: {
                apikey: supabaseServiceKey,
                Authorization: `Bearer ${supabaseServiceKey}`,
              },
            });
            const allDocs = restResponse.ok ? await restResponse.json() : [];
            const validFilenames = new Set((allDocs || []).map((d: any) => d.filename));
            sources = rawSources.filter((f: string) => validFilenames.has(f));
            validHits = hits.filter((h) => validFilenames.has(h.filename));
          } catch (supabaseError: any) {
            emit({ type: 'log', line: `[pipeline] Supabase validation failed: ${supabaseError.message?.slice(0, 100)} — trusting all hits` });
            sources = rawSources;
            validHits = hits;
          }
        }

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
        // Signature: "context, question -> intelligent_answer"
        // max_tokens=32768 supports up to ~30K char outputs for complex
        // technical questions. The SYSTEM_PROMPT tells the model to be
        // adaptive — short for simple lookups, long for complex reasoning.
        emit({ type: 'stage-start', stage: 'answer' });
        emit({ type: 'log', line: `[pipeline] Generating final answer (streaming tokens live, up to 30K chars)…` });

        let answer = '';
        try {
          const answerResult = await nvidiaChatStreamControlled({
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: `Context:\n${reducedContext}\n\n---\n\nQuestion: ${query}` },
            ],
            temperature: mode === 'precise' ? 0.1 : 0.3,
            maxTokens: 32768, // supports up to ~30K char outputs
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
