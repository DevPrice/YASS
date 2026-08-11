/**
 * Which addresses this machine can be reached at.
 *
 * Lives in `core/` rather than in the entry point because two processes need
 * the same answer: the server prints it at startup, and the tray shows it as
 * the URL to hand a guest. One definition means the two can't disagree about
 * what to tell somebody to type.
 */

import { networkInterfaces } from 'node:os'

/**
 * IPv4 LAN URLs for `port`, in interface order.
 *
 * Internal (loopback) interfaces are skipped: `http://127.0.0.1:4321` is not an
 * address to hand to a phone. IPv6 is skipped too — the addresses are unwieldy
 * to read off a screen and every device on a party LAN has IPv4.
 */
export function lanAddresses(port: number): string[] {
  const urls: string[] = []

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue
      urls.push(`http://${address.address}:${port}`)
    }
  }

  return urls
}
