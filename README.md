# RAG Document Assistant API

**Base URL:** `https://rag-document-assistant-three.vercel.app`

---

## 1. Ingest Document (raw text)

```bash
curl -X POST "https://rag-document-assistant-three.vercel.app/api/ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Your content here",
    "filename": "filename.txt",
    "metadata": {
      "doc_type": "token",
      "project": "gem",
      "version": "1.0"
    }
  }'
```

**PowerShell example:**
```powershell
$body = @{
    content = "Your content here"
    filename = "filename.txt"
    metadata = @{
        doc_type = "token"
        project = "gem"
        version = "1.0"
    }
} | ConvertTo-Json -Compress

Invoke-RestMethod -Uri "https://rag-document-assistant-three.vercel.app/api/ingest" -Method POST -Headers @{"Content-Type" = "application/json"} -Body $body
```

---

## 2. Upload PDF File (FormData, must be <4.5MB)

```bash
curl -X POST "https://rag-document-assistant-three.vercel.app/api/upload" \
  -F "file=@/path/to/file.pdf" \
  -F "name=file.pdf" \
  -F "mode=Add"
```

**Modes:** `Add`, `Replace`, `Delete`

**Types:** `Add` or `Replace` modes support PDF (`file=@`) or raw text (`content=`).

**Example with Windows path:**
```bash
curl -X POST "https://rag-document-assistant-three.vercel.app/api/upload" \
  -F "file=@D:\test\Values Description PDF.pdf" \
  -F "name=Values Description PDF.pdf" \
  -F "mode=Add"
```

---

## 3. Upload via JSON (base64-encoded PDF or text)

For PDF (programmatic use - requires base64 encoding):
```bash
curl -X POST "https://rag-document-assistant-three.vercel.app/api/upload" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "pdf",
    "content": "<base64-encoded-file>",
    "name": "document.pdf",
    "mode": "Add"
  }'
```

For text content:
```bash
curl -X POST "https://rag-document-assistant-three.vercel.app/api/upload" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "text",
    "content": "Your raw text content here",
    "name": "document.txt",
    "mode": "Add"
  }'
```

**PowerShell example for text upload:**
```powershell
$body = @{
    type = "text"
    content = "Your raw text content here"
    name = "document.txt"
    mode = "Add"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://rag-document-assistant-three.vercel.app/api/upload" -Method POST -Headers @{"Content-Type" = "application/json"} -Body $body
```

---

## 4. Query Document

```bash
curl -X POST "https://rag-document-assistant-three.vercel.app/api/query" \
  -H "Content-Type: application/json" \
  -d '{"query": "Your question here"}'
```

Example:
```bash
curl -X POST "https://rag-document-assistant-three.vercel.app/api/query" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the total supply of GEM tokens?"}'
```

With filters:
```bash
curl -X POST "https://rag-document-assistant-three.vercel.app/api/query" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Your question",
    "top_k": 8,
    "filters": {
      "doc_type": "token",
      "project": "gem"
    }
  }'
```

**PowerShell example:**
```powershell
$body = @{
    query = "What is the total supply of GEM tokens?"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Uri "https://rag-document-assistant-three.vercel.app/api/query" -Method POST -Headers @{"Content-Type" = "application/json"} -Body $body
```

---

## 5. List Documents

```bash
curl -X GET "https://rag-document-assistant-three.vercel.app/api/documents"
```

---

## 6. Delete Index Document (by filename)

```bash
curl -X POST "https://rag-document-assistant-three.vercel.app/api/upload" \
  -F "name=filename.pdf" \
  -F "mode=Delete"
```

Example:
```bash
curl -X POST "https://rag-document-assistant-three.vercel.app/api/upload" \
  -F "name=Values Description PDF.pdf" \
  -F "mode=Delete"
```

**Response:** `{"status":"Deleted"}`

---

## 7. Reset Index (delete ALL Pinecone records)

```bash
curl -X DELETE "https://rag-document-assistant-three.vercel.app/api/index/reset"
```

---

## Notes

- **File size limit:** 4.5MB max (Vercel serverless payload limit)
- **Supported formats:** PDF, TXT, MD (via file upload) and raw text (via ingest)
- **Aggregation queries** (all, every, list, how many, total, count): automatically uses topK=50, minScore=0.50
- **Regular queries:** topK=8, minScore=0.70
- **Chunk metadata:** `doc_type`, `project`, `version`, `uploaded_at` stored with every chunk
- **Replace mode:** Auto-deletes old chunks for same filename before inserting new ones