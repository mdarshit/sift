/** Promise RPC to the tools worker. */
import type {
  AnalyzeResult,
  Language,
  JsonTreeResult,
  LineDiffResult,
  ObfuscationMapping,
  SqlDialect,
  ToolRequest,
  ToolResponse,
  ValidateResult,
} from '../types'

type Payload = ToolRequest extends infer R ? (R extends ToolRequest ? Omit<R, 'id'> : never) : never
type SuccessfulResponse<A extends ToolRequest['action']> = Extract<ToolResponse, { ok: true; action: A }>

const REQUEST_TIMEOUT_MS = 30_000

interface ToolsClientOptions {
  createWorker?: () => Worker
  requestTimeoutMs?: number
}

interface PendingRequest {
  action: ToolRequest['action']
  request: ToolRequest
  resolve: (v: ToolResponse) => void
  reject: (e: Error) => void
}

export class ToolsClient {
  private worker: Worker
  private seq = 1
  private pending = new Map<number, PendingRequest>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private timedRequestId: number | undefined
  private readonly workerFactory: () => Worker
  private readonly requestTimeoutMs: number

  constructor(options: ToolsClientOptions = {}) {
    this.workerFactory = options.createWorker ?? (() => new Worker(new URL('../worker/tools.worker.ts', import.meta.url), { type: 'module' }))
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
    this.worker = this.createWorker()
  }

  private createWorker(): Worker {
    const worker = this.workerFactory()
    worker.onmessage = (e: MessageEvent<ToolResponse>) => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      this.pending.delete(e.data.id)
      const wasTimedRequest = e.data.id === this.timedRequestId
      if (wasTimedRequest) this.clearTimer()
      if (e.data.ok && e.data.action !== p.action) {
        p.reject(new Error(`tools worker returned ${e.data.action} for ${p.action} request`))
      } else {
        p.resolve(e.data)
      }
      if (wasTimedRequest) this.startTimer()
    }
    worker.onerror = (e) => this.recover(worker, new Error(e.message || 'tools worker crashed'))
    worker.onmessageerror = () => this.recover(worker, new Error('tools worker sent an unreadable response'))
    return worker
  }

  private clearTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.timedRequestId = undefined
  }

  private startTimer() {
    this.clearTimer()
    const id = this.pending.keys().next().value
    if (id === undefined) return
    this.timedRequestId = id
    const worker = this.worker
    this.timer = setTimeout(() => {
      if (!this.pending.has(id)) return
      this.recoverTimeout(worker, id)
    }, this.requestTimeoutMs)
  }

  private recoverTimeout(worker: Worker, timedOutId: number) {
    if (worker !== this.worker) return
    worker.terminate()
    this.clearTimer()
    const timedOut = this.pending.get(timedOutId)
    this.pending.delete(timedOutId)
    timedOut?.reject(new Error('tools worker request timed out'))
    this.worker = this.createWorker()
    try {
      for (const pending of this.pending.values()) this.worker.postMessage(pending.request)
      this.startTimer()
    } catch (err) {
      this.recover(this.worker, err instanceof Error ? err : new Error(String(err)))
    }
  }

  private recover(worker: Worker, err: Error) {
    if (worker !== this.worker) return
    worker.terminate()
    this.clearTimer()
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    this.worker = this.createWorker()
  }

  private async request<A extends Payload['action']>(req: Extract<Payload, { action: A }>): Promise<SuccessfulResponse<A>> {
    const id = this.seq++
    const response = await new Promise<ToolResponse>((resolve, reject) => {
      const worker = this.worker
      const request = { ...req, id } as ToolRequest
      this.pending.set(id, { action: req.action, request, resolve, reject })
      if (this.pending.size === 1) this.startTimer()
      try {
        worker.postMessage(request)
      } catch (err) {
        this.recover(worker, err instanceof Error ? err : new Error(String(err)))
      }
    })
    if (!response.ok) throw new Error(response.error)
    return response as SuccessfulResponse<A>
  }

  async validate(lang: Language, dialect: SqlDialect, text: string): Promise<ValidateResult> {
    const r = await this.request({ action: 'validate', lang, dialect, text })
    return r.validate
  }

  async format(lang: Language, dialect: SqlDialect, text: string): Promise<string> {
    const r = await this.request({ action: 'format', lang, dialect, text })
    return r.result
  }

  async minify(lang: Language, text: string): Promise<string> {
    const r = await this.request({ action: 'minify', lang, text })
    return r.result
  }

  async analyze(text: string): Promise<AnalyzeResult> {
    const r = await this.request({ action: 'analyze', text })
    return r.analyze
  }

  async diffLines(left: string, right: string): Promise<LineDiffResult> {
    const r = await this.request({ action: 'lineDiff', left, right })
    return r.diff
  }

  async parseJsonTree(text: string): Promise<JsonTreeResult> {
    const r = await this.request({ action: 'jsonTree', text })
    return r.json
  }

  async obfuscate(
    text: string,
  ): Promise<{ result: string; identifiers: number; strings: number; mapping: ObfuscationMapping }> {
    const r = await this.request({ action: 'obfuscate', text })
    return {
      result: r.result,
      identifiers: r.counts.identifiers,
      strings: r.counts.strings,
      mapping: r.mapping,
    }
  }
}

export const tools = new ToolsClient()
