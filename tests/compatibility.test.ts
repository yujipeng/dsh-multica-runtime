import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/index.js'

const root = resolve(import.meta.dirname, '..')

const dshPackages = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-default-model',
  '@deepseek-ai/dsh-cmdline',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-mcp-client',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-user-approval',
]

describe('alpha.2 compatibility contract', () => {
  it('only gates plugin application on launcher arguments', () => {
    expect(inject).toEqual(['cmdlineArgs'])
  })

  it('pins DSH and Cordis peer/dev dependencies to the validated releases', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>
      devDependencies: Record<string, string>
    }

    for (const section of [manifest.peerDependencies, manifest.devDependencies]) {
      for (const packageName of dshPackages) expect(section[packageName]).toBe('^0.1.5-alpha.2')
      expect(section['@deepseek-ai/cordis']).toBe('^4.0.2')
      expect(section['@deepseek-ai/cordis-plugin-loader']).toBe('^1.0.3')
    }
  })

  it('disables the renamed session telemetry plugin without changing other plugin ids', async () => {
    const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('- id: session-telemetry-otel\n  disabled: true')
    expect(patch).not.toMatch(/^- id: telemetry-otel$/m)
    for (const id of ['hmr', 'session-persistence-jsonl', 'system-prompt', 'headless-runner']) {
      expect(patch).toContain(id)
    }
  })

  it('reports the alpha.2 runtime version on the probe protocol frame', async () => {
    const output: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as typeof process.stdout.write)
    const appExit = vi.fn()
    const context = {
      get(key: string) {
        if (key === 'cmdlineArgs') return { get: () => ['--probe'] }
        if (key === 'appExit') return appExit
        return undefined
      },
    } as unknown as Context

    apply(context)
    await vi.waitFor(() => expect(appExit).toHaveBeenCalledWith(0))

    expect(JSON.parse(output.join(''))).toMatchObject({
      type: 'probe',
      protocol_version: 1,
      plugin_version: '0.1.0-alpha.2',
    })
    write.mockRestore()
  })

  it('does not await the loader before returning the probe frame', async () => {
    const output: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as typeof process.stdout.write)
    const appExit = vi.fn()
    const loaderAwait = vi.fn(() => new Promise<void>(() => {}))
    const context = {
      get(key: string) {
        if (key === 'cmdlineArgs') return { get: () => ['--probe'] }
        if (key === 'loader') return { await: loaderAwait }
        if (key === 'appExit') return appExit
        return undefined
      },
    } as unknown as Context

    apply(context)
    await vi.waitFor(() => expect(appExit).toHaveBeenCalledWith(0))

    expect(loaderAwait).not.toHaveBeenCalled()
    expect(JSON.parse(output.join(''))).toMatchObject({ type: 'probe', protocol_version: 1 })
    write.mockRestore()
  })

  it('awaits the loader before listing models', async () => {
    const output: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as typeof process.stdout.write)
    const appExit = vi.fn()
    let releaseLoader: (() => void) | undefined
    const loaderAwait = vi.fn(() => new Promise<void>((resolve) => {
      releaseLoader = resolve
    }))
    const context = {
      get(key: string) {
        if (key === 'cmdlineArgs') return { get: () => ['--list-models'] }
        if (key === 'loader') return { await: loaderAwait }
        if (key === 'appExit') return appExit
        if (key === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'model' }) }
        if (key === 'llm') {
          return {
            listProviders: () => [{ id: 'test', name: 'Test' }],
            listModels: async () => [{ id: 'model', name: 'Model' }],
            resolveModelInfo: async () => ({}),
          }
        }
        return undefined
      },
    } as unknown as Context

    apply(context)
    await vi.waitFor(() => expect(loaderAwait).toHaveBeenCalledOnce())
    expect(appExit).not.toHaveBeenCalled()

    releaseLoader?.()
    await vi.waitFor(() => expect(appExit).toHaveBeenCalledWith(0))
    expect(JSON.parse(output.join(''))).toMatchObject({
      type: 'models',
      models: [{ id: 'test/model', label: 'Model', provider: 'Test', default: true }],
    })
    write.mockRestore()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
