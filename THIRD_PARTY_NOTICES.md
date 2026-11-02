# UI icons

The four sidebar action icons are from [Lucide](https://lucide.dev), version 0.468.0 (square-pen, search, book-open, settings), with their stroke color set to match the UI. The upstream ISC license notice is retained in [ui/assets/LUCIDE-LICENSE.txt](ui/assets/LUCIDE-LICENSE.txt). The SVGs are bundled locally; no icon runtime or external requests are required.

# Dot-matrix loading indicator

The app's 5×5 Origin Wave indicator is adapted from `DotmSquare12` (`@dotmatrix/dotm-square-12`), dot-matrix v1.5.0 by [zzzzshawn/matrix](https://github.com/zzzzshawn/matrix), as published at [Dot Matrix](https://dotmatrix.zzzzshawn.cloud/). `ui/loading.js` and the `dot-origin-wave` CSS preserve its origin, Manhattan ring delays, opacity curve and reduced-motion appearance in plain JavaScript/CSS. This adaptation is bundled for use inside dd2l, not offered as a standalone component or library. No React, Tailwind, registry CLI or external runtime is bundled.

The upstream license is retained below:

Custom Proprietary License

Copyright (c) 2026 dot-matrix contributors
All rights reserved.

Permission is granted to use this software, including in commercial and non-commercial products.

The following are strictly prohibited without prior written permission from the copyright holder:
1. Publishing, distributing, or presenting any component from this project as a standalone reusable component, or claiming it as part of another component library or similar reusable component collection.
2. Selling, sublicensing, renting, leasing, or otherwise commercializing any component from this project, whether modified or unmodified, as a standalone component offering.

Any use not expressly permitted by this license is prohibited.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

# Reference implementation

Authentication behavior and endpoint discovery were informed by [brightspace-mcp-server](https://github.com/RohanMuppa/brightspace-mcp-server), version 5.1.27, by Rohan Muppa. dd2l does not import or run that server. The applicable notice is retained here for attribution of the reference work:

MIT License

Copyright (c) 2026 Rohan Muppa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
