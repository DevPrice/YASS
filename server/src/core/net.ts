/**
 * Which addresses this machine can be reached at.
 *
 * Lives in `core/` rather than in the entry point because two processes need
 * the same answer: the server prints it at startup, and the tray shows it as
 * the URL to hand a guest. One definition means the two can't disagree about
 * what to tell somebody to type.
 */

import { networkInterfaces } from 'node:os'

import type { LanAddress } from '@shared/types.js'

/**
 * Adapters that exist but go nowhere a guest's phone can follow.
 *
 * Matched on the name the OS gives the interface, because the addresses
 * themselves are no help: VirtualBox hands out 192.168.56.x and WSL hands out
 * 172.x, both of which are ordinary private ranges. This list is a heuristic
 * and is allowed to be wrong — being wrong demotes an address to the bottom of
 * the list, it never hides it.
 */
const VIRTUAL =
  /virtualbox|vmware|hyper-?v|vethernet|\bwsl\b|docker|bluetooth|tailscale|zerotier|tap-windows|openvpn|wireguard|\butun\b|loopback/i

/**
 * IPv4 LAN addresses for `port`, the reachable ones first.
 *
 * Internal (loopback) interfaces are skipped: `http://127.0.0.1:4321` is not an
 * address to hand to a phone. IPv6 is skipped too — the addresses are unwieldy
 * to read off a screen and every device on a party LAN has IPv4.
 */
export function lanAddresses(port: number): LanAddress[] {
  const found: LanAddress[] = []

  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue
      found.push({ url: `http://${address.address}:${port}`, name, virtual: VIRTUAL.test(name) })
    }
  }

  // Stable within each group, so the order the OS reports its real adapters in
  // is preserved rather than replaced with an arbitrary one.
  return [...found.filter((entry) => !entry.virtual), ...found.filter((entry) => entry.virtual)]
}
