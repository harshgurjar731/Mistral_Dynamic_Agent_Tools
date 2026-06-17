# Implement Document Library Tool Support

Add Mistral's built-in `document_library` tool to the project, enabling agents to perform native RAG (Retrieval-Augmented Generation) over user-uploaded document libraries — with no custom vector DB or parsing pipeline needed.

## Background

Mistral's `document_library` tool (`{"type": "document_library", "library_ids": [...]}`) is a server-side built-in that lets agents autonomously search through documents uploaded to Mistral Libraries. The project already supports 3 other built-in tools (`web_search`, `code_interpreter`, `image_generation`) but completely lacks `document_library`.

Per the [OpenAPI spec](file:///c:/Users/MrHarshGurjar/Desktop/code/Mistral_Dynamic_Agent_Tools/openapi.yaml#L7554-L7577), the `DocumentLibraryTool` schema is:

```yaml
DocumentLibraryTool:
  type: object
  properties:
    tool_configuration: ...
    type:
      enum: [document_library]
      default: document_library
    library_ids:
      type: array
      items: { type: string }
      minItems: 1
      description: Ids of the library in which to search.
  required: [library_ids]
```

Unlike the other built-ins which are just `{"type": "..."}`, `document_library` **requires a `library_ids` array** — the IDs of Mistral Libraries the agent should search. This means the implementation needs:

1. A way to **manage Libraries** (create, list, upload documents, delete) via the Mistral SDK's `client.beta.libraries` API
2. A way to **select libraries** when equipping the tool on an agent
3. Backend routing that correctly passes `library_ids` to the Mistral API

## User Review Required

> [!IMPORTANT]
> The Document Library tool requires a **Mistral account with Libraries access** (`client.beta.libraries`). This is available on the standard Mistral API but requires uploaded documents to be useful. I'll build a full Library Management UI so you can create libraries and upload documents directly from the frontend.

> [!WARNING]  
> The `document_library` tool is fundamentally different from the other built-ins because it requires `library_ids`. The current `tool_registry.py` pattern of `{"type": "tool_name"}` won't work — we need to pass library IDs dynamically. This means changes to how tools are resolved during agent creation/update.

## Open Questions

> [!IMPORTANT]
> **File upload approach**: Should document uploads go through the Mistral Files API first (`client.files.upload(purpose="libraries")`) and then be added to a library? Or should we use a simpler approach of just managing libraries from the Mistral Studio UI and only selecting library IDs from our platform? **I recommend the full approach** — creating a Library Management page where users can create libraries, upload documents, and then reference them when equipping agents.

---

## Proposed Changes

### Component 1: Backend — Library Management Service

New service to interact with the Mistral Libraries API (`client.beta.libraries`).

#### [NEW] [library_service.py](file:///c:/Users/MrHarshGurjar/Desktop/code/Mistral_Dynamic_Agent_Tools/backend/app/services/library_service.py)

- `list_libraries(client)` → calls `client.beta.libraries.list()`, returns all user libraries with id, name, description, doc count
- `create_library(client, name, description)` → calls `client.beta.libraries.create()`
- `delete_library(client, library_id)` → calls `client.beta.libraries.delete()`
- `list_documents(client, library_id)` → calls `client.beta.libraries.documents.list()`
- `upload_document(client, library_id, file)` → uploads file via `client.files.upload(purpose="libraries")` then adds to library
- `delete_document(client, library_id, document_id)` → removes a document from a library

---

### Component 2: Backend — Library API Routes

#### [NEW] [libraries.py](file:///c:/Users/MrHarshGurjar/Desktop/code/Mistral_Dynamic_Agent_Tools/backend/app/routes/libraries.py)

REST endpoints:
- `GET /api/libraries` — list all libraries
- `POST /api/libraries` — create a library (body: `{name, description}`)
- `DELETE /api/libraries/{id}` — delete a library
- `GET /api/libraries/{id}/documents` — list documents in a library
- `POST /api/libraries/{id}/documents` — upload a document (multipart form)
- `DELETE /api/libraries/{id}/documents/{doc_id}` — remove a document

#### [MODIFY] [main.py](file:///c:/Users/MrHarshGurjar/Desktop/code/Mistral_Dynamic_Agent_Tools/backend/app/main.py)

- Register the new `libraries` router under `/api`

---

### Component 3: Backend — Tool Registry & Agent Service Updates

#### [MODIFY] [tool_registry.py](file:///c:/Users/MrHarshGurjar/Desktop/code/Mistral_Dynamic_Agent_Tools/backend/app/services/tool_registry.py)

- Add `"document_library"` to `BUILTIN_TOOLS` dict (as a template: `{"type": "document_library"}`)
- Modify `get_tools()` to handle `document_library` specially — when a tool key starts with `document_library:`, extract the library IDs and build `{"type": "document_library", "library_ids": [...]}` 
- The frontend will pass tool keys like `"document_library:lib-id-1,lib-id-2"` to encode the selected library IDs

#### [MODIFY] [agent_service.py](file:///c:/Users/MrHarshGurjar/Desktop/code/Mistral_Dynamic_Agent_Tools/backend/app/services/agent_service.py)

- In `create_agent()`: Handle `document_library` tool configuration — accept `document_library_ids` from the request and build the proper tool spec with `library_ids`
- In `update_agent()`: Same — support updating `document_library` tool with new library IDs via SDK's `client.beta.agents.update(tools=[...])`

#### [MODIFY] [agents.py](file:///c:/Users/MrHarshGurjar/Desktop/code/Mistral_Dynamic_Agent_Tools/backend/app/routes/agents.py)

- Add `document_library_ids: Optional[List[str]]` to both `CreateAgentRequest` and `UpdateAgentRequest` schemas
- Pass these through to the service layer

---

### Component 4: Backend — Tools Route Update

#### [MODIFY] [tools.py](file:///c:/Users/MrHarshGurjar/Desktop/code/Mistral_Dynamic_Agent_Tools/backend/app/routes/tools.py)

- In `list_all_tools()`: Include `document_library` in the built-in tools listing (it's already in `BUILTIN_TOOLS` after the registry change)

---

### Component 5: Frontend — Library Management API

#### [NEW] [libraries.ts](file:///c:/Users/MrHarshGurjar/Desktop/code/Mistral_Dynamic_Agent_Tools/frontend/src/api/libraries.ts)

```typescript
export const librariesApi = {
  list:            ()                           => api.get('/api/libraries'),
  create:          (body: {name, description})  => api.post('/api/libraries', body),
  delete:          (id: string)                 => api.delete(`/api/libraries/${id}`),
  listDocuments:   (id: string)                 => api.get(`/api/libraries/${id}/documents`),
  uploadDocument:  (id: string, file: File)     => multipart POST,
  deleteDocument:  (id: string, docId: string)  => api.delete(`/api/libraries/${id}/documents/${docId}`),
};
```

---

### Component 6: Frontend — Library Management Page

#### [NEW] [LibraryManager.tsx](file:///c:/Users/MrHarshGurjar/Desktop/code/Mistral_Dynamic_Agent_Tools/frontend/src/features/libraries/LibraryManager.tsx)

A full-page UI (matching the existing Agent Studio aesthetic) with:
- **Library grid** — cards showing library name, description, document count, created date
- **Create library** — modal/panel with name + description fields
- **Delete library** — confirmation dialog
- **Library detail view** — clicking a library card shows its documents
- **Document upload** — drag-and-drop or file picker for PDFs, TXT, MD, DOCX (Mistral supports up to 512MB)
- **Document list** — table/cards showing filename, size, upload date, with delete action

---

### Component 7: Frontend — Document Library Tool Selector in Agent Detail

#### [MODIFY] [AgentDetail.tsx](file:///c:/Users/MrHarshGurjar/Desktop/code/Mistral_Dynamic_Agent_Tools/frontend/src/features/agents/AgentDetail.tsx)

In the Settings panel "Tools Equipped" section (line ~551-567), add a section for the Document Library tool:
- A toggle switch to enable/disable the `document_library` tool
- When enabled, show a multi-select dropdown of available Mistral Libraries (fetched via `GET /api/libraries`)
- Display selected libraries as chips/badges
- Save button updates the agent's tools via `PATCH /api/agents/{id}` with the `document_library_ids`

#### [MODIFY] [AgentStudio.tsx](file:///c:/Users/MrHarshGurjar/Desktop/code/Mistral_Dynamic_Agent_Tools/frontend/src/features/agents/AgentStudio.tsx)

- Add a tools selection step in the create agent form, including a `document_library` option with library multi-select

---

### Component 8: Frontend — Routing & Navigation

#### [MODIFY] [App.tsx](file:///c:/Users/MrHarshGurjar/Desktop/code/Mistral_Dynamic_Agent_Tools/frontend/src/App.tsx)

- Add route: `/libraries` → `<LibraryManager />`
- Add navigation entry in the sidebar (if one exists) for "Libraries"

---

## Verification Plan

### Automated Tests
```bash
# Backend — test library endpoints
curl http://localhost:8000/api/libraries
curl -X POST http://localhost:8000/api/libraries -d '{"name":"Test Library","description":"Test"}'

# Test agent creation with document_library tool
curl -X POST http://localhost:8000/api/agents -d '{
  "name": "RAG Agent",
  "model": "mistral-large-latest",
  "tools": ["web_search"],
  "document_library_ids": ["<library_id>"]
}'
```

### Manual Verification
1. Create a library from the Libraries page
2. Upload a PDF document to the library  
3. Create a new agent and equip the `document_library` tool with the library selected
4. Chat with the agent and ask questions about the document content
5. Verify the agent can search and cite from the uploaded documents
