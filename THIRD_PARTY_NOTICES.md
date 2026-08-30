# Third-party notices

## stack-chan simulator

The simulator source and shell model are derived from
[`stack-chan/stack-chan`](https://github.com/stack-chan/stack-chan) at commit
`c6171cff5e79bb8ac8cf0ca4675a41a877481292`, distributed under the Apache
License 2.0. The license text and exact vendor record are in
`vendor/stack-chan-simulator`.

## Moddable SDK runtime

The `mc.js` and `mc.wasm` files are generated runtime artifacts used by the
stack-chan browser simulator. Their source is the
[`Moddable SDK`](https://github.com/Moddable-OpenSource/moddable/tree/b1f42a2e148f0fc2cd91d7ed1cee56bd361656b2)
at commit `b1f42a2e148f0fc2cd91d7ed1cee56bd361656b2`. The Moddable SDK Runtime is
distributed under the GNU Lesser General Public License, version 3 or later;
some incorporated files retain additional notices. A copy of the LGPL 3.0 is
stored at `vendor/moddable-sdk/LICENSE.LGPL-3.0.txt`. The exact build inputs and
rebuild command are recorded in `vendor/stack-chan-simulator/UPSTREAM.md`.
