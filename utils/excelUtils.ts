import * as XLSX from 'xlsx';
import { FileData, RowData } from '../types';

export const expandScientificNotation = (val: string): string => {
  const str = String(val).trim();
  const match = str.match(/^-?(\d+)(?:\.(\d+))?[Ee]([+-]?\d+)$/);
  if (!match) return str;
  
  const sign = str.startsWith('-') ? '-' : '';
  const intPart = match[1];
  const decPart = match[2] || '';
  const exp = parseInt(match[3], 10);
  
  if (exp === 0) {
    return `${sign}${intPart}${decPart ? '.' + decPart : ''}`;
  }
  
  if (exp > 0) {
    let newInt = intPart + decPart;
    if (exp >= decPart.length) {
      newInt += '0'.repeat(exp - decPart.length);
      return `${sign}${newInt}`;
    } else {
      return `${sign}${newInt.slice(0, intPart.length + exp)}.${newInt.slice(intPart.length + exp)}`;
    }
  } else {
    const absExp = Math.abs(exp);
    if (absExp >= intPart.length) {
      return `${sign}0.${'0'.repeat(absExp - intPart.length)}${intPart}${decPart}`;
    } else {
      return `${sign}${intPart.slice(0, intPart.length - absExp)}.${intPart.slice(intPart.length - absExp)}${decPart}`;
    }
  }
};

export const fixScientificNotation = (worksheet: XLSX.WorkSheet) => {
  for (const key in worksheet) {
    if (key[0] === '!') continue;
    const cell = worksheet[key];
    
    // If it's a number and formatted as scientific notation
    if (cell.t === 'n' && cell.w && /[Ee][+-]?\d+/.test(cell.w)) {
      cell.w = cell.v.toLocaleString('fullwide', { useGrouping: false });
    } 
    // If it's a string that looks exactly like scientific notation (e.g. from CSV)
    // We require a '+' or '-' sign in the exponent to avoid converting SKUs like "123E4"
    else if (cell.t === 's' && typeof cell.v === 'string' && /^-?\d+(?:\.\d+)?[Ee][+-]\d+$/.test(cell.v.trim())) {
      cell.w = expandScientificNotation(cell.v);
      cell.v = cell.w;
    }
  }
};

export const readWorkbook = async (file: File): Promise<{ file: File, workbook: XLSX.WorkBook, sheetNames: string[] }> => {
  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(data), { type: 'array', raw: true });
    if (!workbook || !workbook.SheetNames) {
      throw new Error("Failed to parse workbook");
    }
    return { file, workbook, sheetNames: workbook.SheetNames };
  } catch (error) {
    throw error;
  }
};

export const extractSheets = (workbook: XLSX.WorkBook, fileName: string, sheetNames: string[]): FileData[] => {
  const fileDatas: FileData[] = [];
  sheetNames?.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    
    // Fix scientific notations before parsing
    fixScientificNotation(worksheet);
    
    const jsonData = XLSX.utils.sheet_to_json<RowData>(worksheet, { header: 1, raw: false });
    if (jsonData.length > 0) {
      const rows = XLSX.utils.sheet_to_json<RowData>(worksheet, { raw: false, defval: '' });
      
      let headers: string[] = [];
      if (rows.length > 0) {
        headers = Object.keys(rows[0]).filter(k => !k.startsWith('__EMPTY'));
      } else {
        const rawHeaders = (jsonData[0] as any[]).map(h => String(h || '').trim()).filter(h => h !== '');
        const seen = new Set<string>();
        headers = rawHeaders.map(h => {
          let newH = h;
          let counter = 1;
          while (seen.has(newH)) {
            newH = `${h}_${counter}`;
            counter++;
          }
          seen.add(newH);
          return newH;
        });
      }

      fileDatas.push({
        name: sheetNames.length > 1 || workbook.SheetNames.length > 1 ? `${fileName} - ${sheetName}` : fileName,
        rows: rows,
        columns: headers,
      });
    }
  });
  return fileDatas;
};

export const parseFile = async (file: File): Promise<FileData> => {
  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(data), { type: 'array', raw: true });
    if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error("Failed to parse workbook or workbook is empty");
    }
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Fix scientific notations before parsing
    fixScientificNotation(worksheet);
    
    // Parse to JSON to check for content and get headers
    const jsonData = XLSX.utils.sheet_to_json<RowData>(worksheet, { header: 1, raw: false });
    
    if (jsonData.length === 0) {
      throw new Error("Sheet is empty");
    }

    // Get all rows
    const rows = XLSX.utils.sheet_to_json<RowData>(worksheet, { raw: false, defval: '' });

    let headers: string[] = [];
    if (rows.length > 0) {
      headers = Object.keys(rows[0]).filter(k => !k.startsWith('__EMPTY'));
    } else {
      const rawHeaders = (jsonData[0] as any[]).map(h => String(h || '').trim()).filter(h => h !== '');
      const seen = new Set<string>();
      headers = rawHeaders.map(h => {
        let newH = h;
        let counter = 1;
        while (seen.has(newH)) {
          newH = `${h}_${counter}`;
          counter++;
        }
        seen.add(newH);
        return newH;
      });
    }

    return {
      name: file.name,
      rows: rows,
      columns: headers,
    };
  } catch (error) {
    throw error;
  }
};

export const exportToCSV = (data: any[], filename: string) => {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${filename}.csv`);
};

export const exportToExcelMultipleSheets = (datasets: { name: string; rows: any[] }[], filename: string) => {
  const wb = XLSX.utils.book_new();
  
  datasets?.forEach((dataset, index) => {
    const ws = XLSX.utils.json_to_sheet(dataset.rows);
    
    // Excel sheet names have a 31 character limit and cannot contain : \ / ? * [ ]
    let safeName = dataset.name.replace(/\.[^/.]+$/, ""); // remove extension
    safeName = safeName.replace(/[:\\/?*[\]]/g, " ");
    safeName = safeName.substring(0, 31);
    
    // Ensure unique sheet names
    if (wb.SheetNames.includes(safeName)) {
      safeName = `${safeName.substring(0, 28)}_${index}`;
    }

    XLSX.utils.book_append_sheet(wb, ws, safeName);
  });

  XLSX.writeFile(wb, `${filename}.xlsx`);
};

export const exportToExcelSingleSheet = (datasets: FileData[], filename: string) => {
  const wb = XLSX.utils.book_new();
  
  // 1. Determine Supersets of Headers to ensure no data loss if columns vary slightly
  const allHeaders = new Set<string>();
  allHeaders.add("Source_File"); // Add a metadata column to track origin
  
  datasets?.forEach(d => {
    d.columns?.forEach(col => allHeaders.add(col));
  });
  
  const headerArr = Array.from(allHeaders);
  
  // 2. Flatten all rows
  const allRows: any[] = [];
  datasets?.forEach(d => {
    d.rows?.forEach(row => {
      // Create a new object with Source_File at the beginning
      const rowWithSource = { Source_File: d.name, ...row };
      allRows.push(rowWithSource);
    });
  });
  
  // 3. Create Sheet
  // We pass headerArr to ensure columns are ordered and the Source_File comes first
  const ws = XLSX.utils.json_to_sheet(allRows, { header: headerArr });
  XLSX.utils.book_append_sheet(wb, ws, "Merged_Data");
  
  XLSX.writeFile(wb, `${filename}.xlsx`);
};

export const cleanEmptyColumns = (fileData: FileData, startRowIndex: number = 0): { cleanedData: FileData, removedColumns: string[] } => {
  const { columns, rows, name } = fileData;
  const removedColumns: string[] = [];
  const keptColumns: string[] = [];

  // We need to check all keys present in the rows, because sheet_to_json might add __EMPTY keys
  const allKeys = new Set<string>(columns);
  rows?.forEach(row => {
    Object.keys(row || {})?.forEach(k => allKeys.add(k));
  });

  Array.from(allKeys)?.forEach(col => {
    const rowsToCheck = rows.slice(startRowIndex);
    
    // If startRowIndex is beyond the number of rows, fallback to checking all rows
    const actualRowsToCheck = rowsToCheck.length > 0 ? rowsToCheck : rows;
    
    const isAllEmpty = actualRowsToCheck.every(row => {
      const val = row[col];
      return val === null || val === undefined || String(val).trim() === '';
    });

    // If the column is completely empty, or it's an __EMPTY column with no data
    if (isAllEmpty) {
      removedColumns.push(col);
    } else {
      if (columns.includes(col) || !col.startsWith('__EMPTY')) {
        keptColumns.push(col);
      } else {
        // It's an __EMPTY column but has data, we should keep it
        keptColumns.push(col);
      }
    }
  });

  const cleanedRows = rows.map(row => {
    const newRow: any = {};
    keptColumns?.forEach(col => {
      if (row[col] !== undefined) {
        newRow[col] = row[col];
      }
    });
    return newRow;
  });

  return {
    cleanedData: {
      name,
      columns: keptColumns,
      rows: cleanedRows
    },
    removedColumns
  };
};
