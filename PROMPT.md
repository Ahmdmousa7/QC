# Master Prompt: ExcelDiff AI (Advanced Data Suite) v1.2

## 1. Project Overview & Identity
**Name:** ExcelDiff AI / Advance Data Comparison Engine
**Purpose:** A robust, browser-based React web application suite designed to compare, clean, manipulate, and orchestrate large datasets (Excel/CSV files and Images). It runs entirely client-side (except for AI operations) yielding highly secure and extremely fast experiences.
**Current Version:** v1.2 (Includes Non-Destructive Navigation States & UI Flow retention).

## 2. Core Directives & Developer Guidelines
As an AI assisting on this project, you MUST adhere to the following masterclass rules provided by the lead architect:
*   **Enhancement over Replacement:** When asked for an enhancement, DO NOT delete existing logic or files. Augment and upgrade the code without breaking structural integrity.
*   **Zero Hassle Code:** Write clean, highly optimized, and production-ready code. No "hassle" code. Do internal reviews before providing a solution and always choose the absolute best practice.
*   **Test Before Delivery:** Mentally walk through or verify changes before confirming they are done. 
*   **Version Tagging:** Add version tags (e.g., v1.1, v1.2) to major enhancements in comments and documentation to track the evolution of features.
*   **Thorough Documentation:** Add inline documentation for everything we do. Complex logic bounds must be heavily commented.
*   **Responsive UI:** Charts and elements must be fully responsive. Never leave console errors (e.g., Recharts `-1` width warnings; always use `minWidth={1} minHeight={1}`).

## 3. Tech Stack
*   **Framework:** React 19 + TypeScript + Vite.
*   **Styling:** Tailwind CSS (Mobile-first, responsive, clean enterprise look).
*   **File Parsing:** `xlsx` (SheetJS) for parsing `.xlsx` and `.csv` files locally.
*   **Data Visualization:** `recharts` (PieChart, BarChart for summary distributions).
*   **Icons:** `lucide-react`.
*   **AI Integration:** `@google/genai` (Gemini) used for OCR and comparative reporting.
*   **File Utilities:** `file-saver`, `jszip` for downloading bundled files.

## 4. The 8 Core Applications / Tools

### App 1: Compare Files Engine (`activeTab: 'compare'`)
*   **Purpose:** Compares two Excel/CSV sets based on a Primary Key and matches column values.
*   **Engine (`compareUtils.ts`):** 
    *   **Invisible Character Purge:** Purges zero-width spaces/BOMs (`[\u200B-\u200D\uFEFF]`).
    *   **Number Localization:** Translates Arabic/Persian numerals (`٠-٩`/`۰-۹`) to English `0-9` and Arabic commas (`٫`) to dots `.`.
    *   **Scientific Notation Math Recovery:** Fixes cases where Excel aggressively truncates 13+ digit numbers to notation (e.g., `6.17E+12`). The `matchSciAndLong` calculates matching floating-point significance to recover the true relation.
    *   **Tolerance Engine:** Normalizes floating-point tolerance (rounding values) so `10.5` matches `10.5003`.
    *   **Fuzzy Matching:** Implements Levenshtein distance for < 20% string divergence text matching.
*   **Visuals (`ComparisonChart.tsx`):** Utilizes `PieChart` (overall distribution) and `BarChart` (discrepancy breakdown). Includes AI-generated insight reports parsed from Gemini API.

### App 2: Merge Columns (`activeTab: 'merge'`)
*   **Purpose:** Joins multiple sheets/files into one cohesive table.
*   **Features:**
    *   Allows uploading multiple files.
    *   UI displays columns in draggable cards.
    *   Users can reorganize columns via Drag & Drop or manual index tracking.
    *   Includes column renaming and deleting.
    *   Can export as a consolidated Single Sheet, or maintain Separate Sheets.
    *   Contains a "Structure Analysis Report" feature to visually audit missing headers across varied documents.

### App 3: OCR Extractor (`activeTab: 'ocr'`)
*   **Purpose:** Converts tabular data embedded in images into structured Excel sheets.
*   **Features:**
    *   Allows multiple `jpg/jpeg/png/webp` uploads.
    *   Sends image payloads to `extractDataFromImages` inside `geminiService.ts`.
    *   Presents interactive HTML table preview where users can inline-edit cells, add rows, or delete rows before saving to `.xlsx`.
    *   Can be directly sent to "Compare Files" (Slot 1 or Slot 2).

### App 4: Clean Empty Columns (`activeTab: 'clean'`)
*   **Purpose:** Destroys explicitly blank columns scaling across entire datasets.
*   **Features:**
    *   Operates efficiently with a customizable "Start Row" definition to ignore title headers.
    *   Examines down arbitrary array depth; if a column contains literally 0 non-empty values from start-row onwards, it gets surgically removed.

### App 5: Transfer / Mapping Data (`activeTab: 'transfer'`)
*   **Purpose:** Implements a strict Upsert/Map template schema injection.
*   **Features:**
    *   Takes File 1 (Source) and File 2 (Template/Destination).
    *   Maps File 1 columns to File 2 target structure.
    *   If keys are provided, it performs an upsert: It matches keys, updates File 2 rows using File 1 data, or appends a pristine structured template row if it doesn't exist.
    *   If no keys are provided, it merely shifts File 1 values directly under File 2 headers.

### App 6: Separator Tool (`activeTab: 'splitter'`)
*   **Purpose:** Logic-driven file division for breaking down huge datasets (`SplitterTool.tsx`).
*   **Features:**
    *   Mode 1 (Separate Sheets): Converts a 1-file/5-sheet workbook into a `.zip` containing 5 isolated `.xlsx` files using `jszip`.
    *   Mode 2 (Divide Rows): Breaks a monolithic sheet (e.g., 50,000 rows) into segmented chunks (e.g., 1000 rows max per sheet) appending numeric suffixes identically handling header retention on every split.

### App 7: Data Replacement Tool (`activeTab: 'convert'`)
*   **Purpose:** Custom value manipulation/Find-Replace mapping on massive scales (`ReplacementTool.tsx`).
*   **Core Implementations:**
    *   *Convert kg/كيلو to grams:* Scans integers bound to "kg" or Arabic "كيلو", extracting the number and mathematically translating it `* 1000`.
    *   *Extract Numbers Only:* Strips surrounding string context, parsing purely integers/decimals.
    *   *Custom Find & Replace:* Normal exact-string interpolation replacement.
    *   *Advanced Transform:* Scrapes memory for all unique values inside a column, providing an interactive mapping table. Users assign 'EQUAL' or 'MULTIPLY' logic independently to specific string matches. Renders an interactive green preview-table validating the transforms.

### App 8: Check & Clean Blanks (`activeTab: 'check'`)
*   **Purpose:** File sanitation focusing on invisible whitespace problems (`CheckTool.tsx`).
*   **Features:**
    *   Scans cells globally. Detects "Fake Blanks" (cells containing ' ' space strings but no characters).
    *   Finds untrimmed cells holding leading/trailing whitespace.
    *   Presents KPI metric cards dictating total issues. Renders a summary table up to 100 discrepancies dynamically to indicate exactly which rows tripped warnings, finally allowing bulk export of the fixed dataset state.

## 5. UI Architecture / Design Strategy
*   Every tool acts as an independent React state wrapper managed by `App.tsx` tab states.
*   Most tools feature a Sheet Selector Modal (`showSheetModal`) specifically intercepting multi-shhet `.xlsx` files so users definitively choose active target tables rather than blind guessing.
*   UI implements heavy `slate` scale coloring with `brand` (blue/purple) gradients, ensuring a clean, non-lethal data dashboarding UI.

## 6. Future Guidelines for the AI
*   When executing feature builds or fixing bugs, debug locally within the context limit. Locate exact causes.
*   Always implement surgical, contiguous changes using file editing tools without overwriting unrelated features.
*   Always keep the `PROMPT.md` file updated in your context when major architectural changes occur.
