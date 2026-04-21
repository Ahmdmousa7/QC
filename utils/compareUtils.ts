import { FileData, ComparisonResult, ComparisonStatus, ComparisonSummary, RowData, ColumnMapping } from '../types';

export const compareDatasets = (
  file1: FileData,
  file2: FileData,
  keyColumn1: string,
  keyColumn2: string,
  mapping: ColumnMapping,
  enableTolerance: boolean = false,
  enableFuzzyMatch: boolean = false
): ComparisonSummary => {
  const results: ComparisonResult[] = [];
  
  // Create maps for O(1) lookup using the respective key columns
  const map1 = new Map<string, RowData>();
  file1.rows?.forEach(row => {
    const key = normalize(row[keyColumn1]);
    map1.set(key, row);
  });

  const map2 = new Map<string, RowData>();
  file2.rows?.forEach(row => {
    const key = normalize(row[keyColumn2]);
    map2.set(key, row);
  });

  const processedKeys = new Set<string>();

  // Iterate through File 1 keys
  map1?.forEach((row1, key) => {
    processedKeys.add(key);
    const row2 = map2.get(key);

    if (!row2) {
      // Present in 1, missing in 2
      results.push({
        status: ComparisonStatus.MISSING_IN_FILE_2,
        key,
        dataFile1: row1,
      });
    } else {
      // Present in both, check for equality using the mapping
      const differences = getDifferences(row1, row2, mapping, enableTolerance, enableFuzzyMatch);
      if (differences.length === 0) {
        results.push({
          status: ComparisonStatus.MATCH,
          key,
          dataFile1: row1,
          dataFile2: row2,
        });
      } else {
        const differencesDescription = differences.map(diff => {
          const val1 = row1[diff];
          const val2 = row2[mapping[diff]];
          return `${diff}: '${val1}' -> '${val2}'`;
        }).join(', ');

        results.push({
          status: ComparisonStatus.MISMATCH,
          key,
          dataFile1: row1,
          dataFile2: row2,
          differences,
          differencesDescription,
        });
      }
    }
  });

  // Check for keys in File 2 that were not in File 1
  map2?.forEach((row2, key) => {
    if (!processedKeys.has(key)) {
      results.push({
        status: ComparisonStatus.MISSING_IN_FILE_1,
        key,
        dataFile2: row2,
      });
    }
  });

  // Calculate summary stats
  const matches = results.filter(r => r.status === ComparisonStatus.MATCH).length;
  const mismatches = results.filter(r => r.status === ComparisonStatus.MISMATCH).length;
  const missingIn1 = results.filter(r => r.status === ComparisonStatus.MISSING_IN_FILE_1).length;
  const missingIn2 = results.filter(r => r.status === ComparisonStatus.MISSING_IN_FILE_2).length;

  return {
    totalRows: results.length,
    matches,
    mismatches,
    missingIn1,
    missingIn2,
    results,
  };
};

const getDifferences = (row1: RowData, row2: RowData, mapping: ColumnMapping, enableTolerance: boolean = false, enableFuzzyMatch: boolean = false): string[] => {
  const diffs: string[] = [];
  
  // Only compare columns defined in the mapping
  Object.entries(mapping || {})?.forEach(([col1, col2]) => {
    if (col2 === '__IGNORE__') return;

    const val1 = row1[col1];
    const val2 = row2[col2];

    if (!areValuesEqual(val1, val2, enableTolerance, enableFuzzyMatch)) {
      diffs.push(col1); 
    }
  });
  
  return diffs;
};

// --- CORE NORMALIZATION LOGIC ---

// Uses Intl.NumberFormat for reliable numeric formatting without scientific notation.
// Handles up to 20 decimal places to prevent unwanted rounding of high-precision floats.
const numberFormatter = new Intl.NumberFormat('en-US', {
  useGrouping: false, // Disables commas (e.g. 1000 instead of 1,000)
  maximumFractionDigits: 20, 
});

const normalize = (val: any): string => {
  if (val === undefined || val === null) return '';
  
  // 1. Convert to string and trim whitespace
  let s = String(val).trim();
  
  // 2. Remove "ghost" characters (Zero-width space, BOM, etc.) often found in Excel data
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');

  if (s === '') return '';

  // 2.5 Convert Arabic/Persian numerals to English numerals
  s = s.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
       .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));

  // 2.6 Convert Arabic decimal separator to dot
  s = s.replace(/٫/g, '.');

  // 2.7 If it looks like scientific notation with a comma as decimal separator (e.g. 6,1795E+11)
  // replace the comma with a dot.
  if (/^-?\d+,\d+[Ee][+-]?\d+$/.test(s)) {
    s = s.replace(',', '.');
  }

  // 3. Prepare for numeric parsing: remove commas
  // "1,200,000" -> "1200000"
  const cleanStr = s.replace(/,/g, '');
  
  // 4. Check if it's scientific notation or contains 'E'/'e' which might be a SKU
  const isSci = /^-?\d+(?:\.\d+)?[Ee][+-]?\d+$/.test(cleanStr);
  
  if (!isSci) {
    // 5. Try parsing as a Number
    const n = Number(cleanStr);

    // 6. If it is a valid number (and not an empty string which Number converts to 0)
    //    and it doesn't contain 'E' or 'e' (to protect SKUs like 123E4)
    if (!isNaN(n) && cleanStr.length > 0 && !/[Ee]/.test(cleanStr)) {
      return numberFormatter.format(n);
    }
  }

  // 7. Fallback: Case-insensitive string match for non-numeric IDs (e.g. "SKU-A" vs "sku-a")
  //    Also preserves scientific notations like "1.23E+19" so matchSciAndLong can handle them
  return s.toUpperCase();
};

// Re-export normalize as normalizeKey for clarity
const normalizeKey = normalize;

// Helper for fuzzy string matching (Levenshtein distance)
const levenshteinDistance = (a: string, b: string): number => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1 // deletion
          )
        );
      }
    }
  }

  return matrix[b.length][a.length];
};

// Compare values using the exact same normalization logic
const areValuesEqual = (v1: any, v2: any, enableTolerance: boolean = false, enableFuzzyMatch: boolean = false): boolean => {
  const norm1 = normalize(v1);
  const norm2 = normalize(v2);
  
  if (norm1 === norm2) return true;
  
  // If exact string match fails, check if one is scientific notation and the other is a long number
  // This handles cases where Excel exports a long number as scientific notation (e.g., 1.23456789012345E+19)
  // while the other file has the full string (e.g., 12345678901234567890)
  const isSci1 = /^-?\d+(?:\.\d+)?[Ee][+-]?\d+$/.test(norm1);
  const isSci2 = /^-?\d+(?:\.\d+)?[Ee][+-]?\d+$/.test(norm2);
  
  if (isSci1 && !isSci2) return matchSciAndLong(norm1, norm2);
  if (!isSci1 && isSci2) return matchSciAndLong(norm2, norm1);
  
  if (enableTolerance) {
    const num1 = parseFloat(norm1.replace(/,/g, ''));
    const num2 = parseFloat(norm2.replace(/,/g, ''));
    if (!isNaN(num1) && !isNaN(num2)) {
      // Round to 1 decimal place for tolerance
      if (Math.round(num1 * 10) === Math.round(num2 * 10)) return true;
    }
  }

  if (enableFuzzyMatch) {
    // Only apply fuzzy match to strings that are not purely numeric
    const isNum1 = !isNaN(parseFloat(norm1.replace(/,/g, '')));
    const isNum2 = !isNaN(parseFloat(norm2.replace(/,/g, '')));
    
    if (!isNum1 && !isNum2) {
      const distance = levenshteinDistance(norm1, norm2);
      const maxLength = Math.max(norm1.length, norm2.length);
      // Allow up to 20% difference or 2 characters, whichever is larger
      const threshold = Math.max(2, Math.floor(maxLength * 0.2));
      if (distance <= threshold) return true;
    }
  }

  return false;
};

// Helper to compare a scientific notation string with a long number string
const matchSciAndLong = (sci: string, long: string): boolean => {
  const cleanLong = long.replace(/,/g, '').trim();
  if (!/^-?\d+$/.test(cleanLong)) return false;
  
  const match = sci.match(/^(-?)(\d+)(?:\.(\d+))?[Ee]([+-]?\d+)$/);
  if (!match) return false;
  
  const sign = match[1];
  const intPart = match[2];
  const fracPart = match[3] || '';
  const exp = parseInt(match[4], 10);
  
  const sciMagnitude = intPart.length - 1 + exp;
  
  const longSign = cleanLong.startsWith('-') ? '-' : '';
  const longDigits = cleanLong.replace(/^-/, '');
  const longMagnitude = longDigits.length - 1;
  
  if (sign !== longSign || sciMagnitude !== longMagnitude) return false;
  
  const sciDigitsFull = intPart + fracPart;
  const sigDigitsCount = sciDigitsFull.length;
  
  if (longDigits.length > sigDigitsCount) {
    const longPrefix = longDigits.substring(0, sigDigitsCount);
    const nextDigit = parseInt(longDigits.charAt(sigDigitsCount), 10);
    
    let roundedLongPrefix = longPrefix;
    if (nextDigit >= 5) {
      let carry = 1;
      let res = '';
      for (let i = longPrefix.length - 1; i >= 0; i--) {
        const sum = parseInt(longPrefix[i], 10) + carry;
        res = (sum % 10) + res;
        carry = Math.floor(sum / 10);
      }
      if (carry > 0) {
        res = carry + res;
      }
      roundedLongPrefix = res;
    }
    
    if (roundedLongPrefix === sciDigitsFull || longPrefix === sciDigitsFull) return true;
  } else {
    const paddedLong = longDigits.padEnd(sigDigitsCount, '0');
    if (paddedLong === sciDigitsFull) return true;
  }
  
  const expectedLong = sciDigitsFull + '0'.repeat(Math.max(0, sciMagnitude - sigDigitsCount + 1));
  return longDigits === expectedLong;
};
