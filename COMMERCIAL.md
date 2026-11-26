# Commercial license

anynear Web is licensed under the GNU General Public License, version 3 or later (GPL-3.0-or-later, see
[LICENSE](LICENSE)). You may use it under the GPL at no cost, including commercially, as long as you meet its terms:
software that contains this code and is passed on must itself be available under the GPL, with its source code.

If that does not fit your use, for example because you want to build this code into software that you do not publish
under the GPL, a commercial license is available. It is granted by Kevin Schu, who runs the anynear project and holds
the rights to the code (contributions are covered by the [Contributor License Agreement](CLA.md)).

Contact: [business@anynear.app](mailto:business@anynear.app)

**Not covered: the Meshtastic layer.** The Meshtastic® protobuf definitions are licensed under GPL-3.0 by Meshtastic
LLC. Code that implements this schema or is generated from it stays under the GPL only, and a commercial license from
us cannot extend to it. In this repository that is the radio setup (`src/core/radioSetup.ts`,
`src/ui/RadioSetup.tsx`) and the radio code of ANMP built into the web app, which uses the Meshtastic protobufs
library. For closed-source use of that part, ask Meshtastic LLC, which plans to offer its own commercial license.

A commercial license covers the code of this repository only. It grants no rights to the name “anynear” or its logos
and no access to the anynear network or other anynear services; these need a separate agreement.
