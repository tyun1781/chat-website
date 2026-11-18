import type { Directive } from 'vue'

type RevealValue = number | { delay?: number } | null | undefined
interface Control { replay: () => void; cleanup: () => void }

const controls = new WeakMap<HTMLElement, Control>()
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

function revealNow(element: HTMLElement) {
  element.classList.remove('is-motion-pending')
  element.classList.add('is-visible')
  element.dataset.motionState = 'visible'
}

function attach(element: HTMLElement) {
  controls.get(element)?.cleanup()
  element.classList.add('reveal')
  element.classList.remove('is-visible')
  element.classList.add('is-motion-pending')
  element.dataset.motionState = 'waiting'

  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    revealNow(element)
    return
  }

  let frame = 0
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting && entry.boundingClientRect.bottom > 0) continue
      observer.unobserve(entry.target)
      frame = requestAnimationFrame(() => requestAnimationFrame(() => {
        if (entry.target.isConnected) revealNow(entry.target as HTMLElement)
      }))
    }
  }, { threshold: 0.01, rootMargin: '0px 0px -14% 0px' })

  const control: Control = {
    cleanup() {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      controls.delete(element)
    },
    replay() { attach(element) }
  }
  controls.set(element, control)

  const rect = element.getBoundingClientRect()
  const inRange = rect.bottom > 0 && rect.top < window.innerHeight * 0.86
  if (inRange || rect.bottom <= 0) {
    observer.disconnect()
    frame = requestAnimationFrame(() => requestAnimationFrame(() => revealNow(element)))
  } else {
    observer.observe(element)
  }
}

function delayOf(value: RevealValue) {
  if (typeof value === 'number') return value
  return value && typeof value === 'object' ? value.delay : undefined
}

export const reveal: Directive<HTMLElement, RevealValue> = {
  created(element, binding) {
    const delay = delayOf(binding.value)
    if (delay) element.style.setProperty('--reveal-delay', `${delay}ms`)
    element.classList.add('reveal', 'is-motion-pending')
  },
  mounted(element) { attach(element) },
  unmounted(element) { controls.get(element)?.cleanup() }
}

/** Replay every reveal element inside a page root. Hidden roots are ignored. */
export function replayReveals(root: HTMLElement | null | undefined) {
  if (!root || root.offsetParent === null) return
  root.querySelectorAll<HTMLElement>('.reveal').forEach(element => controls.get(element)?.replay())
}
