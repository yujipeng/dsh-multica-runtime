import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import {
  exemptEnvNamesOn,
  exemptTaskTokenOn,
  installMulticaTerminalEnvironment,
} from '../src/environment.js'
import { forwardedEnvironmentNames } from '../src/task-env.js'

/** DSH's own credential-name matcher, cloned so a test never patches the real one. */
function scrubPattern(): RegExp {
  return /KEY|PASSWORD|SECRET|TOKEN/i
}

/** A Cordis stand-in that records effect disposers so a test can unwind them. */
function fakeContext(): { context: Context, disposers: (() => void)[], dispose: () => void } {
  const disposers: (() => void)[] = []
  const context = {
    effect(callback: () => () => void) {
      disposers.push(callback())
    },
  } as unknown as Context
  return {
    context,
    disposers,
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('forwardedEnvironmentNames', () => {
  it('forwards only a task-scoped token plus explicitly listed names', () => {
    expect(forwardedEnvironmentNames({
      MULTICA_TOKEN: 'mat_task-token',
      MULTICA_FORWARD_ENV: ' WEKNORA_API_KEY , WEKNORA_BASE_URL ',
      DEEPSEEK_API_KEY: 'provider-secret',
    })).toEqual(['MULTICA_TOKEN', 'WEKNORA_API_KEY', 'WEKNORA_BASE_URL'])
  })

  it('ignores a user PAT as the task token', () => {
    expect(forwardedEnvironmentNames({
      MULTICA_TOKEN: 'mul_user-token',
      MULTICA_FORWARD_ENV: 'WEKNORA_API_KEY',
    })).toEqual(['WEKNORA_API_KEY'])
  })

  it('returns an empty list with no forwardable names', () => {
    expect(forwardedEnvironmentNames({
      MULTICA_TOKEN: 'mul_user-token',
      DEEPSEEK_API_KEY: 'provider-secret',
    })).toEqual([])
  })

  it('trims and deduplicates the forward list', () => {
    expect(forwardedEnvironmentNames({
      MULTICA_FORWARD_ENV: ' A , , B , A ',
    })).toEqual(['A', 'B'])
  })
})

describe('exemptEnvNamesOn', () => {
  it('exempts each name on every distinct scrub instance', () => {
    const bridgeCopy = scrubPattern()
    const hostCopy = scrubPattern()

    const { patched, dispose } = exemptEnvNamesOn(
      [bridgeCopy, hostCopy],
      ['MULTICA_TOKEN', 'WEKNORA_API_KEY'],
    )

    expect(patched).toBe(2)
    expect(bridgeCopy.test('MULTICA_TOKEN')).toBe(false)
    expect(bridgeCopy.test('WEKNORA_API_KEY')).toBe(false)
    expect(hostCopy.test('MULTICA_TOKEN')).toBe(false)
    expect(hostCopy.test('WEKNORA_API_KEY')).toBe(false)

    dispose()
    expect(bridgeCopy.test('MULTICA_TOKEN')).toBe(true)
    expect(bridgeCopy.test('WEKNORA_API_KEY')).toBe(true)
  })

  it('keeps non-exempt credential-shaped names scrubbed', () => {
    const pattern = scrubPattern()

    const { dispose } = exemptEnvNamesOn([pattern], ['WEKNORA_API_KEY'])

    expect(pattern.test('WEKNORA_API_KEY')).toBe(false)
    expect(pattern.test('DEEPSEEK_API_KEY')).toBe(true)
    expect(pattern.test('AWS_SECRET_ACCESS_KEY')).toBe(true)
    expect(pattern.test('DB_PASSWORD')).toBe(true)
    expect(pattern.test('WEKNORA_BASE_URL')).toBe(false)
    dispose()
  })
})

describe('exemptTaskTokenOn', () => {
  it('exempts the task token on every distinct scrub instance', () => {
    const bridgeCopy = scrubPattern()
    const hostCopy = scrubPattern()

    const { patched, dispose } = exemptTaskTokenOn([bridgeCopy, hostCopy])

    // The MUL-6186 regression: patching one loaded copy of dsh-subprocess
    // leaves any other loaded copy — the one DSH actually spawns through —
    // still scrubbing the token.
    expect(patched).toBe(2)
    expect(bridgeCopy.test('MULTICA_TOKEN')).toBe(false)
    expect(hostCopy.test('MULTICA_TOKEN')).toBe(false)

    dispose()
    expect(bridgeCopy.test('MULTICA_TOKEN')).toBe(true)
    expect(hostCopy.test('MULTICA_TOKEN')).toBe(true)
  })

  it('patches a repeated instance once', () => {
    const pattern = scrubPattern()

    const { patched, dispose } = exemptTaskTokenOn([pattern, pattern])
    dispose()

    expect(patched).toBe(1)
    expect(pattern.test('MULTICA_TOKEN')).toBe(true)
  })

  it('keeps every other credential-shaped name scrubbed', () => {
    const pattern = scrubPattern()

    const { dispose } = exemptTaskTokenOn([pattern])

    expect(pattern.test('DEEPSEEK_API_KEY')).toBe(true)
    expect(pattern.test('MULTICA_USER_TOKEN')).toBe(true)
    expect(pattern.test('AWS_SECRET_ACCESS_KEY')).toBe(true)
    expect(pattern.test('DB_PASSWORD')).toBe(true)
    expect(pattern.test('PATH')).toBe(false)
    dispose()
  })
})

describe('installMulticaTerminalEnvironment', () => {
  it('forwards the task token through the scrub the shell tools call', async () => {
    vi.stubEnv('MULTICA_TOKEN', 'mat_task-token')
    vi.stubEnv('DEEPSEEK_API_KEY', 'provider-secret')
    const ctx = fakeContext()

    const report = await installMulticaTerminalEnvironment(ctx.context)

    expect(report?.forwarded).toBe(true)
    expect(report?.patched).toBeGreaterThanOrEqual(1)
    const env = scrubbedParentEnv()
    expect(env.MULTICA_TOKEN).toBe('mat_task-token')
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()

    ctx.dispose()
    expect(scrubbedParentEnv().MULTICA_TOKEN).toBeUndefined()
  })

  it('forwards an explicitly listed credential into the shell scrub', async () => {
    vi.stubEnv('WEKNORA_API_KEY', 'sk-weknora')
    vi.stubEnv('WEKNORA_BASE_URL', 'https://os-uat.tcredit.com/api/v1')
    vi.stubEnv('MULTICA_FORWARD_ENV', 'WEKNORA_API_KEY')
    vi.stubEnv('DEEPSEEK_API_KEY', 'provider-secret')
    const ctx = fakeContext()

    const report = await installMulticaTerminalEnvironment(ctx.context)

    expect(report).toMatchObject({ forwarded: true, names: ['WEKNORA_API_KEY'] })
    const env = scrubbedParentEnv()
    expect(env.WEKNORA_API_KEY).toBe('sk-weknora')
    expect(env.WEKNORA_BASE_URL).toBe('https://os-uat.tcredit.com/api/v1')
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()

    ctx.dispose()
    expect(scrubbedParentEnv().WEKNORA_API_KEY).toBeUndefined()
  })

  it('does not forward an unlisted credential even when another is listed', async () => {
    vi.stubEnv('WEKNORA_API_KEY', 'sk-weknora')
    vi.stubEnv('OTHER_API_KEY', 'other-secret')
    vi.stubEnv('MULTICA_FORWARD_ENV', 'WEKNORA_API_KEY')
    const ctx = fakeContext()

    await installMulticaTerminalEnvironment(ctx.context)

    const env = scrubbedParentEnv()
    expect(env.WEKNORA_API_KEY).toBe('sk-weknora')
    expect(env.OTHER_API_KEY).toBeUndefined()

    ctx.dispose()
  })

  it('installs nothing when there is no token and no forward list', async () => {
    vi.stubEnv('MULTICA_TOKEN', 'mul_user-token')
    vi.stubEnv('WEKNORA_API_KEY', 'sk-weknora')
    const ctx = fakeContext()

    await expect(installMulticaTerminalEnvironment(ctx.context)).resolves.toBeUndefined()

    expect(ctx.disposers).toHaveLength(0)
    expect(scrubbedParentEnv().WEKNORA_API_KEY).toBeUndefined()
  })

  it('installs nothing when the token is not task-scoped', async () => {
    vi.stubEnv('MULTICA_TOKEN', 'mul_user-token')
    const ctx = fakeContext()

    await expect(installMulticaTerminalEnvironment(ctx.context)).resolves.toBeUndefined()

    expect(ctx.disposers).toHaveLength(0)
    expect(scrubbedParentEnv().MULTICA_TOKEN).toBeUndefined()
  })

  it('still exempts the imported scrub when the launcher cannot be resolved', async () => {
    vi.stubEnv('MULTICA_TOKEN', 'mat_task-token')
    const ctx = fakeContext()

    const report = await installMulticaTerminalEnvironment(ctx.context, '/nonexistent/dsh')

    expect(report).toEqual({ patched: 1, forwarded: true, names: ['MULTICA_TOKEN'] })
    ctx.dispose()
  })
})
