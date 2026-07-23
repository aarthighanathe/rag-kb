# RAG Knowledge Base

## Overview

This knowledge base uses **Retrieval-Augmented Generation** to answer questions from uploaded documents.

## Supported Formats

The system accepts the following file types:
- PDF documents
- DOCX Word files
- Plain text (`.txt`)
- Markdown (`.md`)

## How Queries Work

1. Your question is embedded into a 384-dimensional vector.
2. The vector database performs a cosine similarity search.
3. The top-K matching chunks are retrieved.
4. The LLM generates an answer grounded in those chunks.

## Citation Format

Answers include inline citations formatted as `[Doc: filename, Chunk: N]`.

## Code Example

```python
# This is stripped in plain-text extraction
result = rag_query("What is the capital of France?")
```

> Blockquotes like this are also removed during extraction.

For more details see the [project README](../README.md).
