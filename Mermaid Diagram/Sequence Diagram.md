sequenceDiagram
    autonumber
    participant U as Browser UI
    participant V as Vercel /api/upload
    participant DB as Supabase Postgres
    participant ST as Supabase Storage
    participant PC as Pinecone e5-large
    participant L as NVIDIA gpt-oss-120b
    participant CR as Supabase Edge Cron

    %% ===== UPLOAD: PDF or TEXT =====
    rect rgb(240, 248, 255)
    Note over V: Error paths: LiteParse fail, Storage fail, Pinecone fail, DB fail -> return {status: "Error", error}<br/>On partial write: DB is commit point. If DB write fails after Storage/Pinecone succeed, cron removes orphaned Storage. Pinecone may require manual re-sync of that filename
    U->>V: POST {type: "pdf"|"text", content, name, mode}
    
    V->>V: text = liteparse(file).text
    Note over V: LiteParse PDF.js path works on Vercel.<br/>docx/txt/xlsx/images require LibreOffice — not on Vercel serverless.<br/>Route non-PDF formats to a containerised endpoint if needed.

    V->>V: sha256 = hash(text)
    
    rect rgb(255, 250, 240)
    Note over V,DB: STEP 1: DB filename check gates everything
    V->>DB: SELECT filename, sha256, storage_path FROM documents WHERE filename=name
    end

    alt mode == Delete
        alt Record exists
            V->>ST: remove(name) if storage_path exists
            V->>PC: deleteMany({filename: name})
            V->>DB: DELETE FROM documents
            V-->>U: {status: "Deleted"}
        else Record not found
            V-->>U: {status: "Not found"}
        end
    else mode == Replace
        alt Record not found
            V->>ST: upload(name) if type == "pdf" %% type now only controls Storage, not parsing
            V->>PC: upsertRecords(chunk(text))
            V->>DB: INSERT {filename: name, sha256, storage_path, updated_at}
            V-->>U: {status: "Added", chunks: N}
        else Record exists AND sha256 same
            V-->>U: {status: "Skipped", reason: "Same content"}
        else Record exists AND sha256 different
            V->>ST: upload(name) if type == "pdf" %% type now only controls Storage, not parsing
            V->>PC: deleteMany({filename: name})
            V->>PC: upsertRecords(chunk(text))
            V->>DB: UPDATE {filename: name, sha256, storage_path, updated_at}
            V-->>U: {status: "Updated", chunks: N}
        end
    else mode == Add AND No record
        V->>DB: SELECT filename FROM documents WHERE sha256=incoming_sha256 AND filename!=name
        alt Cross-filename match found
            V-->>U: {status: "Skipped", reason: "Content already exists as <existing_filename>"}
        else No match
            V->>ST: upload(name) if type == "pdf" %% type now only controls Storage, not parsing
            V->>PC: upsertRecords(chunk(text))
            V->>DB: INSERT {filename: name, sha256, storage_path}
            V-->>U: {status: "Added", chunks: N}
        end
    else mode == Add AND sha256 same
        V-->>U: {status: "Skipped", reason: "Same content"}
    else mode == Add AND sha256 different
        V->>ST: upload(name) if type == "pdf" %% type now only controls Storage, not parsing
        V->>PC: deleteMany({filename: name})
        V->>PC: upsertRecords(chunk(text))
        V->>DB: UPDATE {sha256, storage_path, updated_at}
        V-->>U: {status: "Updated", chunks: N}
    end
    end

    %% ===== QUERY: RAG =====
    rect rgb(248, 255, 240)
    Note over U,L: QUERY: RAG
    U->>V: POST /api/query {query: "leave policy"}
    V->>PC: searchRecords(inputs: {text: query}, topK: 4)
    alt Pinecone success
        PC-->>V: hits: [{fields: {text, filename}}]
        V->>L: chat.completions(context + query)
        alt LLM success
            L-->>V: answer
            V-->>U: {answer, sources}
        else LLM fail
            V-->>U: {status: "Error", error: "LLM timeout"}
        end
    else Pinecone fail
        V-->>U: {status: "Error", error: "Search failed"}
    end
    end

    %% ===== CRON CLEANUP =====
    rect rgb(255, 240, 240)
    Note over CR: Hourly cron job. JWT disabled. Runs every 1h
    CR->>DB: SELECT filename FROM documents
    CR->>ST: list all files in bucket
    loop For each bucket file
        CR->>CR: Check if filename in DB result
        alt File orphaned AND older than 1h
            CR->>ST: remove(orphaned_file)
        end
    end
    Note over CR: Prevents bucket accumulation. Stale files handled by overwrite-on-upload<br/>If Pinecone out of sync: re-upload file to trigger deleteMany + upsert
    end
