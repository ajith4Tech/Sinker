# Sinker

A single-page internal tool: upload Shipping Bill PDFs (or a ZIP of them),
click **Extract**, review every row in an in-browser preview, then click
**Download Updated Excel** once you're satisfied. No AI, no OCR — every
value comes directly from text found in the PDF, or is left blank. No
login, no database — the workbook you download *is* the record; feed it
back in as your "custom template" next time and already-seen rows are
skipped automatically.

## Architecture

**One Next.js app; Python runs once per "Extract" click, not once per PDF.**
`POST /api/extract` saves the upload to a scratch directory, writes a small
JSON manifest (input paths, template path, output paths), and spawns
`scripts/parser.py` exactly once for the whole batch. This is a hard
requirement, not a preference: the workbook must be loaded once and saved
once (see Performance below), which is only possible if one process owns it
for the batch's entire lifetime. A worker-process pool inside `parser.py`
parses PDFs in parallel; only the main process ever touches the workbook.

**Progress streams over plain `fetch`, not SSE/websockets.** `parser.py`
prints one JSON object per line to stdout as work completes (`totals` /
`file` events), flushing immediately. Node reads that with `readline`
inside an async generator (`lib/run-extract.ts`) and re-emits each line as
newline-delimited JSON in the HTTP response; the page reads it with a
`TextDecoder` loop. No extra library, and it survives long batches without a
request-timeout assumption.

**No database — the workbook is the source of truth.** Before appending
anything, `ExcelWriter` scans the template's existing data rows once and
builds an in-memory key set from `Shipping Bill No|Invoice No|Item No`.
Every extracted line item is checked against that set (O(1)) before being
appended; there is nothing else durable to keep in sync.

**Downloads are one-shot.** Generated files live in `temp/output/<runId>/`
and are deleted from disk the instant they're read into memory to serve a
download — there's no database to mark "already downloaded," so the file's
presence on disk *is* that state. A defensive sweep (age > 1 hour) cleans up
output directories nobody ever downloaded, since there's no scheduler to do
it proactively.

**The parser knows nothing about Excel, and vice versa.** `ShippingBillParser`
is a pure function (PDF text in, a `ShippingBillResult` dataclass out) —
no filesystem, no Excel. `ExcelWriter` only ever sees plain row values and a
key string — no PDF, no regex. Both depend on the shared `models.py`
contract and nothing else, so a second document type's parser could be
added later without either module changing.

**Custom templates must match the built-in column order.** `ExcelWriter`
writes by fixed column *index* (see `COLUMNS` in `excel_writer.py`), not by
matching header text — simplest option, and the only one that didn't
require guessing at header-matching rules with no real custom templates to
test against yet.

**The worksheet is converted to JSON exactly once, from memory, never
re-parsed.** Right after `writer.save(...)`, `ExcelWriter.to_preview()`
walks the *same in-memory workbook object* `parser.py` already has open —
never by re-opening the file it just wrote — and returns every data row
(pre-existing and newly-appended alike) as plain JSON. That payload rides
along on the same final NDJSON event Node already sends, so the browser
never has to download the `.xlsx` to know what's in it. `ExcelPreview.tsx`
renders that JSON with AG Grid Community — native row virtualization, sort,
per-column filter, and quick-filter search, all entirely client-side and
never touching the workbook file. Clicking **Download Updated Excel** serves
the file `parser.py` already saved to disk — nothing is regenerated.

**The Processing Log never shows extracted field values.** It's a plain
chronological activity feed (`Processing started` / one line per finished
PDF, status + timing only / `Extraction complete — ...`) — collapsed by
default, because after a run finishes the Excel Preview above it is the
thing worth looking at, not a log. Actual extracted values only ever
appear in the Excel Preview grid.

## Folder structure

```
sinker/
  app/
    page.tsx                          the single page (renders UploadClient)
    layout.tsx
    api/
      extract/route.ts                POST: streams NDJSON while a batch runs
      download/[runId]/[file]/route.ts  GET: serves + deletes one output file
  components/
    upload-client.tsx                 page state/interactivity: upload, extract, log
    ExcelPreview.tsx                  AG Grid worksheet preview (sort/filter/search)
    SummaryCard.tsx                   "Extraction completed" banner + stats
    DownloadPanel.tsx                 Download Updated Excel / Download Error Report
    file-drop-zone.tsx                 drag-and-drop / click-to-browse input
    ui/                                shadcn/ui primitives
  lib/
    run-extract.ts                    upload -> manifest -> spawn Python -> NDJSON
    types.ts                          ExtractEvent contract (mirrors models.py)
    utils.ts                          cn() Tailwind helper
  scripts/
    parser.py                         CLI entrypoint: worker pool + orchestration
    shipping_bill_parser.py           ShippingBillParser: PDF text -> structured data
    excel_writer.py                   ExcelWriter: load, dedupe, append, save
    patterns.py                       regex label patterns (data, not logic)
    models.py                         shared dataclasses (LineItem, ShippingBillResult)
    utils.py                          PDF/ZIP discovery, text extraction, key builder
    generate_template.py              one-time script that (re)builds Book3.xlsx
    requirements.txt
  templates/
    Book3.xlsx                        built-in default workbook
  temp/
    uploads/<runId>/                  scratch space per run, deleted when it ends
    output/<runId>/                   generated workbook.xlsx (+ errors.csv), deleted on download
  public/
  README.md
```

## Sync flow

```
Browser (UploadClient)
  -> POST /api/extract (multipart: files[], customTemplate?)
       lib/run-extract.ts:
         1. save uploads to temp/uploads/<runId>/
         2. write manifest.json (paths, template, output locations)
         3. spawn `python3 scripts/parser.py manifest.json`
       scripts/parser.py:
         4. discover_pdf_paths(): expand any .zip inputs
         5. ExcelWriter(template): load workbook once, build dedup key set once
         6. ProcessPoolExecutor: parse every PDF in parallel
         7. for each completed PDF (main process, sequential):
              - append new line items' rows / skip duplicates
              - print one NDJSON "file" + "totals" event
         8. workbook.save() — once, after every PDF is done
         9. write errors.csv if any PDF failed
        10. writer.to_preview() — convert the in-memory worksheet to JSON, once
        11. print final "summary" event (includes that JSON)
  <- NDJSON stream (Node translates "summary" into "done" + download URLs + preview)
  -> the page's "Excel Preview" section appears, rendering the worksheet from that JSON
  -> user reviews rows, then clicks "Download Updated Excel"
  -> GET /api/download/<runId>/workbook.xlsx (and /errors.csv if present)
       reads the file into memory, deletes it from disk, returns it
```

## Excel preview

`ExcelPreview.tsx` renders `WorksheetPreview` (from `lib/types.ts`) — the
JSON `ExcelWriter.to_preview()` produced — using **AG Grid Community**
(`ag-grid-react`). It's read-only: no column has `editable: true`, and
nothing in this component can write back to the workbook. Sort, filter,
and search only ever change what's *displayed*.

- **Row identity**: each row carries its real 1-based Excel row number
  (`rowNumber`), shown in a pinned leftmost `#` column and preserved
  through sorting/filtering — exactly like Excel's own row numbers stay put
  when you filter.
- **New-row highlight**: any row `ExcelWriter` appended *this run*
  (`isNew: true`) gets a light green background via a `rowClassRules`
  rule (`.row-new` in `app/globals.css`); every pre-existing row (including
  one that "won" a duplicate check and stayed as-is) renders with the
  normal alternating shading. There's nothing to distinguish for skipped
  duplicates specifically — they were never appended, so the existing row
  they matched is just... already there.
- **Virtualization, sorting, filtering, quick-filter search**: all native
  AG Grid Community behavior — `rowData`/`columnDefs` are a direct mapping
  of `WorksheetPreview`, not a separately-built table model, so the preview
  can never drift from what "Download Updated Excel" actually serves.
  Regardless of whether the sheet has 50 or 50,000 rows, AG Grid only ever
  mounts the rows currently scrolled into view.
- Chosen over TanStack Table for this pass specifically because AG Grid's
  default look already reads as "a spreadsheet" with no extra styling work
  — the tradeoff is a meaningfully larger client bundle (AG Grid Community
  is a full-featured grid engine, not a headless library), which is
  acceptable for an internal tool but worth knowing about.

## Page layout

The page is one linear flow, top to bottom, in this fixed order — no tabs:

1. Upload PDFs / ZIP
2. Excel Template (default or custom)
3. Extract button
4. Progress (live counts + current PDF, while a run is active)
5. Summary (appears once a run finishes)
6. **Excel Preview** — the primary thing to look at after extraction
7. Download Updated Excel / Download Error Report
8. Processing Log — a `Collapsible`, closed by default

The Processing Log is deliberately last and closed by default: once
there's a real result, the Excel Preview above it is what matters, not a
scrolling log. The log itself is a plain activity feed — `"Processing
started"`, one line per finished PDF (filename, status, timing — clicking
one reveals its warnings/error and, if it wasn't from inside a ZIP, the
uploaded PDF itself), and a final `"Extraction complete — ..."` line. It
never shows a row's extracted field values — that's what the Excel Preview
section is for.

## Incremental processing & duplicate prevention

There is no metadata file and no database. The workbook itself is scanned
once per run:

1. `ExcelWriter` reads every existing data row (from row 2 to the last row
   with data in the key columns) and builds a `set()` of
   `f"{shipping_bill}|{invoice_number}|{item_number}"` strings.
2. For every extracted line item, the same key is computed and checked
   against that set — O(1) lookup, never a re-scan.
3. If the key exists: the row is skipped (`rowsSkipped`). If not: the row is
   appended at the next free row and the key is added to the set (so two
   PDFs in the *same* batch with an overlapping item are also deduplicated,
   not just across runs).

Because the check happens against whatever workbook was loaded, running
Sinker again against its own previous output (used as next time's "custom
template") is what makes processing incremental — there's no other state to
carry forward.

## Parser design

- `patterns.py` holds only regex label patterns (`HEADER_PATTERNS`,
  `ITEM_PATTERNS`), grouped separately from `shipping_bill_parser.py`'s
  control flow so extraction rules can be widened without touching the
  parsing strategy.
- Header fields (Shipping Bill No/Date, Invoice No/Date, IEC, GSTIN, Port
  Code, Exchange Rate) are matched once against the whole document.
- Line items are found by splitting the document on each `Item No` / `Sl No`
  boundary and matching the item-level fields (HS Code, Description,
  Quantity, UQC, Rate, FOB, Invoice Value, Drawback, RODTEP) within each
  resulting block.
- A label that isn't found leaves that field `None` — nothing is ever
  inferred or guessed.
- `ShippingBillParser.parse(text: str)` takes and returns plain data
  (`ShippingBillResult`/`LineItem` from `models.py`); it never touches a
  filesystem path, making it directly unit-testable without going through
  `extract_pdf_text()` or a real PDF file.

## Performance

- The workbook is loaded exactly once (`ExcelWriter.__init__`) and saved
  exactly once (`writer.save(...)`, after the whole batch finishes).
- The duplicate-detection key set is built once, in the same pass that
  finds the true last data row (ignoring any trailing formatted-but-empty
  rows some templates ship with).
- PDF parsing runs in a `ProcessPoolExecutor` (default: one worker per CPU
  core, overridable via `PARSER_MAX_WORKERS`) — the only part of the
  pipeline that runs in parallel, since only one process may safely hold the
  open workbook.
- Rows are appended to the in-memory workbook object as results complete;
  nothing is written to disk until the single final `save()`.
- The worksheet-to-JSON conversion for the preview happens exactly once,
  after `save()`, from the same in-memory object — not a second file read.
- The preview itself never re-renders 20,000 DOM rows: AG Grid's built-in
  row virtualization only mounts the rows currently scrolled into view.

## Error handling

A PDF failing to parse (corrupt file, unreadable scan, unexpected content)
is caught inside the worker process, recorded, and never aborts the batch —
see the `try`/`except` in `parser.py`'s `_parse_one`. Failures are:

- Reported live as a `"file"` event with `status: "failed"` and the error
  message, so the page's Log shows exactly which files failed and why.
- Collected into `errors.csv` (only written if at least one PDF failed) and
  offered as a separate download alongside the workbook.

Every temporary PDF and the whole upload scratch directory are removed in a
`finally` block in `lib/run-extract.ts`, regardless of success or failure.

## Setup

**Just want to use the app?** See [USER_MANUAL.md](USER_MANUAL.md) — open
this repo on GitHub, click **Code → Codespaces → Create codespace on main**,
run `npm run dev`, done. `.devcontainer/` handles installing everything
automatically.

The rest of this section is for running it locally instead:

```bash
npm install

python3 -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements.txt

cp .env.example .env
# set PYTHON_BIN to your venv's interpreter, e.g.:
#   PYTHON_BIN="/absolute/path/to/sinker/.venv/bin/python3"

npm run dev
```

Open the app, upload PDFs (or a ZIP), choose a template, and click
**Extract**.

### Testing the parser standalone

```bash
source .venv/bin/activate
cd scripts
python3 -c "
from utils import extract_pdf_text
from shipping_bill_parser import ShippingBillParser
print(ShippingBillParser().parse(extract_pdf_text('/path/to/a/shipping-bill.pdf')).to_dict())
"
```

Useful for tuning `patterns.py`'s regex patterns against real sample PDFs
without going through the UI or a browser upload.

### Regenerating the default template

```bash
source .venv/bin/activate
cd scripts
python3 generate_template.py   # only needed if COLUMNS in excel_writer.py changes
```

## Known limitations

- **`patterns.py`'s regex patterns are a first pass**, validated against
  synthetic sample PDFs built from the spec's field list, not real Shipping
  Bill documents. Expect to widen these lists (not the parsing strategy)
  once real sample PDFs are available — wording and layout vary between
  customs brokers and ports.
- **Custom templates are assumed to share the built-in template's exact
  column order** (`COLUMNS` in `excel_writer.py`). There's no header-name
  matching, by design, until real custom templates exist to test that logic
  against.
- **The destination sheet is always the workbook's active sheet**, with row
  1 as the header — see `HEADER_ROW`/`COLUMNS` in `excel_writer.py`.
- **`npm audit` reports 2 moderate findings**, both `postcss` bundled inside
  Next.js itself (a build-time CSS stringification issue, not something
  triggered by anything this app does at runtime). Fixing requires a Next.js
  major-version bump; tracked, not fixed, in this pass.
- **AG Grid Community noticeably increases the page's JS bundle** (the
  homepage's first-load JS grew from ~150 kB to ~430 kB after switching from
  TanStack Table). Acceptable for an internal tool used by one person on a
  Codespace, but worth knowing if this ever needs to be fast on a slow
  connection.
- **The Excel Preview's light/dark AG Grid theme isn't wired to the app's
  theme toggle** — it always renders AG Grid's default (light) Quartz theme
  regardless of the rest of the page's color scheme.
