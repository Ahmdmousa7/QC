export interface RowData {
  [key: string]: any;
}

export interface FileData {
  name: string;
  rows: RowData[];
  columns: string[];
}

export enum ComparisonStatus {
  MATCH = 'MATCH',
  MISMATCH = 'MISMATCH',
  MISSING_IN_FILE_1 = 'MISSING_IN_FILE_1',
  MISSING_IN_FILE_2 = 'MISSING_IN_FILE_2',
}

export type ColumnMapping = Record<string, string>; // Key: File1 Column, Value: File2 Column

export interface ComparisonResult {
  status: ComparisonStatus;
  key: string;
  dataFile1?: RowData;
  dataFile2?: RowData;
  differences?: string[]; // List of column names (from File 1) that differ
  differencesDescription?: string; // Description of the differences
}

export interface ComparisonSummary {
  totalRows: number;
  matches: number;
  mismatches: number;
  missingIn1: number;
  missingIn2: number;
  results: ComparisonResult[];
}

export interface AnalysisState {
  loading: boolean;
  content: string | null;
  error: string | null;
}
