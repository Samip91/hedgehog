import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as HttpModule from '@/server/http'

vi.mock('@/config/env', () => ({
  env: {
    NVIDIA_BASE_URL: 'https://nim.example.com',
    NVIDIA_API_KEY: 'test-nim-key',
    EMBEDDING_MODEL: 'test-embed-model',
    EMBEDDING_DIM: 4,
  },
}))

const mocks = vi.hoisted(() => ({ fetchJson: vi.fn() }))

vi.mock('@/server/http', async importOriginal => {
  const actual = await importOriginal<typeof HttpModule>()
  return { ...actual, fetchJson: mocks.fetchJson }
})

import {
  BATCH_SIZE,
  EmbeddingCountError,
  EmbeddingDimError,
  embedBatch,
  embedText,
} from './embed'

interface PostOpts {
  readonly body: { input: string[] }
}

interface QueryPostOpts {
  readonly body: { input: string[]; input_type: string }
}

describe('embedBatch', () => {
  beforeEach(() => {
    mocks.fetchJson.mockReset()
  })

  // AC 11: bounded batches, not one call for 500+ markets at once.
  it('chunks >BATCH_SIZE inputs into ≥2 fetchJson calls, preserving output order', async () => {
    const texts = Array.from(
      { length: BATCH_SIZE + 5 },
      (_, i) => `market question ${i}`
    )

    mocks.fetchJson.mockImplementation(
      async (_url: string, opts: PostOpts) => ({
        data: opts.body.input.map((text, i) => ({
          index: i,
          embedding: [texts.indexOf(text), 0, 0, 0],
        })),
      })
    )

    const vectors = await embedBatch(texts)

    expect(mocks.fetchJson).toHaveBeenCalledTimes(2) // 64 + 5 → two batches
    expect(vectors).toHaveLength(texts.length)
    vectors.forEach((v, i) => expect(v).toEqual([i, 0, 0, 0]))
  })

  it('makes zero fetchJson calls for an empty input (sync calls embedBatch([]) unconditionally)', async () => {
    const vectors = await embedBatch([])
    expect(vectors).toEqual([])
    expect(mocks.fetchJson).not.toHaveBeenCalled()
  })

  // Dim invariant: a vector whose length != EMBEDDING_DIM must throw, not
  // silently corrupt the HNSW index (spec "Key risks & mitigations" #2).
  it('throws EmbeddingDimError when a returned vector length !== EMBEDDING_DIM', async () => {
    mocks.fetchJson.mockResolvedValueOnce({
      data: [{ index: 0, embedding: [1, 2, 3] }], // length 3, EMBEDDING_DIM is 4
    })

    await expect(embedBatch(['only one text'])).rejects.toBeInstanceOf(
      EmbeddingDimError
    )
  })

  // Reviewer finding: a dropped NIM entry must not silently shift every
  // later vector off-by-one against its input text.
  it('throws EmbeddingCountError when a batch returns fewer entries than sent', async () => {
    mocks.fetchJson.mockResolvedValueOnce({
      data: [{ index: 0, embedding: [1, 2, 3, 4] }], // 2 texts sent, 1 returned
    })

    await expect(embedBatch(['first', 'second'])).rejects.toBeInstanceOf(
      EmbeddingCountError
    )
  })

  it('sorts by the response `index` field rather than trusting array order', async () => {
    mocks.fetchJson.mockResolvedValueOnce({
      data: [
        { index: 1, embedding: [9, 9, 9, 9] },
        { index: 0, embedding: [1, 1, 1, 1] },
      ],
    })

    const vectors = await embedBatch(['first', 'second'])
    expect(vectors).toEqual([
      [1, 1, 1, 1],
      [9, 9, 9, 9],
    ])
  })
})

describe('embedText', () => {
  beforeEach(() => {
    mocks.fetchJson.mockReset()
  })

  // AC 1: query embedding uses input_type: 'query' (not 'passage'), and
  // wraps the single text in a length-1 `input` array.
  it("POSTs input_type: 'query' and input: [text], reusing the NIM plumbing", async () => {
    let capturedBody: QueryPostOpts['body'] | undefined
    mocks.fetchJson.mockImplementation(
      async (_url: string, opts: QueryPostOpts) => {
        capturedBody = opts.body
        return { data: [{ index: 0, embedding: [1, 2, 3, 4] }] }
      }
    )

    const vector = await embedText('will it rain in miami on march 21?')

    expect(capturedBody).toMatchObject({
      input: ['will it rain in miami on march 21?'],
      input_type: 'query',
    })
    expect(vector).toEqual([1, 2, 3, 4])
  })

  // AC 2: mirrors embedOneBatch's per-vector dim check.
  it('rejects with EmbeddingDimError when the returned vector length !== EMBEDDING_DIM', async () => {
    mocks.fetchJson.mockResolvedValueOnce({
      data: [{ index: 0, embedding: [1, 2, 3] }], // length 3, EMBEDDING_DIM is 4
    })

    await expect(embedText('short vector')).rejects.toBeInstanceOf(
      EmbeddingDimError
    )
  })

  // AC 3: embedText never silently resolves a zero/partial vector — any
  // HTTP/schema failure propagates; only retrieveCandidates's degraded-mode
  // catch (AC 15–16) is allowed to swallow it.
  it('propagates rejection when fetchJson rejects — never resolves', async () => {
    mocks.fetchJson.mockRejectedValueOnce(new Error('network down'))

    await expect(embedText('any text')).rejects.toThrow('network down')
  })
})
