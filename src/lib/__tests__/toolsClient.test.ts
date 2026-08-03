import type { ToolRequest, ToolResponse } from '../../types'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

class MockWorker {
  onmessage: ((event: MessageEvent<ToolResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  requests: ToolRequest[] = []
  terminated = false
  postError: Error | undefined

  postMessage(message: ToolRequest) {
    if (this.postError) throw this.postError
    this.requests.push(message)
  }

  terminate() {
    this.terminated = true
  }

  respond(response: ToolResponse) {
    this.onmessage?.({ data: response } as MessageEvent<ToolResponse>)
  }

  crash(message: string) {
    this.onerror?.({ message } as ErrorEvent)
  }

  messageError() {
    this.onmessageerror?.({} as MessageEvent)
  }
}

let ToolsClient: typeof import('../toolsClient').ToolsClient

beforeAll(async () => {
  vi.stubGlobal('Worker', MockWorker)
  ;({ ToolsClient } = await import('../toolsClient'))
})

afterEach(() => {
  vi.useRealTimers()
})

function setup(timeout = 100) {
  const workers: MockWorker[] = []
  const client = new ToolsClient({
    createWorker: () => {
      const worker = new MockWorker()
      workers.push(worker)
      return worker as unknown as Worker
    },
    requestTimeoutMs: timeout,
  })
  return { client, workers }
}

describe('ToolsClient', () => {
  it('returns a typed response', async () => {
    const { client, workers } = setup()
    const result = client.validate('json', 'sql', '{}')
    const request = workers[0].requests[0]

    workers[0].respond({
      id: request.id,
      action: 'validate',
      ok: true,
      validate: { issue: null, depth: 'full' },
    })

    await expect(result).resolves.toEqual({ issue: null, depth: 'full' })
  })

  it('rejects a response with the wrong action', async () => {
    const { client, workers } = setup()
    const result = client.format('json', 'sql', '{}')
    const request = workers[0].requests[0]

    workers[0].respond({ id: request.id, action: 'minify', ok: true, result: '{}' })

    await expect(result).rejects.toThrow('tools worker returned minify for format request')
  })

  it('times out only the active request and replays queued work on the replacement worker', async () => {
    vi.useFakeTimers()
    const { client, workers } = setup()
    const first = client.format('json', 'sql', '{}')
    const queued = client.minify('json', '{}')
    const firstRejection = expect(first).rejects.toThrow('tools worker request timed out')
    await vi.advanceTimersByTimeAsync(100)

    await firstRejection
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
    const replayed = workers[1].requests[0]
    workers[1].respond({ id: replayed.id, action: 'minify', ok: true, result: '{}' })
    await expect(queued).resolves.toBe('{}')
  })

  it('rejects all requests on a fatal crash and recovers with a new worker', async () => {
    const { client, workers } = setup()
    const first = client.format('json', 'sql', '{}')
    const second = client.minify('json', '{}')

    workers[0].crash('boom')

    await expect(first).rejects.toThrow('boom')
    await expect(second).rejects.toThrow('boom')
    expect(workers[0].terminated).toBe(true)

    const recovered = client.minify('json', '{ }')
    const request = workers[1].requests[0]
    workers[1].respond({ id: request.id, action: 'minify', ok: true, result: '{}' })
    await expect(recovered).resolves.toBe('{}')
  })

  it('recovers from an unreadable worker message', async () => {
    const { client, workers } = setup()
    const pending = client.minify('json', '{}')
    workers[0].messageError()

    await expect(pending).rejects.toThrow('tools worker sent an unreadable response')
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
  })

  it('recovers when posting to the worker throws', async () => {
    const { client, workers } = setup()
    workers[0].postError = new Error('post failed')

    await expect(client.minify('json', '{}')).rejects.toThrow('post failed')
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
  })
})
