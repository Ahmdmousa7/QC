import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, ArrowRightLeft, Download, Bot, AlertCircle, CheckCircle2, XCircle, Settings2, Link, Layers, FilePlus, Trash2, ToggleLeft, ToggleRight, CheckSquare, Square, ShieldCheck, ScanLine, Image as ImageIcon, Loader2, ArrowRight, Plus, Edit3, Save, FileType, Eraser, Info, ChevronUp, ChevronDown, GripVertical, Wand2, EyeOff } from 'lucide-react';
import { parseFile, exportToCSV, exportToExcelMultipleSheets, exportToExcelSingleSheet, cleanEmptyColumns, readWorkbook, extractSheets } from './utils/excelUtils';
import { compareDatasets } from './utils/compareUtils';
import { FileData, ComparisonSummary, ComparisonStatus, ColumnMapping, RowData } from './types';
import { ComparisonChart } from './components/ComparisonChart';
import { SplitterTool } from './components/SplitterTool';
import { ReplacementTool } from './components/ReplacementTool';
import { CheckTool } from './components/CheckTool';
import { analyzeComparison, extractDataFromImages } from './services/geminiService';

function App() {
  // Tabs: 'compare' | 'merge' | 'ocr' | 'clean' | 'transfer' | 'splitter' | 'convert' | 'check'
  const [activeTab, setActiveTab] = useState<'compare' | 'merge' | 'ocr' | 'clean' | 'transfer' | 'splitter' | 'convert' | 'check'>('compare');

  // --- COMPARE STATE ---
  const [file1, setFile1] = useState<FileData | null>(null);
  const [file2, setFile2] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [processingSlot, setProcessingSlot] = useState<1 | 2 | null>(null);
  
  // Config State
  const [key1, setKey1] = useState<string>('');
  const [key2, setKey2] = useState<string>('');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [enableTolerance, setEnableTolerance] = useState<boolean>(false);
  const [enableFuzzyMatch, setEnableFuzzyMatch] = useState<boolean>(false);

  const [summary, setSummary] = useState<ComparisonSummary | null>(null);
  const [view, setView] = useState<'upload' | 'config' | 'report'>('upload');
  
  // AI State
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // --- MERGE STATE ---
  const [mergeFiles, setMergeFiles] = useState<FileData[]>([]);
  const [isMergeLoading, setIsMergeLoading] = useState(false);
  const [mergeIntoSingleSheet, setMergeIntoSingleSheet] = useState(false);
  const [mergeTab, setMergeTab] = useState<'files' | 'structure'>('files');
  const [draggedCol, setDraggedCol] = useState<{fileIdx: number, colIdx: number} | null>(null);
  const [editingCol, setEditingCol] = useState<{fileIdx: number, colIdx: number} | null>(null);
  const [editingColName, setEditingColName] = useState<string>('');

  // --- OCR STATE ---
  const [ocrImages, setOcrImages] = useState<File[]>([]);
  const [ocrPreviews, setOcrPreviews] = useState<string[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrData, setOcrData] = useState<FileData | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // --- CLEAN STATE ---
  const [cleanFiles, setCleanFiles] = useState<{ original: FileData, cleaned: FileData, removedCount: number }[]>([]);
  const [isCleanLoading, setIsCleanLoading] = useState(false);
  const [cleanStartRow, setCleanStartRow] = useState<number>(1);

  // --- TRANSFER STATE ---
  const [transferFile1, setTransferFile1] = useState<FileData | null>(null);
  const [transferFile2, setTransferFile2] = useState<FileData | null>(null);
  const [transferKey1, setTransferKey1] = useState<string>('');
  const [transferKey2, setTransferKey2] = useState<string>('');
  const [transferMapping, setTransferMapping] = useState<ColumnMapping>({});
  const [transferView, setTransferView] = useState<'upload' | 'config' | 'results'>('upload');
  const [transferResults, setTransferResults] = useState<RowData[]>([]);
  const [isTransferLoading, setIsTransferLoading] = useState(false);

  // --- SHEET SELECTION STATE ---
  const [pendingWorkbooks, setPendingWorkbooks] = useState<{
    file: File,
    workbook: XLSX.WorkBook | null,
    sheetNames: string[],
    selectedSheets: string[],
    isImage: boolean,
  }[]>([]);
  const [pendingTarget, setPendingTarget] = useState<'compare1' | 'compare2' | 'merge' | 'clean' | null>(null);

  // Initialize mapping when files are loaded or view changes to config
  useEffect(() => {
    if (view === 'config' && file1 && file2) {
      if (Object.keys(mapping).length > 0 || key1 || key2) return; // v1.1 enhancement: Prevent overwriting existing user-mapped configuration
      
      // Auto-guess mapping based on identical names
      const initialMapping: ColumnMapping = {};
      file1.columns?.forEach(col1 => {
        if (file2.columns?.includes(col1)) {
          initialMapping[col1] = col1;
        }
      });
      setMapping(initialMapping);
      
      // Auto-guess keys if "ID" or similar exists
      const commonId = file1.columns.find(c => /id/i.test(c) && file2.columns.includes(c));
      if (commonId) {
        setKey1(commonId);
        setKey2(commonId);
      }
    }
  }, [view, file1, file2]);

  // --- COMPARE HANDLERS ---
  const processFilesForSelection = async (files: File[], target: 'compare1' | 'compare2' | 'merge' | 'clean' | 'transfer1' | 'transfer2') => {
    setLoading(true);
    if (target === 'compare1') setProcessingSlot(1);
    if (target === 'compare2') setProcessingSlot(2);
    if (target === 'merge') setIsMergeLoading(true);
    if (target === 'clean') setIsCleanLoading(true);
    if (target === 'transfer1' || target === 'transfer2') setIsTransferLoading(true);

    try {
      const workbooks: any[] = [];
      let hasMultipleSheets = false;

      for (const file of files) {
        const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(file.name);
        if (isImage) {
          workbooks.push({
            file,
            isImage: true,
            workbook: null,
            sheetNames: ['Image Data'],
            selectedSheets: ['Image Data']
          });
        } else {
          const { workbook, sheetNames } = await readWorkbook(file);
          workbooks.push({
            file,
            workbook,
            sheetNames,
            selectedSheets: sheetNames.length > 0 ? [sheetNames[0]] : [],
            isImage: false
          });
          if (sheetNames.length > 1) {
            hasMultipleSheets = true;
          }
        }
      }

      const needsSelection = workbooks.some(wb => !wb.isImage && wb.sheetNames.length > 1);
      
      if (needsSelection) {
        setPendingWorkbooks(workbooks);
        setPendingTarget(target);
      } else {
        await executeImport(workbooks, target);
      }

    } catch (err: any) {
      alert(err.message || "Error reading files.");
    } finally {
      if (target === 'compare1' || target === 'compare2') {
        setLoading(false);
        setProcessingSlot(null);
      }
      if (target === 'merge') setIsMergeLoading(false);
      if (target === 'clean') setIsCleanLoading(false);
      if (target === 'transfer1' || target === 'transfer2') setIsTransferLoading(false);
    }
  };

  const executeImport = async (workbooks: any[], target: string) => {
    if (target === 'compare1' || target === 'compare2') setLoading(true);
    if (target === 'merge') setIsMergeLoading(true);
    if (target === 'clean') setIsCleanLoading(true);
    if (target === 'transfer1' || target === 'transfer2') setIsTransferLoading(true);

    try {
      const finalFileData: FileData[] = [];

      const imageFiles = workbooks.filter(wb => wb.isImage).map(wb => wb.file);
      if (imageFiles.length > 0) {
        const parsed = await extractDataFromImages(imageFiles);
        parsed.name = imageFiles.length === 1 ? `(IMG) ${imageFiles[0].name}` : `(IMG) ${imageFiles.length} Pages`;
        finalFileData.push(parsed);
      }

      for (const wb of workbooks) {
        if (!wb.isImage && wb.workbook) {
          const extracted = extractSheets(wb.workbook, wb.file.name, wb.selectedSheets);
          finalFileData.push(...extracted);
        }
      }

      if (target === 'compare1') {
        if (finalFileData.length > 0) setFile1(finalFileData[0]);
      } else if (target === 'compare2') {
        if (finalFileData.length > 0) setFile2(finalFileData[0]);
      } else if (target === 'merge') {
        setMergeFiles(prev => [...prev, ...finalFileData]);
      } else if (target === 'clean') {
        const newCleanFiles = finalFileData.map(parsed => {
          const { cleanedData, removedColumns } = cleanEmptyColumns(parsed, cleanStartRow - 1);
          return {
            original: parsed,
            cleaned: cleanedData,
            removedCount: removedColumns.length
          };
        });
        setCleanFiles(prev => [...prev, ...newCleanFiles]);
      } else if (target === 'transfer1') {
        if (finalFileData.length > 0) setTransferFile1(finalFileData[0]);
      } else if (target === 'transfer2') {
        if (finalFileData.length > 0) setTransferFile2(finalFileData[0]);
      }
    } catch (err: any) {
      alert(err.message || "Error importing files.");
    } finally {
      setLoading(false);
      setIsMergeLoading(false);
      setIsCleanLoading(false);
      setIsTransferLoading(false);
      setPendingWorkbooks([]);
      setPendingTarget(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, fileNum: 1 | 2) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files) as File[];
      const areAllImages = files.every(f => f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(f.name));
      if (!areAllImages && files.length > 1) {
        alert("Multiple files are only supported for images (to combine pages). Please select a single Excel/CSV file.");
        e.target.value = '';
        return;
      }
      await processFilesForSelection(files, fileNum === 1 ? 'compare1' : 'compare2');
      e.target.value = '';
    }
  };

  const handleCompare = () => {
    if (!file1 || !file2 || !key1 || !key2) return;
    
    // Validate that at least one column is mapped
    if (Object.keys(mapping).length === 0) {
      alert("Please map at least one column to compare.");
      return;
    }

    setLoading(true);
    // Tiny timeout to let UI show loading state
    setTimeout(() => {
      const result = compareDatasets(file1, file2, key1, key2, mapping, enableTolerance, enableFuzzyMatch);
      setSummary(result);
      setView('report');
      setLoading(false);
    }, 100);
  };

  const generateAiReport = async () => {
    if (!summary || !file1 || !file2) return;
    setIsAiLoading(true);
    const report = await analyzeComparison(summary, file1.name, file2.name);
    setAiReport(report);
    setIsAiLoading(false);
  };

  const handleExportCSV = () => {
    if (!summary || !file1) return;
    
    // When exporting, show File 1 values and File 2 values for mapped columns
    const flatData = summary.results.map(r => {
      const rowObj: any = {
        Status: r.status,
        Key: r.key,
        Differences: r.differences?.join(', ') || '',
        'Differences Description': r.differencesDescription || (r.status === ComparisonStatus.MISSING_IN_FILE_1 ? 'Row missing in File 1' : r.status === ComparisonStatus.MISSING_IN_FILE_2 ? 'Row missing in File 2' : ''),
      };

      // Add all File 1 data
      if (r.dataFile1) {
        Object.entries(r.dataFile1).forEach(([k, v]) => {
          rowObj[`File1_${k}`] = v;
        });
      }

      // Add all File 2 data
      if (r.dataFile2) {
        Object.entries(r.dataFile2).forEach(([k, v]) => {
          rowObj[`File2_${k}`] = v;
        });
      }

      return rowObj;
    });

    exportToCSV(flatData, 'comparison_report');
  };

  const handleExportExcel = () => {
    if (!summary || !file1) return;
    
    const flatData = summary.results.map(r => {
      const rowObj: any = {
        Status: r.status,
        Key: r.key,
        Differences: r.differences?.join(', ') || '',
        'Differences Description': r.differencesDescription || (r.status === ComparisonStatus.MISSING_IN_FILE_1 ? 'Row missing in File 1' : r.status === ComparisonStatus.MISSING_IN_FILE_2 ? 'Row missing in File 2' : ''),
      };

      if (r.dataFile1) {
        Object.entries(r.dataFile1).forEach(([k, v]) => rowObj[`File1_${k}`] = v);
      }
      if (r.dataFile2) {
        Object.entries(r.dataFile2).forEach(([k, v]) => rowObj[`File2_${k}`] = v);
      }

      return rowObj;
    });

    const datasets = [{ name: 'Comparison Data', rows: flatData }];
    
    if (aiReport) {
      const reportRows = aiReport.split('\n').map(line => ({ 'AI Insights': line }));
      datasets.push({ name: 'AI Insights', rows: reportRows });
    }

    exportToExcelMultipleSheets(datasets, 'Comparison_Report_With_Insights');
  };

  const reset = () => {
    setFile1(null);
    setFile2(null);
    setSummary(null);
    setKey1('');
    setKey2('');
    setMapping({});
    setAiReport(null);
    setView('upload');
  };

  const updateMapping = (col1: string, col2: string) => {
    setMapping(prev => {
      const next = { ...prev };
      if (col2 === '__IGNORE__') {
        delete next[col1];
      } else {
        next[col1] = col2;
      }
      return next;
    });
  };

  // --- TRANSFER HANDLERS ---
  const handleTransferUpload = async (e: React.ChangeEvent<HTMLInputElement>, fileNum: 1 | 2) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files) as File[];
      await processFilesForSelection(files, fileNum === 1 ? 'transfer1' : 'transfer2');
      e.target.value = '';
    }
  };

  const updateTransferMapping = (col1: string, col2: string) => {
    setTransferMapping(prev => {
      const next = { ...prev };
      if (col2 === '__IGNORE__') {
        delete next[col1];
      } else {
        next[col1] = col2;
      }
      return next;
    });
  };

  const handleTransfer = () => {
    if (!transferFile1 || !transferFile2) return;
    
    if (Object.keys(transferMapping).length === 0) {
      alert("Please map at least one column to transfer.");
      return;
    }

    setIsTransferLoading(true);
    setTimeout(() => {
      try {
        let newRows: RowData[] = [];
        
        // If keys are provided, we do an update/upsert
        if (transferKey1 && transferKey2) {
          // Create a map of File 2 rows for quick lookup
          const file2Map = new Map<string, RowData>();
          transferFile2.rows?.forEach(row => {
            const keyVal = String(row[transferKey2] || '').trim();
            if (keyVal) file2Map.set(keyVal, { ...row });
          });

          // Iterate over File 1 rows
          transferFile1.rows?.forEach(row1 => {
            const keyVal1 = String(row1[transferKey1] || '').trim();
            if (!keyVal1) return; // Skip rows without a key

            let targetRow = file2Map.get(keyVal1);
            if (!targetRow) {
              // If not found in File 2, create a new row with File 2's structure
              targetRow = {};
              transferFile2.columns?.forEach(col => targetRow![col] = '');
              targetRow[transferKey2] = keyVal1;
              file2Map.set(keyVal1, targetRow);
            }

            // Update mapped columns
            Object.entries(transferMapping).forEach(([col1, col2]) => {
              targetRow![col2 as string] = row1[col1];
            });
          });

          // Convert map back to array
          newRows = Array.from(file2Map.values());
        } else {
          // No keys provided: just transform File 1 rows into File 2 structure
          transferFile1.rows?.forEach(row1 => {
            const newRow: RowData = {};
            // Initialize with empty strings for all File 2 columns
            transferFile2.columns?.forEach(col => newRow[col] = '');
            
            // Apply mapping
            Object.entries(transferMapping).forEach(([col1, col2]) => {
              newRow[col2 as string] = row1[col1];
            });
            newRows.push(newRow);
          });
        }

        setTransferResults(newRows);
        setTransferView('results');
      } catch (err: any) {
        alert("Error during transfer: " + err.message);
      } finally {
        setIsTransferLoading(false);
      }
    }, 100);
  };

  const handleTransferDownload = () => {
    if (transferResults.length === 0 || !transferFile2) return;
    const dataset = [{ name: 'Mapped Data', rows: transferResults }];
    exportToExcelMultipleSheets(dataset, 'Mapped_Data');
  };

  const resetTransfer = () => {
    setTransferFile1(null);
    setTransferFile2(null);
    setTransferKey1('');
    setTransferKey2('');
    setTransferMapping({});
    setTransferResults([]);
    setTransferView('upload');
  };

  // --- MERGE HANDLERS ---
  const handleMergeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files) as File[];
      await processFilesForSelection(files, 'merge');
      e.target.value = '';
    }
  };

  const removeMergeFile = (index: number) => {
    setMergeFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleMergeDownload = () => {
    if (mergeFiles.length === 0) return;
    
    if (mergeIntoSingleSheet) {
      exportToExcelSingleSheet(mergeFiles, 'Merged_Dataset_Single_Sheet');
    } else {
      const datasets = mergeFiles.map(f => ({ name: f.name, rows: f.rows }));
      exportToExcelMultipleSheets(datasets, 'Merged_Workbook_Separate_Sheets');
    }
  };

  const moveColumn = (fileIndex: number, fromIndex: number, toIndex: number) => {
    setMergeFiles(prev => {
      const newFiles = [...prev];
      const file = { ...newFiles[fileIndex] };
      const newColumns = [...file.columns];
      const [moved] = newColumns.splice(fromIndex, 1);
      newColumns.splice(toIndex, 0, moved);
      file.columns = newColumns;
      newFiles[fileIndex] = file;
      return newFiles;
    });
  };

  const handleDragStart = (e: React.DragEvent, fileIdx: number, colIdx: number) => {
    setDraggedCol({ fileIdx, colIdx });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetFileIdx: number, targetColIdx: number) => {
    e.preventDefault();
    if (!draggedCol) return;
    if (draggedCol.fileIdx !== targetFileIdx) return;
    if (draggedCol.colIdx === targetColIdx) return;
    
    moveColumn(targetFileIdx, draggedCol.colIdx, targetColIdx);
    setDraggedCol(null);
  };

  const handleManualPositionChange = (fileIdx: number, colIdx: number, newPosStr: string) => {
    const newPos = parseInt(newPosStr, 10) - 1; // Convert to 0-indexed
    if (isNaN(newPos)) return;
    
    // Clamp to valid range
    const file = mergeFiles[fileIdx];
    const maxIdx = file.columns.length - 1;
    const targetIdx = Math.max(0, Math.min(newPos, maxIdx));
    
    if (targetIdx !== colIdx) {
      moveColumn(fileIdx, colIdx, targetIdx);
    }
  };

  const matchFileOrder = (targetFileIdx: number) => {
    if (mergeFiles.length === 0) return;
    
    setMergeFiles(prev => {
      const newFiles = [...prev];
      const referenceColumns = newFiles[0].columns;
      const targetFile = { ...newFiles[targetFileIdx] };
      
      const newColumns = [...targetFile.columns].sort((a, b) => {
        const idxA = referenceColumns.indexOf(a);
        const idxB = referenceColumns.indexOf(b);
        
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return 0; 
      });
      
      targetFile.columns = newColumns;
      newFiles[targetFileIdx] = targetFile;
      return newFiles;
    });
  };

  const handleRenameColumn = (fileIdx: number, colIdx: number, newName: string) => {
    if (!newName.trim()) {
      setEditingCol(null);
      return;
    }
    
    setMergeFiles(prev => {
      const newFiles = [...prev];
      const file = { ...newFiles[fileIdx] };
      const oldName = file.columns[colIdx];
      
      if (oldName === newName) return prev;
      
      if (file.columns.includes(newName)) {
        alert('Column name already exists in this file.');
        return prev;
      }
      
      const newColumns = [...file.columns];
      newColumns[colIdx] = newName;
      file.columns = newColumns;
      
      file.rows = file.rows.map(row => {
        const newRow = { ...row };
        if (oldName in newRow) {
          newRow[newName] = newRow[oldName];
          delete newRow[oldName];
        }
        return newRow;
      });
      
      newFiles[fileIdx] = file;
      return newFiles;
    });
    
    setEditingCol(null);
    setEditingColName('');
  };

  const handleDeleteColumn = (fileIdx: number, colIdx: number) => {
    setMergeFiles(prev => {
      const newFiles = [...prev];
      const file = { ...newFiles[fileIdx] };
      const colName = file.columns[colIdx];
      
      const newColumns = [...file.columns];
      newColumns.splice(colIdx, 1);
      file.columns = newColumns;
      
      file.rows = file.rows.map(row => {
        const newRow = { ...row };
        delete newRow[colName];
        return newRow;
      });
      
      newFiles[fileIdx] = file;
      return newFiles;
    });
  };

  const getMergeStructureAnalysis = () => {
    if (mergeFiles.length < 2) return null;
    
    const allColumns = new Set<string>();
    mergeFiles.forEach(f => f.columns?.forEach(c => allColumns.add(c)));
    
    const columnsArray = Array.from(allColumns).sort();
    
    const isIdenticalSet = mergeFiles.every(f => 
      f.columns.length === columnsArray.length && 
      f.columns.every(c => allColumns.has(c))
    );

    const firstFileColumns = mergeFiles[0].columns;
    const isIdenticalOrder = isIdenticalSet && mergeFiles.every(f => 
      f.columns.length === firstFileColumns.length &&
      f.columns.every((c, i) => c === firstFileColumns[i])
    );

    return {
      isIdenticalSet,
      isIdenticalOrder,
      allColumns: columnsArray,
      files: mergeFiles.map(f => ({
        name: f.name,
        columns: new Set(f.columns),
        columnsArray: f.columns
      }))
    };
  };

  const handleExportStructureReport = () => {
    const analysis = getMergeStructureAnalysis();
    if (!analysis) return;

    const reportData: any[] = [];
    
    // Add summary
    const summaryRow = { 'Column Name': '--- OVERALL STATUS ---' };
    analysis.files?.forEach(f => {
      summaryRow[f.name] = analysis.isIdenticalOrder 
        ? 'Identical Headers & Order' 
        : analysis.isIdenticalSet 
          ? 'Same Headers, Different Order' 
          : 'Header Mismatch';
    });
    reportData.push(summaryRow);

    const emptyRow = { 'Column Name': '' };
    analysis.files?.forEach(f => { emptyRow[f.name] = ''; });
    reportData.push(emptyRow);

    const columnsHeaderRow = { 'Column Name': '--- COLUMNS ---' };
    analysis.files?.forEach(f => { columnsHeaderRow[f.name] = ''; });
    reportData.push(columnsHeaderRow);

    // Add columns
    analysis.allColumns?.forEach(col => {
      const row: any = { 'Column Name': col };
      analysis.files?.forEach(f => {
        const colIndex = f.columnsArray.indexOf(col);
        row[f.name] = colIndex !== -1 ? `Present (Pos: ${colIndex + 1})` : 'Missing';
      });
      reportData.push(row);
    });

    exportToCSV(reportData, 'Structure_Analysis_Report');
  };

  // --- OCR HANDLERS ---
  const handleOcrUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files) as File[];
      const newPreviews = files.map(file => URL.createObjectURL(file)); 
      
      setOcrImages(prev => [...prev, ...files]);
      setOcrPreviews(prev => [...prev, ...newPreviews]);
      setOcrData(null); // Reset previous data if new images are added
      setOcrError(null);
    }
  };

  const removeOcrImage = (index: number) => {
    URL.revokeObjectURL(ocrPreviews[index]);
    setOcrImages(prev => prev.filter((_, i) => i !== index));
    setOcrPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const clearOcrImages = () => {
    ocrPreviews?.forEach(url => URL.revokeObjectURL(url));
    setOcrImages([]);
    setOcrPreviews([]);
    setOcrData(null);
    setOcrError(null);
  };

  const handleRunOcr = async () => {
    if (ocrImages.length === 0) return;
    setOcrLoading(true);
    setOcrError(null);
    try {
      const extractedData = await extractDataFromImages(ocrImages);
      setOcrData(extractedData);
    } catch (err: any) {
      setOcrError(err.message || "Failed to extract data.");
    } finally {
      setOcrLoading(false);
    }
  };

  // Editable Table Handlers
  const handleOcrCellChange = (rowIndex: number, col: string, value: string) => {
    if (!ocrData) return;
    const newRows = [...ocrData.rows];
    newRows[rowIndex] = { ...newRows[rowIndex], [col]: value };
    setOcrData({ ...ocrData, rows: newRows });
  };

  const handleOcrDeleteRow = (rowIndex: number) => {
    if (!ocrData) return;
    const newRows = ocrData.rows.filter((_, i) => i !== rowIndex);
    setOcrData({ ...ocrData, rows: newRows });
  };

  const handleOcrAddRow = () => {
    if (!ocrData) return;
    const newRow: any = {};
    ocrData.columns?.forEach(col => newRow[col] = "");
    setOcrData({ ...ocrData, rows: [...ocrData.rows, newRow] });
  };

  const sendToCompare = (slot: 1 | 2) => {
    if (!ocrData) return;
    
    if (slot === 1) {
      setFile1(ocrData);
    } else {
      setFile2(ocrData);
    }
    setActiveTab('compare');
    setView('upload');
  };

  const downloadOcrExcel = () => {
    if (!ocrData) return;
    exportToExcelSingleSheet([ocrData], `OCR_Extracted_${Date.now()}`);
  };

  // --- CLEAN HANDLERS ---
  const handleCleanStartRowChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    const newStartRow = isNaN(val) || val < 1 ? 1 : val;
    setCleanStartRow(newStartRow);
    
    if (cleanFiles.length > 0) {
      const reCleaned = cleanFiles.map(f => {
        const { cleanedData, removedColumns } = cleanEmptyColumns(f.original, newStartRow - 1);
        return {
          original: f.original,
          cleaned: cleanedData,
          removedCount: removedColumns.length
        };
      });
      setCleanFiles(reCleaned);
    }
  };

  const handleCleanUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files) as File[];
      await processFilesForSelection(files, 'clean');
      e.target.value = '';
    }
  };

  const removeCleanFile = (index: number) => {
    setCleanFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleCleanDownload = () => {
    if (cleanFiles.length === 0) return;
    const datasets = cleanFiles.map(f => ({ name: f.cleaned.name, rows: f.cleaned.rows }));
    exportToExcelMultipleSheets(datasets, 'Cleaned_Workbook');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={reset}>
            <div className="w-10 h-10 bg-brand-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-brand-500/30">
              <ArrowRightLeft size={20} strokeWidth={2.5} />
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-brand-700 to-brand-500">
              ExcelDiff AI
            </span>
          </div>
          
          <nav className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg">
             <button
                onClick={() => setActiveTab('compare')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'compare' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
             >
               Compare Files
             </button>
             <button
                onClick={() => setActiveTab('merge')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'merge' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
             >
               Merge Files
             </button>
             <button
                onClick={() => setActiveTab('ocr')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'ocr' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
             >
               <ScanLine size={16} />
               <span>Image to Excel</span>
             </button>
             <button
                onClick={() => setActiveTab('clean')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'clean' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
             >
               <Eraser size={16} />
               <span>Remove Blanks</span>
             </button>
             <button
                onClick={() => setActiveTab('transfer')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'transfer' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
             >
               <ArrowRightLeft size={16} />
               <span>Mapping</span>
             </button>
             <button
                onClick={() => setActiveTab('splitter')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'splitter' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
             >
               <Layers size={16} />
               <span>Separator</span>
             </button>
             <button
                onClick={() => setActiveTab('convert')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'convert' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
             >
               <Settings2 size={16} />
               <span>Replace & Convert</span>
             </button>
             <button
                onClick={() => setActiveTab('check')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'check' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
             >
               <ShieldCheck size={16} />
               <span>Check Blanks</span>
             </button>
          </nav>

          <div className="flex items-center space-x-4">
             {activeTab === 'compare' && view === 'report' && (
                <button 
                  onClick={reset}
                  className="text-sm font-medium text-slate-500 hover:text-brand-600 transition-colors"
                >
                  Start Over
                </button>
             )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        
        {/* --- COMPARE TAB CONTENT --- */}
        {activeTab === 'compare' && (
          <>
            {/* Step 1: Upload */}
            {view === 'upload' && (
              <div className="max-w-4xl mx-auto space-y-12 animate-fade-in">
                <div className="text-center space-y-4">
                  <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Compare Data Sets Instantly</h1>
                  <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                    Upload Excel, CSV, or <span className="text-brand-600 font-bold">Images</span>. 
                    We automatically extract tables from images for comparison.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* File 1 Upload */}
                  <div className={`
                    relative group border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-300
                    ${file1 ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'}
                  `}>
                     {!file1 ? (
                        <>
                          {processingSlot === 1 ? (
                             <div className="flex flex-col items-center justify-center space-y-4 h-full min-h-[140px]">
                                <Loader2 className="animate-spin text-brand-600" size={40} />
                                <p className="text-brand-700 font-medium animate-pulse">
                                  Analyzing Document with Gemini 3 Pro...
                                </p>
                             </div>
                          ) : (
                            <>
                              <input 
                                type="file" 
                                accept=".csv, .xlsx, .xls, image/*" 
                                multiple
                                onChange={(e) => handleFileUpload(e, 1)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              />
                              <div className="space-y-4 pointer-events-none">
                                <div className="w-16 h-16 mx-auto bg-slate-100 text-slate-400 rounded-full flex items-center justify-center group-hover:bg-brand-50 group-hover:text-brand-500 transition-colors">
                                  <FileType size={32} />
                                </div>
                                <div>
                                  <h3 className="text-lg font-semibold text-slate-900">Source File 1</h3>
                                  <p className="text-sm text-slate-500 mt-1">Excel, CSV, or Images (Multiple allowed)</p>
                                </div>
                              </div>
                            </>
                          )}
                        </>
                     ) : (
                        <div className="space-y-4 relative">
                           <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center ${file1.name.includes('(IMG)') ? 'bg-purple-100 text-purple-600' : 'bg-brand-100 text-brand-600'}`}>
                              {file1.name.includes('(IMG)') ? <ScanLine size={32} /> : <FileSpreadsheet size={32} />}
                           </div>
                           <div>
                              <h3 className="text-lg font-semibold text-slate-900 truncate px-4">{file1.name}</h3>
                              <p className="text-sm text-slate-500 mt-1">{file1.rows.length} rows loaded</p>
                           </div>
                           <button 
                             onClick={() => setFile1(null)} 
                             className="absolute -top-6 -right-6 text-slate-400 hover:text-red-500 p-2"
                           >
                              <XCircle size={24} />
                           </button>
                           <div className="absolute top-0 right-0 text-brand-600"><CheckCircle2 size={24} fill="currentColor" className="text-white" /></div>
                        </div>
                     )}
                  </div>

                  {/* File 2 Upload */}
                  <div className={`
                    relative group border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-300
                    ${file2 ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'}
                  `}>
                     {!file2 ? (
                        <>
                          {processingSlot === 2 ? (
                             <div className="flex flex-col items-center justify-center space-y-4 h-full min-h-[140px]">
                                <Loader2 className="animate-spin text-brand-600" size={40} />
                                <p className="text-brand-700 font-medium animate-pulse">
                                  Analyzing Document with Gemini 3 Pro...
                                </p>
                             </div>
                          ) : (
                            <>
                              <input 
                                type="file" 
                                accept=".csv, .xlsx, .xls, image/*"
                                multiple
                                onChange={(e) => handleFileUpload(e, 2)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              />
                              <div className="space-y-4 pointer-events-none">
                                <div className="w-16 h-16 mx-auto bg-slate-100 text-slate-400 rounded-full flex items-center justify-center group-hover:bg-brand-50 group-hover:text-brand-500 transition-colors">
                                  <FileType size={32} />
                                </div>
                                <div>
                                  <h3 className="text-lg font-semibold text-slate-900">Source File 2</h3>
                                  <p className="text-sm text-slate-500 mt-1">Excel, CSV, or Images (Multiple allowed)</p>
                                </div>
                              </div>
                            </>
                          )}
                        </>
                     ) : (
                        <div className="space-y-4 relative">
                           <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center ${file2.name.includes('(IMG)') ? 'bg-purple-100 text-purple-600' : 'bg-brand-100 text-brand-600'}`}>
                              {file2.name.includes('(IMG)') ? <ScanLine size={32} /> : <FileSpreadsheet size={32} />}
                           </div>
                           <div>
                              <h3 className="text-lg font-semibold text-slate-900 truncate px-4">{file2.name}</h3>
                              <p className="text-sm text-slate-500 mt-1">{file2.rows.length} rows loaded</p>
                           </div>
                           <button 
                             onClick={() => setFile2(null)} 
                             className="absolute -top-6 -right-6 text-slate-400 hover:text-red-500 p-2"
                           >
                              <XCircle size={24} />
                           </button>
                           <div className="absolute top-0 right-0 text-brand-600"><CheckCircle2 size={24} fill="currentColor" className="text-white" /></div>
                        </div>
                     )}
                  </div>
                </div>

                <div className="flex justify-center">
                  <button
                    disabled={!file1 || !file2 || loading}
                    onClick={() => setView('config')}
                    className={`
                      flex items-center space-x-2 px-8 py-4 rounded-full font-bold text-lg shadow-xl transition-all
                      ${(!file1 || !file2) 
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                        : 'bg-brand-600 text-white hover:bg-brand-700 hover:scale-105 shadow-brand-500/30'
                      }
                    `}
                  >
                    <span>Continue to Configuration</span>
                    <ArrowRightLeft size={20} />
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Configuration */}
            {view === 'config' && file1 && file2 && (
              <div className="max-w-4xl mx-auto space-y-8 animate-fade-in-up">
                <div className="text-center">
                  <h2 className="text-2xl font-bold text-slate-900">Configure Comparison</h2>
                  <p className="text-slate-600 mt-2">Define how the files should be matched and compared.</p>
                </div>
                
                <div className="flex items-center justify-center space-x-2 text-sm text-green-700 bg-green-50 border border-green-200 px-4 py-2 rounded-full mx-auto w-fit shadow-sm">
                  <ShieldCheck size={16} />
                  <span className="font-medium">Smart Numeric Matching Active (Handles 1.23E+5 ≈ 123000)</span>
                </div>

                {/* Unique Identifier Section */}
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
                  <div className="flex items-center space-x-3 mb-2">
                    <Settings2 className="text-brand-600" size={24} />
                    <h3 className="text-lg font-semibold text-slate-900">1. Row Alignment (Primary Keys)</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Key Column in {file1.name}</label>
                      <select 
                        value={key1}
                        onChange={(e) => setKey1(e.target.value)}
                        className="block w-full pl-3 pr-10 py-3 text-base border-slate-300 focus:outline-none focus:ring-brand-500 focus:border-brand-500 sm:text-sm rounded-lg border bg-slate-50"
                      >
                        <option value="" disabled>Select column...</option>
                        {file1.columns.map(col => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Key Column in {file2.name}</label>
                      <select 
                        value={key2}
                        onChange={(e) => setKey2(e.target.value)}
                        className="block w-full pl-3 pr-10 py-3 text-base border-slate-300 focus:outline-none focus:ring-brand-500 focus:border-brand-500 sm:text-sm rounded-lg border bg-slate-50"
                      >
                        <option value="" disabled>Select column...</option>
                        {file2.columns.map(col => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-lg flex items-start space-x-3 text-sm text-blue-700">
                    <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                    <p>These columns are used to match rows between files (e.g., ID, SKU, Email). They should contain unique values.</p>
                  </div>
                </div>

                {/* Column Mapping Section */}
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-3">
                      <Link className="text-brand-600" size={24} />
                      <h3 className="text-lg font-semibold text-slate-900">2. Column Mapping</h3>
                    </div>
                    <button 
                      onClick={() => setMapping({})}
                      className="text-sm text-slate-500 hover:text-red-600 font-medium"
                    >
                      Clear All
                    </button>
                  </div>
                  
                  <div className="overflow-hidden border border-slate-200 rounded-lg">
                    <table className="min-w-full divide-y divide-slate-200">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider w-1/2">
                            Column in {file1.name}
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider w-1/2">
                            Map to {file2.name}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-slate-200">
                        {file1.columns.map(col1 => (
                          <tr key={col1} className={mapping[col1] ? 'bg-white' : 'bg-slate-50'}>
                            <td className="px-6 py-4 text-sm font-medium text-slate-900">
                              {col1}
                            </td>
                            <td className="px-6 py-2">
                              <select 
                                value={mapping[col1] || '__IGNORE__'}
                                onChange={(e) => updateMapping(col1, e.target.value)}
                                className={`block w-full pl-3 pr-10 py-2 text-sm focus:outline-none sm:text-sm rounded-md border 
                                  ${mapping[col1] 
                                    ? 'border-brand-300 ring-1 ring-brand-500 text-brand-900' 
                                    : 'border-slate-300 text-slate-500'}`}
                              >
                                <option value="__IGNORE__">-- Ignore Column --</option>
                                {file2.columns.map(col2 => {
                                  const isMappedElsewhere = Object.entries(mapping).some(([k, v]) => v === col2 && k !== col1);
                                  if (isMappedElsewhere) return null;
                                  return (
                                    <option key={col2} value={col2}>{col2}</option>
                                  );
                                })}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-sm text-slate-500 text-center">
                    Unmapped columns (set to "Ignore") will not be compared for discrepancies.
                  </p>
                </div>

                {/* Advanced Options Section */}
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
                  <div className="flex items-center space-x-3 mb-2">
                    <Settings2 className="text-brand-600" size={24} />
                    <h3 className="text-lg font-semibold text-slate-900">3. Advanced Options</h3>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div>
                      <h4 className="font-semibold text-slate-800">Decimal Tolerance (التقريب لأقرب رقم عشري)</h4>
                      <p className="text-sm text-slate-500 mt-1">
                        Allow minor decimal differences to be considered a match (e.g., 10.01 vs 10.04).
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={enableTolerance}
                        onChange={() => setEnableTolerance(!enableTolerance)}
                      />
                      <div className="w-14 h-7 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-brand-600"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div>
                      <h4 className="font-semibold text-slate-800">Fuzzy Match for Names (مطابقة تقريبية للأسماء)</h4>
                      <p className="text-sm text-slate-500 mt-1">
                        Allow minor spelling differences in text to be considered a match (e.g., "Ahmad" vs "Ahmed").
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={enableFuzzyMatch}
                        onChange={() => setEnableFuzzyMatch(!enableFuzzyMatch)}
                      />
                      <div className="w-14 h-7 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-brand-600"></div>
                    </label>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-center space-x-4">
                  <button
                    onClick={() => setView('upload')}
                    className="px-6 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    disabled={!key1 || !key2 || Object.keys(mapping).length === 0 || loading}
                    onClick={handleCompare}
                    className={`
                      flex items-center space-x-2 px-8 py-3 rounded-xl font-bold text-lg shadow-lg transition-all
                      ${(!key1 || !key2 || Object.keys(mapping).length === 0 || loading)
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                        : 'bg-brand-600 text-white hover:bg-brand-700 hover:scale-105'
                      }
                    `}
                  >
                    {loading ? <span>Processing...</span> : <span>Run Comparison</span>}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Report */}
            {view === 'report' && summary && (
              <div className="space-y-8 animate-fade-in">
                {/* Action Bar */}
                <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                  <h2 className="text-xl font-bold text-slate-900 mb-4 sm:mb-0">Comparison Report</h2>
                  <div className="flex space-x-3">
                    <button 
                      onClick={() => setView('config')}
                      className="flex items-center space-x-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors shadow-sm"
                    >
                      <span>Back to Configuration</span>
                    </button>
                    <button 
                      onClick={generateAiReport}
                      disabled={isAiLoading || !!aiReport}
                      className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors border ${aiReport ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
                    >
                      <Bot size={18} className={aiReport ? 'text-green-600' : 'text-purple-600'} />
                      <span>{isAiLoading ? 'Analyzing...' : aiReport ? 'Analysis Ready' : 'Ask AI Analysis'}</span>
                    </button>
                    <button 
                      onClick={handleExportCSV}
                      className="flex items-center space-x-2 px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg font-medium hover:bg-slate-50 transition-colors shadow-sm"
                    >
                      <Download size={18} />
                      <span>Export CSV</span>
                    </button>
                    <button 
                      onClick={handleExportExcel}
                      className="flex items-center space-x-2 px-4 py-2 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors shadow-brand-500/20 shadow-lg"
                    >
                      <FileSpreadsheet size={18} />
                      <span>Export Excel {aiReport && '(with Insights)'}</span>
                    </button>
                  </div>
                </div>

                {/* AI Report Section */}
                {aiReport && (
                  <div className="bg-gradient-to-br from-purple-50 to-white p-6 rounded-xl border border-purple-100 shadow-sm animate-fade-in-up">
                    <div className="flex items-center space-x-2 mb-4">
                      <Bot className="text-purple-600" size={24} />
                      <h3 className="text-lg font-bold text-slate-900">Gemini Executive Summary</h3>
                    </div>
                    <div className="prose prose-sm max-w-none text-slate-700">
                      <pre className="whitespace-pre-wrap font-sans">{aiReport}</pre>
                    </div>
                  </div>
                )}

                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col items-center justify-center">
                    <span className="text-slate-500 font-medium text-sm uppercase tracking-wider mb-1">Total Rows</span>
                    <span className="text-3xl font-bold text-slate-900">{summary.totalRows}</span>
                  </div>
                  <div className="bg-green-50 p-6 rounded-xl shadow-sm border border-green-100 flex flex-col items-center justify-center">
                    <span className="text-green-600 font-medium text-sm uppercase tracking-wider mb-1">Matches</span>
                    <span className="text-3xl font-bold text-green-700">{summary.matches}</span>
                  </div>
                  <div className="bg-yellow-50 p-6 rounded-xl shadow-sm border border-yellow-100 flex flex-col items-center justify-center">
                    <span className="text-yellow-600 font-medium text-sm uppercase tracking-wider mb-1">Mismatches</span>
                    <span className="text-3xl font-bold text-yellow-700">{summary.mismatches}</span>
                  </div>
                  <div className="bg-red-50 p-6 rounded-xl shadow-sm border border-red-100 flex flex-col items-center justify-center">
                    <span className="text-red-600 font-medium text-sm uppercase tracking-wider mb-1">Discrepancies</span>
                    <span className="text-3xl font-bold text-red-700">{summary.missingIn1 + summary.missingIn2}</span>
                  </div>
                </div>

                {/* Charts */}
                <ComparisonChart summary={summary} />

                {/* Detailed Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-semibold text-slate-800">Detailed Comparison (First 100 rows)</h3>
                    <span className="text-xs text-slate-500">Showing limited view for performance. Export for full details.</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Key ({key1})</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Differences</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Differences Description</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-slate-200 text-sm">
                        {summary.results.slice(0, 100).map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                                ${row.status === ComparisonStatus.MATCH ? 'bg-green-100 text-green-800' : 
                                  row.status === ComparisonStatus.MISMATCH ? 'bg-yellow-100 text-yellow-800' : 
                                  'bg-red-100 text-red-800'}`}>
                                {row.status.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-slate-700 font-medium">
                              {row.key}
                            </td>
                            <td className="px-6 py-4">
                              {row.status === ComparisonStatus.MATCH && <span className="text-slate-400 italic">Identical</span>}
                              {row.status === ComparisonStatus.MISMATCH && (
                                <div className="space-y-1">
                                  {row.differences?.map(diff => (
                                    <div key={diff} className="text-xs">
                                      <span className="font-bold text-slate-600">{diff}:</span> 
                                      <span className="text-red-500 line-through mx-1">{String(row.dataFile1?.[diff])}</span> 
                                      <ArrowRightLeft size={10} className="inline text-slate-400" />
                                      <span className="text-green-600 mx-1">
                                        {/* Find the mapped column to show the correct value from File 2 */}
                                        {String(row.dataFile2?.[mapping[diff] || diff])}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {(row.status === ComparisonStatus.MISSING_IN_FILE_1 || row.status === ComparisonStatus.MISSING_IN_FILE_2) && (
                                  <span className="text-slate-500 text-xs">Row missing in {row.status === ComparisonStatus.MISSING_IN_FILE_1 ? 'File 1' : 'File 2'}</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-slate-600 text-xs">
                              {row.differencesDescription || (row.status === ComparisonStatus.MISSING_IN_FILE_1 ? 'Row missing in File 1' : row.status === ComparisonStatus.MISSING_IN_FILE_2 ? 'Row missing in File 2' : '')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* --- MERGE TAB CONTENT --- */}
        {activeTab === 'merge' && (
           <div className="max-w-4xl mx-auto space-y-12 animate-fade-in">
              <div className="text-center space-y-4">
                <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Merge Multiple Files</h1>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  Combine multiple Excel or CSV files into a single Excel workbook.
                </p>
              </div>

              {/* Multi-File Upload Box */}
              <div className="relative group border-2 border-dashed border-slate-300 rounded-2xl p-10 text-center transition-all duration-300 hover:border-brand-400 hover:bg-slate-50 bg-white">
                <input 
                  type="file" 
                  accept=".csv, .xlsx, .xls"
                  multiple
                  onChange={handleMergeUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="space-y-4 pointer-events-none">
                  <div className="w-16 h-16 mx-auto bg-slate-100 text-slate-400 rounded-full flex items-center justify-center group-hover:bg-brand-50 group-hover:text-brand-500 transition-colors">
                    <Layers size={32} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {isMergeLoading ? "Processing..." : "Drop files here or click to upload"}
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Supports .xlsx, .xls, .csv
                    </p>
                  </div>
                </div>
              </div>

              {/* Merge Tabs */}
              {mergeFiles.length > 0 && (
                <div className="flex justify-center mb-6">
                  <div className="bg-slate-100 p-1 rounded-lg inline-flex">
                    <button
                      onClick={() => setMergeTab('files')}
                      className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${mergeTab === 'files' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Files & Merge
                    </button>
                    <button
                      onClick={() => setMergeTab('structure')}
                      className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${mergeTab === 'structure' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Check Structure
                    </button>
                  </div>
                </div>
              )}

              {/* File List */}
              {mergeFiles.length > 0 && mergeTab === 'files' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                     <h3 className="text-lg font-semibold text-slate-800">Selected Files ({mergeFiles.length})</h3>
                     <button onClick={() => setMergeFiles([])} className="text-sm text-red-500 hover:text-red-700">Clear All</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {mergeFiles.map((file, idx) => (
                      <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between shadow-sm">
                        <div className="flex items-center space-x-3 overflow-hidden">
                          <div className="w-10 h-10 bg-brand-50 text-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
                             <FileSpreadsheet size={20} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{file.name}</p>
                            <p className="text-xs text-slate-500">{file.rows.length} rows</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => removeMergeFile(idx)}
                          className="text-slate-400 hover:text-red-500 transition-colors p-1"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                  
                  {/* Merge Options */}
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center space-x-3 mt-6">
                    <button 
                      onClick={() => setMergeIntoSingleSheet(!mergeIntoSingleSheet)}
                      className="flex-shrink-0 text-brand-600 focus:outline-none"
                    >
                      {mergeIntoSingleSheet ? <CheckSquare size={24} /> : <Square size={24} />}
                    </button>
                    <div>
                      <h4 className="font-semibold text-slate-900 cursor-pointer" onClick={() => setMergeIntoSingleSheet(!mergeIntoSingleSheet)}>Merge all into one sheet?</h4>
                      <p className="text-sm text-slate-600">
                        If selected, all rows will be stacked into a single "Merged_Data" sheet. 
                        A "Source_File" column will be added. Best if headers are similar.
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-center mt-8">
                    <button
                      onClick={handleMergeDownload}
                      className="flex items-center space-x-2 px-8 py-4 bg-brand-600 text-white rounded-full font-bold text-lg shadow-xl hover:bg-brand-700 hover:scale-105 transition-all shadow-brand-500/30"
                    >
                      <Download size={20} />
                      <span>{mergeIntoSingleSheet ? 'Merge & Download Single Sheet' : 'Merge & Download Workbook'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Check Structure Tab */}
              {mergeFiles.length > 0 && mergeTab === 'structure' && (
                <div className="space-y-6">
                  {mergeFiles.length < 2 ? (
                    <div className="text-center p-8 bg-slate-50 rounded-xl border border-slate-200">
                      <p className="text-slate-500">Please upload at least 2 files to check their structure.</p>
                    </div>
                  ) : (
                    (() => {
                      const analysis = getMergeStructureAnalysis();
                      if (!analysis) return null;
                      return (
                        <div className="space-y-6">
                          <div className={`p-4 rounded-xl border ${analysis.isIdenticalOrder ? 'bg-green-50 border-green-200' : analysis.isIdenticalSet ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-3">
                                {analysis.isIdenticalOrder ? (
                                  <CheckCircle2 className="text-green-500" size={24} />
                                ) : analysis.isIdenticalSet ? (
                                  <Info className="text-blue-500" size={24} />
                                ) : (
                                  <AlertCircle className="text-amber-500" size={24} />
                                )}
                                <div>
                                  <h4 className={`font-semibold ${analysis.isIdenticalOrder ? 'text-green-800' : analysis.isIdenticalSet ? 'text-blue-800' : 'text-amber-800'}`}>
                                    {analysis.isIdenticalOrder ? 'All files have identical headers and order!' : analysis.isIdenticalSet ? 'Same headers, but different order' : 'Header mismatch detected'}
                                  </h4>
                                  <p className={`text-sm ${analysis.isIdenticalOrder ? 'text-green-600' : analysis.isIdenticalSet ? 'text-blue-600' : 'text-amber-600'}`}>
                                    {analysis.isIdenticalOrder 
                                      ? 'You can safely merge these files into a single sheet.' 
                                      : analysis.isIdenticalSet
                                      ? 'The files have the exact same columns, but they are arranged in a different order. Merging will align them by column name.'
                                      : 'Some files are missing columns. Merging into a single sheet will result in empty cells for missing columns.'}
                                  </p>
                                </div>
                              </div>
                              <button
                                onClick={handleExportStructureReport}
                                className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                                  analysis.isIdenticalOrder 
                                    ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                                    : analysis.isIdenticalSet 
                                      ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' 
                                      : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                }`}
                              >
                                <Download size={16} />
                                <span>Export Report</span>
                              </button>
                            </div>
                          </div>

                          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                                  <tr>
                                    <th className="px-4 py-3 font-semibold min-w-[200px]">Column Name</th>
                                    {analysis.files.map((f, i) => (
                                      <th key={i} className="px-4 py-3 font-semibold text-center min-w-[150px] max-w-[300px] break-words" title={f.name}>
                                        {f.name}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {analysis.allColumns.map(col => {
                                    const isCommon = analysis.files.every(f => f.columns.has(col));
                                    return (
                                      <tr key={col} className={isCommon ? '' : 'bg-amber-50/30'}>
                                        <td className="px-4 py-3 font-medium text-slate-700 min-w-[200px] max-w-[300px] break-words">{col}</td>
                                        {analysis.files.map((f, i) => {
                                          const colIndex = f.columnsArray.indexOf(col);
                                          const hasCol = colIndex !== -1;
                                          return (
                                            <td key={i} className="px-4 py-3 text-center">
                                              {hasCol ? (
                                                <div className="flex flex-col items-center justify-center">
                                                  <CheckCircle2 className="text-green-500" size={18} />
                                                  <span className="text-[10px] text-slate-400 mt-0.5 font-medium">Pos: {colIndex + 1}</span>
                                                </div>
                                              ) : (
                                                <XCircle className="inline-block text-slate-300" size={18} />
                                              )}
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          {/* Reorder Columns Section */}
                          <div className="mt-8 pt-6 border-t border-slate-200">
                            <h3 className="text-lg font-semibold text-slate-800 mb-4">Edit Column Order</h3>
                            <p className="text-sm text-slate-600 mb-6">
                              Drag and drop columns, use the arrows, or type a number to reorder them. You can also edit names, hide/delete columns, or auto-match the order of the first file.
                            </p>
                            <div className="flex overflow-x-auto pb-6 gap-6 snap-x custom-scrollbar">
                              {mergeFiles.map((file, fileIdx) => (
                                <div key={fileIdx} className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col max-h-[500px] min-w-[350px] md:min-w-[450px] flex-shrink-0 snap-start">
                                  <h4 className="font-semibold text-slate-800 mb-3 pb-2 border-b border-slate-100 flex justify-between items-center" title={file.name}>
                                    <span className="truncate mr-2">{file.name}</span>
                                    {fileIdx > 0 && (
                                      <button 
                                        onClick={() => matchFileOrder(fileIdx)}
                                        className="text-xs flex items-center flex-shrink-0 text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-2 py-1 rounded transition-colors"
                                        title="Match order of the first file"
                                      >
                                        <Wand2 size={12} className="mr-1" />
                                        Match File 1
                                      </button>
                                    )}
                                  </h4>
                                  <div className="space-y-2 overflow-y-auto pr-2 flex-grow custom-scrollbar">
                                    {file.columns.map((col, colIdx) => (
                                      <div 
                                        key={col} 
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, fileIdx, colIdx)}
                                        onDragOver={handleDragOver}
                                        onDrop={(e) => handleDrop(e, fileIdx, colIdx)}
                                        className={`flex items-center justify-between bg-slate-50 border p-2 rounded-lg group hover:border-brand-200 transition-colors cursor-grab active:cursor-grabbing ${draggedCol?.fileIdx === fileIdx && draggedCol?.colIdx === colIdx ? 'opacity-50 border-dashed border-brand-400' : 'border-slate-100'}`}
                                      >
                                        <div className="flex items-center overflow-hidden mr-2">
                                          <GripVertical size={14} className="text-slate-300 mr-2 cursor-grab active:cursor-grabbing flex-shrink-0" />
                                          <div className="flex items-center mr-2 flex-shrink-0">
                                            <input
                                              type="number"
                                              min="1"
                                              max={file.columns.length}
                                              defaultValue={colIdx + 1}
                                              key={`${fileIdx}-${col}-${colIdx}`}
                                              onBlur={(e) => handleManualPositionChange(fileIdx, colIdx, e.target.value)}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  handleManualPositionChange(fileIdx, colIdx, e.currentTarget.value);
                                                  e.currentTarget.blur();
                                                }
                                              }}
                                              className="w-10 text-xs text-slate-600 border border-slate-200 rounded px-1 py-0.5 text-center focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                                              title="Type position and press Enter"
                                            />
                                          </div>
                                          {editingCol?.fileIdx === fileIdx && editingCol?.colIdx === colIdx ? (
                                            <input
                                              type="text"
                                              value={editingColName}
                                              onChange={(e) => setEditingColName(e.target.value)}
                                              onBlur={() => handleRenameColumn(fileIdx, colIdx, editingColName)}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  handleRenameColumn(fileIdx, colIdx, editingColName);
                                                } else if (e.key === 'Escape') {
                                                  setEditingCol(null);
                                                }
                                              }}
                                              autoFocus
                                              className="text-sm font-medium text-slate-700 border-b border-brand-500 focus:outline-none bg-transparent w-full"
                                            />
                                          ) : (
                                            <span className="text-sm font-medium text-slate-700 break-words line-clamp-2" title={col}>
                                              {col}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex items-center space-x-1 opacity-50 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                          <button 
                                            onClick={() => {
                                              setEditingCol({ fileIdx, colIdx });
                                              setEditingColName(col);
                                            }}
                                            className="p-1 text-slate-400 hover:text-brand-600 transition-colors rounded hover:bg-brand-50"
                                            title="Rename Column"
                                          >
                                            <Edit3 size={14} />
                                          </button>
                                          <button 
                                            onClick={() => handleDeleteColumn(fileIdx, colIdx)}
                                            className="p-1 text-slate-400 hover:text-red-600 transition-colors rounded hover:bg-red-50"
                                            title="Hide/Delete Column"
                                          >
                                            <EyeOff size={14} />
                                          </button>
                                          <div className="w-px h-4 bg-slate-200 mx-1"></div>
                                          <button 
                                            onClick={() => moveColumn(fileIdx, colIdx, colIdx - 1)}
                                            disabled={colIdx === 0}
                                            className="p-1 text-slate-400 hover:text-brand-600 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors rounded hover:bg-brand-50"
                                            title="Move Up"
                                          >
                                            <ChevronUp size={16} />
                                          </button>
                                          <button 
                                            onClick={() => moveColumn(fileIdx, colIdx, colIdx + 1)}
                                            disabled={colIdx === file.columns.length - 1}
                                            className="p-1 text-slate-400 hover:text-brand-600 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors rounded hover:bg-brand-50"
                                            title="Move Down"
                                          >
                                            <ChevronDown size={16} />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>
              )}
           </div>
        )}

        {/* --- OCR TAB CONTENT --- */}
        {activeTab === 'ocr' && (
          <div className="max-w-6xl mx-auto space-y-12 animate-fade-in">
            <div className="text-center space-y-4">
              <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Convert Images to Excel</h1>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                Upload multiple photos of documents, invoices, or lists. Our AI will combine them into a single dataset.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              {/* Left Column: Input */}
              <div className="space-y-6">
                {/* Drag Drop Zone */}
                <div className={`
                  relative group border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300
                  ${ocrImages.length > 0 ? 'border-brand-500 bg-white' : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'}
                  min-h-[200px] flex flex-col justify-center items-center overflow-hidden
                `}>
                  <input 
                    type="file" 
                    accept="image/*"
                    multiple
                    onChange={handleOcrUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  
                  <div className="space-y-4 pointer-events-none">
                    <div className="w-16 h-16 mx-auto bg-brand-50 text-brand-600 rounded-full flex items-center justify-center">
                      <ImageIcon size={32} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">Upload Images</h3>
                      <p className="text-sm text-slate-500 mt-1">PNG, JPG, WEBP • Multiple files allowed</p>
                    </div>
                  </div>
                </div>

                {/* Preview Grid */}
                {ocrImages.length > 0 && (
                   <div className="space-y-2">
                      <div className="flex justify-between items-center px-1">
                        <span className="text-sm font-medium text-slate-600">{ocrImages.length} images selected</span>
                        <button onClick={clearOcrImages} className="text-xs text-red-500 hover:text-red-700 font-medium">Clear All</button>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 max-h-60 overflow-y-auto">
                        {ocrPreviews.map((src, idx) => (
                           <div key={idx} className="relative group aspect-square bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                              <img src={src} alt={`Upload ${idx}`} className="w-full h-full object-cover" />
                              <button 
                                onClick={() => removeOcrImage(idx)}
                                className="absolute top-1 right-1 bg-white/90 text-slate-500 hover:text-red-600 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                              >
                                <XCircle size={16} />
                              </button>
                           </div>
                        ))}
                        {/* Add more placeholder */}
                        <div className="relative border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center hover:bg-white hover:border-brand-400 transition-colors aspect-square">
                           <input 
                              type="file" 
                              accept="image/*"
                              multiple
                              onChange={handleOcrUpload}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                           />
                           <Plus className="text-slate-400" size={24} />
                        </div>
                      </div>
                   </div>
                )}

                {ocrError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start space-x-3 text-red-700">
                     <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
                     <p className="text-sm">{ocrError}</p>
                  </div>
                )}

                <button
                  disabled={ocrImages.length === 0 || ocrLoading}
                  onClick={handleRunOcr}
                  className={`
                    w-full flex items-center justify-center space-x-2 px-6 py-4 rounded-xl font-bold text-lg shadow-lg transition-all
                    ${(ocrImages.length === 0 || ocrLoading)
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                      : 'bg-brand-600 text-white hover:bg-brand-700 hover:scale-105'
                    }
                  `}
                >
                  {ocrLoading ? (
                    <>
                       <Loader2 className="animate-spin" size={20} />
                       <span>Analyzing with Gemini Pro...</span>
                    </>
                  ) : (
                    <>
                       <ScanLine size={20} />
                       <span>Convert All to Data</span>
                    </>
                  )}
                </button>
              </div>

              {/* Right Column: Output */}
              <div className="bg-white border border-slate-200 rounded-2xl h-[600px] flex flex-col shadow-sm overflow-hidden">
                 <div className="bg-slate-50 border-b border-slate-200 p-4 flex justify-between items-center">
                    <div className="flex items-center space-x-2">
                       <h3 className="font-semibold text-slate-800">Extracted Data</h3>
                       {ocrData && <span className="text-xs text-green-600 font-medium bg-green-100 px-2 py-1 rounded-full">{ocrData.rows.length} rows</span>}
                    </div>
                    {ocrData && (
                      <div className="flex space-x-2">
                         <button 
                            onClick={handleOcrAddRow} 
                            className="text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-2 py-1 rounded flex items-center space-x-1"
                         >
                            <Plus size={12} />
                            <span>Add Row</span>
                         </button>
                      </div>
                    )}
                 </div>
                 
                 <div className="flex-1 overflow-auto p-0 bg-slate-50">
                    {ocrData ? (
                      <table className="min-w-full divide-y divide-slate-200 border-collapse">
                        <thead className="bg-white sticky top-0 z-10 shadow-sm">
                          <tr>
                            <th className="px-1 py-2 w-8 bg-slate-50 border-b border-r"></th>
                            {ocrData.columns.map((col, i) => (
                              <th key={i} className="px-4 py-2 text-left text-xs font-bold text-slate-600 uppercase tracking-wider whitespace-nowrap bg-slate-50 border-b border-r last:border-r-0">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                          {ocrData.rows.map((row, i) => (
                             <tr key={i} className="group hover:bg-slate-50">
                                <td className="px-1 py-2 w-8 text-center border-r bg-slate-50">
                                   <button 
                                      onClick={() => handleOcrDeleteRow(i)}
                                      className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Delete Row"
                                   >
                                      <Trash2 size={14} />
                                   </button>
                                </td>
                                {ocrData.columns.map((col, j) => (
                                  <td key={j} className="p-0 border-r last:border-r-0">
                                    <input 
                                      type="text" 
                                      value={row[col] || ''}
                                      onChange={(e) => handleOcrCellChange(i, col, e.target.value)}
                                      className="w-full px-4 py-2 text-xs text-slate-700 border-none focus:ring-2 focus:ring-brand-500 focus:bg-white bg-transparent outline-none"
                                    />
                                  </td>
                                ))}
                             </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                       <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3 p-8 text-center">
                          <div className="bg-slate-100 p-4 rounded-full mb-2">
                            <Bot size={40} className="text-slate-300" />
                          </div>
                          <p className="font-medium text-slate-600">No data extracted yet</p>
                          <p className="text-sm max-w-xs">Upload images and click "Convert". Results will appear here for you to review and edit.</p>
                       </div>
                    )}
                 </div>
              </div>
            </div>

            {/* Actions Area */}
            {ocrData && (
              <div className="bg-brand-50 border border-brand-100 rounded-xl p-8 animate-fade-in-up">
                 <h3 className="text-xl font-bold text-brand-900 mb-6 text-center">Data extracted! What's next?</h3>
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <button 
                      onClick={() => sendToCompare(1)}
                      className="flex items-center justify-center space-x-2 bg-white border border-brand-200 hover:border-brand-400 p-4 rounded-xl shadow-sm hover:shadow-md transition-all group"
                    >
                      <div className="bg-brand-100 text-brand-600 p-2 rounded-lg">
                        <ArrowRightLeft size={20} />
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-slate-800 group-hover:text-brand-700">Set as Source File 1</p>
                        <p className="text-xs text-slate-500">For comparison tab</p>
                      </div>
                    </button>

                    <button 
                      onClick={() => sendToCompare(2)}
                      className="flex items-center justify-center space-x-2 bg-white border border-brand-200 hover:border-brand-400 p-4 rounded-xl shadow-sm hover:shadow-md transition-all group"
                    >
                      <div className="bg-brand-100 text-brand-600 p-2 rounded-lg">
                        <ArrowRightLeft size={20} />
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-slate-800 group-hover:text-brand-700">Set as Source File 2</p>
                        <p className="text-xs text-slate-500">For comparison tab</p>
                      </div>
                    </button>

                    <button 
                      onClick={downloadOcrExcel}
                      className="flex items-center justify-center space-x-2 bg-white border border-brand-200 hover:border-brand-400 p-4 rounded-xl shadow-sm hover:shadow-md transition-all group"
                    >
                      <div className="bg-brand-100 text-brand-600 p-2 rounded-lg">
                        <Download size={20} />
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-slate-800 group-hover:text-brand-700">Download Excel</p>
                        <p className="text-xs text-slate-500">Save as .xlsx</p>
                      </div>
                    </button>
                 </div>
              </div>
            )}
          </div>
        )}

        {/* --- CLEAN TAB CONTENT --- */}
        {activeTab === 'clean' && (
           <div className="max-w-4xl mx-auto space-y-12 animate-fade-in">
              <div className="text-center space-y-4">
                <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Remove Empty Columns</h1>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  Automatically detect and remove columns that contain no data across all rows.
                </p>
              </div>

              {/* Multi-File Upload Box */}
              <div className="relative group border-2 border-dashed border-slate-300 rounded-2xl p-10 text-center transition-all duration-300 hover:border-brand-400 hover:bg-slate-50 bg-white">
                <input 
                  type="file" 
                  accept=".csv, .xlsx, .xls"
                  multiple
                  onChange={handleCleanUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="space-y-4 pointer-events-none">
                  <div className="w-16 h-16 mx-auto bg-slate-100 text-slate-400 rounded-full flex items-center justify-center group-hover:bg-brand-50 group-hover:text-brand-500 transition-colors">
                    <Eraser size={32} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {isCleanLoading ? "Processing..." : "Drop files here or click to upload"}
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Supports .xlsx, .xls, .csv
                    </p>
                  </div>
                </div>
              </div>

              {/* Clean Configuration */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex items-center space-x-3 mb-4">
                  <Settings2 className="text-brand-600" size={24} />
                  <h3 className="text-lg font-semibold text-slate-900">Cleaning Options</h3>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center space-y-3 sm:space-y-0 sm:space-x-4">
                  <label htmlFor="startRow" className="text-sm font-medium text-slate-700">
                    Start checking for blanks from row:
                  </label>
                  <input
                    id="startRow"
                    type="number"
                    min="1"
                    value={cleanStartRow}
                    onChange={handleCleanStartRowChange}
                    className="w-24 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-900"
                  />
                  <span className="text-xs text-slate-500">
                    (Useful if top rows contain descriptions or titles)
                  </span>
                </div>
              </div>

              {/* File List */}
              {cleanFiles.length > 0 && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                     <h3 className="text-lg font-semibold text-slate-800">Cleaned Files ({cleanFiles.length})</h3>
                     <button onClick={() => setCleanFiles([])} className="text-sm text-red-500 hover:text-red-700">Clear All</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {cleanFiles.map((file, idx) => (
                      <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between shadow-sm">
                        <div className="flex items-center space-x-3 overflow-hidden">
                          <div className="w-10 h-10 bg-green-50 text-green-600 rounded-lg flex items-center justify-center flex-shrink-0">
                             <CheckCircle2 size={20} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{file.original.name}</p>
                            <p className="text-xs text-slate-500">
                              {file.removedCount > 0 
                                ? <span className="text-brand-600 font-medium">{file.removedCount} empty columns removed</span> 
                                : <span>No empty columns found</span>
                              }
                            </p>
                          </div>
                        </div>
                        <button 
                          onClick={() => removeCleanFile(idx)}
                          className="text-slate-400 hover:text-red-500 transition-colors p-1"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-center mt-8">
                    <button
                      onClick={handleCleanDownload}
                      className="flex items-center space-x-2 px-8 py-4 bg-brand-600 text-white rounded-full font-bold text-lg shadow-xl hover:bg-brand-700 hover:scale-105 transition-all shadow-brand-500/30"
                    >
                      <Download size={20} />
                      <span>Download Cleaned Files</span>
                    </button>
                  </div>
                </div>
              )}
           </div>
        )}

        {/* --- TRANSFER TAB --- */}
        {activeTab === 'transfer' && (
           <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
             {transferView === 'upload' && (
               <div className="space-y-8">
                 <div className="text-center max-w-2xl mx-auto mb-12">
                   <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-4">
                     Data Mapping & Transfer
                   </h1>
                   <p className="text-lg text-slate-600">
                     Map columns from File 1 to File 2. Transfer data into File 2's structure, optionally updating existing records based on a unique key.
                   </p>
                 </div>

                 <div className="grid md:grid-cols-2 gap-8">
                   {/* File 1 Upload */}
                   <div className={`relative group rounded-2xl border-2 border-dashed p-10 transition-all duration-300 ${transferFile1 ? 'border-brand-500 bg-brand-50/50' : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'}`}>
                     <input
                       type="file"
                       accept=".xlsx, .xls, .csv"
                       onChange={(e) => handleTransferUpload(e, 1)}
                       className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                     />
                     <div className="text-center flex flex-col items-center space-y-4">
                       <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${transferFile1 ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-400 group-hover:bg-brand-50 group-hover:text-brand-500'}`}>
                         <Upload size={32} />
                       </div>
                       <div>
                         <p className="text-lg font-semibold text-slate-900">
                           {transferFile1 ? transferFile1.name : 'Upload Source File (File 1)'}
                         </p>
                         <p className="text-sm text-slate-500 mt-1">
                           {transferFile1 ? `${transferFile1.rows.length} rows detected` : 'Drag & drop or click to browse'}
                         </p>
                       </div>
                     </div>
                   </div>

                   {/* File 2 Upload */}
                   <div className={`relative group rounded-2xl border-2 border-dashed p-10 transition-all duration-300 ${transferFile2 ? 'border-brand-500 bg-brand-50/50' : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'}`}>
                     <input
                       type="file"
                       accept=".xlsx, .xls, .csv"
                       onChange={(e) => handleTransferUpload(e, 2)}
                       className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                     />
                     <div className="text-center flex flex-col items-center space-y-4">
                       <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${transferFile2 ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-400 group-hover:bg-brand-50 group-hover:text-brand-500'}`}>
                         <Upload size={32} />
                       </div>
                       <div>
                         <p className="text-lg font-semibold text-slate-900">
                           {transferFile2 ? transferFile2.name : 'Upload Target File (File 2)'}
                         </p>
                         <p className="text-sm text-slate-500 mt-1">
                           {transferFile2 ? `${transferFile2.rows.length} rows detected` : 'Drag & drop or click to browse'}
                         </p>
                       </div>
                     </div>
                   </div>
                 </div>

                 {transferFile1 && transferFile2 && (
                   <div className="flex justify-center mt-12 animate-fade-in-up">
                     <button
                       onClick={() => setTransferView('config')}
                       className="flex items-center space-x-2 px-8 py-4 bg-brand-600 text-white rounded-full font-bold text-lg shadow-xl hover:bg-brand-700 hover:scale-105 transition-all shadow-brand-500/30"
                     >
                       <span>Configure Mapping</span>
                       <ArrowRight size={20} />
                     </button>
                   </div>
                 )}
               </div>
             )}

             {transferView === 'config' && transferFile1 && transferFile2 && (
               <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
                 <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                   <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
                     <span className="bg-brand-100 text-brand-700 w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3">1</span>
                     Unique Identifier (Optional)
                   </h2>
                   <p className="text-slate-600 mb-6">
                     If you want to update existing rows in File 2, select a unique key present in both files. If left blank, all rows from File 1 will be appended.
                   </p>
                   
                   <div className="grid md:grid-cols-2 gap-6">
                     <div>
                       <label className="block text-sm font-semibold text-slate-700 mb-2">Source Key (File 1)</label>
                       <select 
                         className="w-full border-slate-300 rounded-xl shadow-sm focus:border-brand-500 focus:ring-brand-500 bg-slate-50 p-3"
                         value={transferKey1}
                         onChange={(e) => setTransferKey1(e.target.value)}
                       >
                         <option value="">-- None --</option>
                         {transferFile1.columns.map(col => (
                           <option key={col} value={col}>{col}</option>
                         ))}
                       </select>
                     </div>
                     <div>
                       <label className="block text-sm font-semibold text-slate-700 mb-2">Target Key (File 2)</label>
                       <select 
                         className="w-full border-slate-300 rounded-xl shadow-sm focus:border-brand-500 focus:ring-brand-500 bg-slate-50 p-3"
                         value={transferKey2}
                         onChange={(e) => setTransferKey2(e.target.value)}
                       >
                         <option value="">-- None --</option>
                         {transferFile2.columns.map(col => (
                           <option key={col} value={col}>{col}</option>
                         ))}
                       </select>
                     </div>
                   </div>
                 </div>

                 <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                   <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
                     <span className="bg-brand-100 text-brand-700 w-8 h-8 rounded-full flex items-center justify-center text-sm mr-3">2</span>
                     Column Mapping
                   </h2>
                   <p className="text-slate-600 mb-6">
                     Map columns from File 1 to File 2. Only mapped columns will be transferred.
                   </p>

                   <div className="space-y-4 bg-slate-50 p-6 rounded-xl border border-slate-100">
                     <div className="grid grid-cols-2 gap-4 mb-2 px-2">
                       <div className="text-sm font-bold text-slate-500 uppercase tracking-wider">Source (File 1)</div>
                       <div className="text-sm font-bold text-slate-500 uppercase tracking-wider">Target (File 2)</div>
                     </div>
                     
                     {transferFile1.columns.map(col1 => {
                       const mappedValues = Object.values(transferMapping);
                       const currentMapping = transferMapping[col1];
                       
                       return (
                         <div key={col1} className="grid grid-cols-2 gap-4 items-center bg-white p-3 rounded-lg shadow-sm border border-slate-200 hover:border-brand-300 transition-colors">
                           <div className="font-medium text-slate-700 truncate px-2" title={col1}>{col1}</div>
                           <select 
                             className="w-full border-slate-300 rounded-lg shadow-sm focus:border-brand-500 focus:ring-brand-500 text-sm"
                             value={currentMapping || '__IGNORE__'}
                             onChange={(e) => updateTransferMapping(col1, e.target.value)}
                           >
                             <option value="__IGNORE__" className="text-slate-400 italic">-- Ignore Column --</option>
                             {transferFile2.columns.map(col2 => {
                               // Hide if mapped to another column
                               if (mappedValues.includes(col2) && currentMapping !== col2) return null;
                               return (
                                 <option key={col2} value={col2}>{col2}</option>
                               );
                             })}
                           </select>
                         </div>
                       );
                     })}
                   </div>
                 </div>

                 <div className="flex justify-between items-center pt-6">
                   <button
                     onClick={() => setTransferView('upload')}
                     className="px-6 py-3 text-slate-600 font-medium hover:bg-slate-200 rounded-xl transition-colors"
                   >
                     Back
                   </button>
                   <button
                     onClick={handleTransfer}
                     disabled={isTransferLoading || Object.keys(transferMapping).length === 0}
                     className="flex items-center space-x-2 px-8 py-4 bg-brand-600 text-white rounded-full font-bold text-lg shadow-xl hover:bg-brand-700 hover:scale-105 transition-all shadow-brand-500/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                   >
                     {isTransferLoading ? (
                       <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />
                     ) : (
                       <>
                         <span>Execute Transfer</span>
                         <ArrowRight size={20} />
                       </>
                     )}
                   </button>
                 </div>
               </div>
             )}

             {transferView === 'results' && (
               <div className="space-y-8 animate-fade-in">
                 <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
                   <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                     <CheckCircle2 size={40} />
                   </div>
                   <h2 className="text-3xl font-bold text-slate-900 mb-4">Transfer Complete!</h2>
                   <p className="text-lg text-slate-600 mb-8 max-w-2xl mx-auto">
                     Successfully generated a new dataset with {transferResults.length} rows based on your mapping configuration.
                   </p>
                   
                   <div className="flex justify-center space-x-4">
                     <button
                       onClick={() => setTransferView('config')}
                       className="px-6 py-3 text-brand-600 bg-brand-50 font-medium hover:bg-brand-100 rounded-xl transition-colors"
                     >
                       Back to Configuration
                     </button>
                     <button
                       onClick={resetTransfer}
                       className="px-6 py-3 text-slate-600 font-medium hover:bg-slate-200 rounded-xl transition-colors"
                     >
                       Start Over
                     </button>
                     <button
                       onClick={handleTransferDownload}
                       className="flex items-center space-x-2 px-8 py-4 bg-brand-600 text-white rounded-full font-bold text-lg shadow-xl hover:bg-brand-700 hover:scale-105 transition-all shadow-brand-500/30"
                     >
                       <Download size={20} />
                       <span>Download Result</span>
                     </button>
                   </div>
                 </div>
               </div>
             )}
           </div>
        )}

        {/* --- SPLITTER TAB CONTENT --- */}
        {activeTab === 'splitter' && (
          <SplitterTool />
        )}

        {/* --- CONVERT TAB CONTENT --- */}
        {activeTab === 'convert' && (
          <ReplacementTool />
        )}

        {/* --- CHECK TAB CONTENT --- */}
        {activeTab === 'check' && (
          <CheckTool />
        )}

      </main>

        {/* --- SHEET SELECTION MODAL --- */}
        {pendingWorkbooks.length > 0 && pendingTarget && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-fade-in-up">
              <div className="p-6 border-b border-slate-200 bg-slate-50">
                <h2 className="text-2xl font-bold text-slate-900">Select Sheets to Import</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {(pendingTarget === 'compare1' || pendingTarget === 'compare2') 
                    ? "For comparison, please select a single sheet." 
                    : "Select which sheets you want to include."}
                </p>
              </div>
              
              <div className="p-6 overflow-y-auto flex-1 space-y-6">
                {pendingWorkbooks.map((pw, idx) => {
                  if (pw.isImage) return null;
                  
                  const isCompare = pendingTarget === 'compare1' || pendingTarget === 'compare2';

                  return (
                    <div key={idx} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                      <div className="flex items-center space-x-3 mb-4 border-b border-slate-100 pb-3">
                        <FileSpreadsheet className="text-brand-600" size={24} />
                        <h3 className="font-semibold text-lg text-slate-800 truncate">{pw.file.name}</h3>
                      </div>
                      
                      <div className="space-y-3">
                        {!isCompare && pw.sheetNames.length > 1 && (
                          <label className="flex items-center space-x-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors">
                            <input 
                              type="checkbox" 
                              checked={pw.selectedSheets.length === pw.sheetNames.length}
                              onChange={(e) => {
                                const newPws = [...pendingWorkbooks];
                                newPws[idx].selectedSheets = e.target.checked ? [...pw.sheetNames] : [];
                                setPendingWorkbooks(newPws);
                              }}
                              className="w-4 h-4 text-brand-600 border-slate-300 rounded focus:ring-brand-500"
                            />
                            <span className="font-medium text-slate-900">Select All Sheets</span>
                          </label>
                        )}
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-2">
                          {pw.sheetNames.map(sheet => (
                            <label key={sheet} className="flex items-center space-x-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors border border-transparent hover:border-slate-200">
                              <input 
                                type={isCompare ? "radio" : "checkbox"}
                                name={`sheet-select-${idx}`}
                                checked={pw.selectedSheets.includes(sheet)}
                                onChange={(e) => {
                                  const newPws = [...pendingWorkbooks];
                                  if (isCompare) {
                                    newPws[idx].selectedSheets = [sheet];
                                  } else {
                                    if (e.target.checked) {
                                      newPws[idx].selectedSheets.push(sheet);
                                    } else {
                                      newPws[idx].selectedSheets = newPws[idx].selectedSheets.filter(s => s !== sheet);
                                    }
                                  }
                                  setPendingWorkbooks(newPws);
                                }}
                                className={`w-4 h-4 text-brand-600 border-slate-300 focus:ring-brand-500 ${isCompare ? 'rounded-full' : 'rounded'}`}
                              />
                              <span className="text-slate-700 truncate" title={sheet}>{sheet}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end space-x-4">
                <button 
                  onClick={() => {
                    setPendingWorkbooks([]);
                    setPendingTarget(null);
                  }} 
                  className="px-6 py-2.5 text-slate-600 font-medium hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => executeImport(pendingWorkbooks, pendingTarget)} 
                  disabled={pendingWorkbooks.every(pw => pw.selectedSheets.length === 0 && !pw.isImage)}
                  className="px-6 py-2.5 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 transition-colors shadow-lg shadow-brand-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Import Selected
                </button>
              </div>
            </div>
          </div>
        )}

    </div>
  );
}

export default App;