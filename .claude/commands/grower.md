---
description: One grower's whole season before the phone call - blocks and GAP state, deliveries, packouts, what is still in store, and their returns at today's numbers.
---

1. Run `npm run packhouse -- grower <name or code>` before ringing them back. Partial names work; an ambiguous one lists candidates.
2. The card carries what the call is usually about:
   - **Blocks and GAP:** an expired or expiring certificate is the conversation nobody enjoys; have the date in front of you.
   - **Packouts:** the number growers ring about. Compare this run against their last few before explaining it.
   - **Returns:** their pro-rata share of each pool at today's numbers, charges shown. Say clearly that an open pool moves until it closes.
3. Their fruit still in store: `pallets --grower=`.
4. Log the call the moment it ends: `log <grower> "what was said and decided"`.
5. New grower or block: `add grower "<name>" --code=`, then `add orchard "<block>" --grower= --crop= --variety= --block= --gap-scheme= --gap-expires=`. A block without a GAP expiry on record cannot supply export consignments, and the CLI will say so.
