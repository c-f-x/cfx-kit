# Third-party notices

Parts of the kit were ported from cfmail, which is a copy of an MIT-licensed project. The ported parts are named in each file's header comment: `packages/kit/src/worker/keys.ts` (`randomToken`, `sha256Hex`), `packages/kit/src/worker/job.ts` (the cron step isolation), and `packages/kit/src/checks/wrangler-config.ts` and `packages/kit/src/checks/migrations.ts` (cfmail's configuration and migration checks). That project's licence:

```
MIT License

Copyright (c) 2026 Julian Haag
Copyright (c) 2026 Jan Hallvard Larsen

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
```

Code ported from cfanalytics is the owner's own and needs no notice here.
