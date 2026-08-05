import { describe, expect, it, vi } from 'vitest'
import { registerOffline, supportsOffline } from './offline.ts'

// The registration, which is thin on purpose — everything with a decision in it is in
// `build/service-worker.ts`. What is left is four ways to not register, and each of them is a
// normal way to run this app rather than an error case.

const immediately = (run: () => void) => run()

function navigatorWith(register = vi.fn().mockResolvedValue({})) {
  return { navigator: { serviceWorker: { register } }, register }
}

describe('supportsOffline', () => {
  it('says no to a browser without service workers, and to no browser at all', () => {
    // The second is Node, which is where every test in this project's fast loop runs.
    expect(supportsOffline({})).toBe(false)
    expect(supportsOffline(undefined)).toBe(false)
  })

  it('says yes when there is one', () => {
    expect(supportsOffline({ serviceWorker: {} })).toBe(true)
  })
})

describe('registerOffline', () => {
  it('registers a relative path with a relative scope', () => {
    // Both are load-bearing. The path decides which directory the worker controls, and one build
    // is served from /driftbox/ and from the root — an absolute either would be right in one
    // deployment and wrong in the other.
    const { navigator, register } = navigatorWith()
    registerOffline({ enabled: true, navigator, afterLoad: immediately })
    expect(register).toHaveBeenCalledWith('./sw.js', { scope: './' })
  })

  it('waits for load rather than competing with the page it is caching', () => {
    // The install fetches the entire precache. Started during load, it contends with the requests
    // that decide first paint, and nobody has ever wanted the offline copy sooner at that price.
    const { navigator, register } = navigatorWith()
    let deferred: (() => void) | null = null
    registerOffline({ enabled: true, navigator, afterLoad: (run) => (deferred = run) })

    expect(register).not.toHaveBeenCalled()
    deferred!()
    expect(register).toHaveBeenCalledOnce()
  })

  it('does nothing in dev', () => {
    // A worker serving a precached build over the one being edited does not break the page — it
    // ignores the edit, which is far more expensive to work out.
    const { navigator, register } = navigatorWith()
    registerOffline({ enabled: false, navigator, afterLoad: immediately })
    expect(register).not.toHaveBeenCalled()
  })

  it('does nothing where there is no service worker to register', () => {
    expect(() =>
      registerOffline({ enabled: true, navigator: {}, afterLoad: immediately }),
    ).not.toThrow()
  })

  it('swallows a refusal', () => {
    // A private window, a host without HTTPS, a browser with them switched off. All normal, none
    // worth an error in a console that should be reporting audio problems — and the cost of each
    // is only the offline copy.
    const register = vi.fn().mockRejectedValue(new Error('nope'))
    expect(() =>
      registerOffline({
        enabled: true,
        navigator: { serviceWorker: { register } },
        afterLoad: immediately,
      }),
    ).not.toThrow()
  })
})
