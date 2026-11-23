import type { BfBridge } from './index'

declare global {
  interface Window {
    bf: BfBridge
  }
}
