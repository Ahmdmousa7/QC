import React, { useState, useRef, useMemo } from 'react';
import { Upload, FileSpreadsheet, Download, Loader2, ArrowRightLeft, AlertCircle, Settings2, Eraser } from 'lucide-react';
import * as XLSX from 'xlsx';
import { FileData } from '../types';
import { parseFile, exportToExcelMultipleSheets, readWorkbook, extractSheets } from '../utils/excelUtils';

type ReplaceOperation = 'kg_to_g' | 'remove_text' | 'custom' | 'transform_values';

type ActionType = 'KEEP' | 'EQUAL' | 'MULTIPLY';
interface TransformRule {
  action: ActionType;
  parameter: string;
}

export const ReplacementTool: React.FC = () => {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [operation, setOperation] = useState<ReplaceOperation>('kg_to_g');
  const [findText, setFindText] = useState<string>('');
  const [replaceText, setReplaceText] = useState<string>('');
  const [rules, setRules] = useState<Record<string, TransformRule>>({});
  
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [modifiedData, setModifiedData] = useState<any[]>([]);

  // Sheet selection state
  const [pendingWorkbook, setPendingWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [showSheetModal, setShowSheetModal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    setLoading(true);
    setError(null);
    try {
      const { workbook, sheetNames } = await readWorkbook(uploadedFile);
      
      if (sheetNames.length > 1) {
        setPendingWorkbook(workbook);
        setPendingFile(uploadedFile);
        setSheetNames(sheetNames);
        setSelectedSheet(sheetNames[0]);
        setShowSheetModal(true);
      } else {
        const extracted = extractSheets(workbook, uploadedFile.name, sheetNames);
        if (extracted.length > 0) {
          const data = extracted[0];
          setFileData(data);
          setModifiedData([...data.rows]);
          if (data.columns.length > 0) {
            setSelectedColumn(data.columns[0]);
            setSelectedColumns([data.columns[0]]);
          }
        }
      }
    } catch (err) {
      setError('Failed to read file. Please ensure it is a valid Excel/CSV file.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSheetSelection = () => {
    if (!pendingWorkbook || !pendingFile || !selectedSheet) return;
    
    try {
      const extracted = extractSheets(pendingWorkbook, pendingFile.name, [selectedSheet]);
      if (extracted.length > 0) {
        const data = extracted[0];
        setFileData(data);
        setModifiedData([...data.rows]);
        if (data.columns.length > 0) {
          setSelectedColumn(data.columns[0]);
          setSelectedColumns([data.columns[0]]);
        }
      }
      setShowSheetModal(false);
      setPendingWorkbook(null);
      setPendingFile(null);
    } catch (err) {
      setError('Failed to extract sheet.');
      console.error(err);
    }
  };

  const uniqueValues = useMemo(() => {
    if (!fileData || selectedColumns.length === 0 || operation !== 'transform_values') return [];
    
    const valCounts: Record<string, number> = {};
    fileData.rows.forEach(row => {
      selectedColumns.forEach(col => {
        const val = row[col];
        if (val !== undefined && val !== null && val !== '') {
          const strVal = String(val).trim();
          valCounts[strVal] = (valCounts[strVal] || 0) + 1;
        }
      });
    });
    
    return Object.entries(valCounts)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  }, [fileData, selectedColumns, operation]);

  const applyReplacement = () => {
    if (!fileData) return;
    if (operation !== 'transform_values' && !selectedColumn) return;
    if (operation === 'transform_values' && selectedColumns.length === 0) return;
    
    setLoading(true);
    try {
      const newData = fileData.rows.map(row => {
        const newRow = { ...row };
        
        if (operation === 'transform_values') {
          selectedColumns.forEach(col => {
            const val = newRow[col];
            if (val !== undefined && val !== null && val !== '') {
              const strVal = String(val).trim();
              const rule = rules[strVal];
              if (rule && rule.action !== 'KEEP') {
                if (rule.action === 'EQUAL') {
                  newRow[col] = rule.parameter;
                } else if (rule.action === 'MULTIPLY') {
                  const numMatch = strVal.match(/[\d.]+/);
                  if (numMatch) {
                    const num = parseFloat(numMatch[0]);
                    const multiplier = parseFloat(rule.parameter);
                    if (!isNaN(num) && !isNaN(multiplier)) {
                      newRow[col] = num * multiplier;
                    }
                  }
                }
              }
            }
          });
        } else {
          const val = newRow[selectedColumn];
          
          if (val !== undefined && val !== null) {
            const strVal = String(val).trim();
            
            if (operation === 'kg_to_g') {
              // Check if it contains kg or كيلو
              if (/kg|كيلو/i.test(strVal)) {
                // Extract number
                const numMatch = strVal.match(/[\d.]+/);
                if (numMatch) {
                  const num = parseFloat(numMatch[0]);
                  if (!isNaN(num)) {
                    newRow[selectedColumn] = num * 1000;
                  }
                }
              }
            } else if (operation === 'remove_text') {
              // Keep only numbers and decimals
              const numMatch = strVal.match(/[\d.]+/);
              if (numMatch) {
                const num = parseFloat(numMatch[0]);
                if (!isNaN(num)) {
                  newRow[selectedColumn] = num;
                }
              } else {
                newRow[selectedColumn] = '';
              }
            } else if (operation === 'custom') {
              newRow[selectedColumn] = strVal.split(findText).join(replaceText);
            }
          }
        }
        return newRow;
      });
      
      setModifiedData(newData);
      
      // Generate preview (first 5 changed rows if possible, or just first 5 rows)
      const changedRows = newData.filter((row, i) => {
        if (operation === 'transform_values') {
          return selectedColumns.some(col => row[col] !== fileData.rows[i][col]);
        } else {
          return row[selectedColumn] !== fileData.rows[i][selectedColumn];
        }
      });
      setPreviewData(changedRows.slice(0, 5).length > 0 ? changedRows.slice(0, 5) : newData.slice(0, 5));
      
    } catch (err) {
      setError('Error applying replacement.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!fileData || modifiedData.length === 0) return;
    exportToExcelMultipleSheets([{ name: fileData.name, rows: modifiedData }], `Replaced_${fileData.name}`);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in">
      <div className="text-center space-y-4">
        <h2 className="text-3xl font-bold text-slate-900 flex items-center justify-center space-x-3">
          <ArrowRightLeft className="text-brand-600" size={32} />
          <span>Data Replacement</span>
        </h2>
        <p className="text-slate-600 max-w-2xl mx-auto text-lg">
          Clean up your data by replacing text, converting units (like kg to grams), or removing unwanted characters.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
        {!fileData ? (
          <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx,.xls,.csv"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="flex flex-col items-center space-y-4 text-slate-600 hover:text-brand-600 transition-colors"
            >
              {loading ? (
                <Loader2 size={48} className="animate-spin text-brand-500" />
              ) : (
                <Upload size={48} className="text-slate-400 group-hover:text-brand-500" />
              )}
              <span className="text-lg font-medium">
                {loading ? 'Processing...' : 'Upload Excel/CSV File'}
              </span>
              <span className="text-sm text-slate-400">Drag and drop or click to browse</span>
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center space-x-3">
                <FileSpreadsheet className="text-brand-600" size={24} />
                <div>
                  <h3 className="font-semibold text-slate-900">{fileData.name}</h3>
                  <p className="text-sm text-slate-500">{fileData.rows.length} rows</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setFileData(null);
                  setModifiedData([]);
                  setPreviewData([]);
                }}
                className="text-sm text-slate-500 hover:text-red-600 font-medium transition-colors"
              >
                Change File
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {operation === 'transform_values' ? 'Select Columns to Modify' : 'Select Column to Modify'}
                  </label>
                  {operation === 'transform_values' ? (
                    <div className="max-h-48 overflow-y-auto border border-slate-300 rounded-lg p-3 bg-white space-y-2 custom-scrollbar">
                      {fileData.columns.map(col => (
                        <label key={col} className="flex items-center space-x-3 cursor-pointer hover:bg-slate-50 p-1.5 rounded transition-colors">
                          <input
                            type="checkbox"
                            checked={selectedColumns.includes(col)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedColumns(prev => [...prev, col]);
                              } else {
                                setSelectedColumns(prev => prev.filter(c => c !== col));
                              }
                            }}
                            className="w-4 h-4 text-brand-600 border-slate-300 rounded focus:ring-brand-500"
                          />
                          <span className="text-sm font-medium text-slate-700">{col}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <select
                      value={selectedColumn}
                      onChange={(e) => setSelectedColumn(e.target.value)}
                      className="w-full px-4 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                    >
                      {fileData.columns.map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Operation
                  </label>
                  <div className="space-y-3">
                    <label className="flex items-center space-x-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="radio"
                        name="operation"
                        value="transform_values"
                        checked={operation === 'transform_values'}
                        onChange={() => setOperation('transform_values')}
                        className="text-brand-600 focus:ring-brand-500"
                      />
                      <div>
                        <span className="block font-medium text-slate-900">Advanced Transform</span>
                        <span className="block text-sm text-slate-500">Map unique values to new values or multiply</span>
                      </div>
                    </label>
                    <label className="flex items-center space-x-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="radio"
                        name="operation"
                        value="kg_to_g"
                        checked={operation === 'kg_to_g'}
                        onChange={() => setOperation('kg_to_g')}
                        className="text-brand-600 focus:ring-brand-500"
                      />
                      <div>
                        <span className="block font-medium text-slate-900">Convert kg/كيلو to grams</span>
                        <span className="block text-sm text-slate-500">e.g., "1.5 كيلو" → 1500</span>
                      </div>
                    </label>
                    <label className="flex items-center space-x-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="radio"
                        name="operation"
                        value="remove_text"
                        checked={operation === 'remove_text'}
                        onChange={() => setOperation('remove_text')}
                        className="text-brand-600 focus:ring-brand-500"
                      />
                      <div>
                        <span className="block font-medium text-slate-900">Extract Numbers Only</span>
                        <span className="block text-sm text-slate-500">Removes all text, keeps only the first number</span>
                      </div>
                    </label>
                    <label className="flex items-center space-x-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="radio"
                        name="operation"
                        value="custom"
                        checked={operation === 'custom'}
                        onChange={() => setOperation('custom')}
                        className="text-brand-600 focus:ring-brand-500"
                      />
                      <div>
                        <span className="block font-medium text-slate-900">Custom Find & Replace</span>
                        <span className="block text-sm text-slate-500">Replace specific text with another</span>
                      </div>
                    </label>
                  </div>
                </div>

                {operation === 'custom' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Find</label>
                      <input
                        type="text"
                        value={findText}
                        onChange={(e) => setFindText(e.target.value)}
                        className="w-full px-4 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                        placeholder="Text to find"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Replace With</label>
                      <input
                        type="text"
                        value={replaceText}
                        onChange={(e) => setReplaceText(e.target.value)}
                        className="w-full px-4 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                        placeholder="Replacement text"
                      />
                    </div>
                  </div>
                )}

                {operation === 'transform_values' && uniqueValues.length > 0 && (
                  <div className="mt-6 border border-slate-200 rounded-xl overflow-hidden bg-white">
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                      <h4 className="font-semibold text-slate-800">Unique Values Found</h4>
                      <p className="text-xs text-slate-500">Define rules for each value</p>
                    </div>
                    <div className="max-h-64 overflow-y-auto custom-scrollbar">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-600 sticky top-0 shadow-sm z-10">
                          <tr>
                            <th className="px-4 py-2 font-medium">Value</th>
                            <th className="px-4 py-2 font-medium w-20 text-center">Count</th>
                            <th className="px-4 py-2 font-medium w-32">Action</th>
                            <th className="px-4 py-2 font-medium w-32">Parameter</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {uniqueValues.map(({ value, count }) => {
                            const rule = rules[value] || { action: 'KEEP', parameter: '' };
                            return (
                              <tr key={value} className="hover:bg-slate-50">
                                <td className="px-4 py-2 text-slate-700 truncate max-w-[150px]" title={value}>{value}</td>
                                <td className="px-4 py-2 text-slate-500 text-center">{count}</td>
                                <td className="px-4 py-2">
                                  <select
                                    value={rule.action}
                                    onChange={(e) => setRules(prev => ({
                                      ...prev,
                                      [value]: { ...rule, action: e.target.value as ActionType }
                                    }))}
                                    className="w-full border-slate-300 rounded-md shadow-sm focus:border-brand-500 focus:ring-brand-500 text-xs py-1"
                                  >
                                    <option value="KEEP">Keep As Is</option>
                                    <option value="EQUAL">Equal (=)</option>
                                    <option value="MULTIPLY">By (×)</option>
                                  </select>
                                </td>
                                <td className="px-4 py-2">
                                  <input
                                    type="text"
                                    value={rule.parameter}
                                    onChange={(e) => setRules(prev => ({
                                      ...prev,
                                      [value]: { ...rule, parameter: e.target.value }
                                    }))}
                                    disabled={rule.action === 'KEEP'}
                                    placeholder={rule.action === 'KEEP' ? '-' : 'Value'}
                                    className="w-full border-slate-300 rounded-md shadow-sm focus:border-brand-500 focus:ring-brand-500 text-xs py-1 disabled:bg-slate-100 disabled:text-slate-400"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <button
                  onClick={applyReplacement}
                  disabled={loading || (operation === 'transform_values' ? selectedColumns.length === 0 : !selectedColumn)}
                  className="w-full py-3 bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                >
                  {loading ? <Loader2 className="animate-spin" size={20} /> : <Settings2 size={20} />}
                  <span>Apply Changes</span>
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-slate-900">Preview Changes</h4>
                  {previewData.length > 0 && (
                    <span className="text-xs font-medium px-2 py-1 bg-brand-100 text-brand-700 rounded-full">
                      Showing sample
                    </span>
                  )}
                </div>
                
                <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden h-[400px] flex flex-col">
                  {previewData.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                      <Eraser size={48} className="mb-4 opacity-50" />
                      <p>Select a column and apply changes to see a preview here.</p>
                    </div>
                  ) : (
                    <div className="overflow-auto flex-1">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-100 text-slate-600 sticky top-0">
                          <tr>
                            {operation === 'transform_values' && <th className="px-4 py-3 font-semibold border-b border-slate-200">Column</th>}
                            <th className="px-4 py-3 font-semibold border-b border-slate-200">Original Value</th>
                            <th className="px-4 py-3 font-semibold border-b border-slate-200">New Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {previewData.map((row, idx) => {
                            // Find original row
                            const originalRow = fileData.rows.find(r => r.__rowNum__ === row.__rowNum__) || fileData.rows[idx];
                            
                            if (operation === 'transform_values') {
                              const changedCols = selectedColumns.filter(col => originalRow[col] !== row[col]);
                              if (changedCols.length === 0) {
                                const col = selectedColumns[0] || '';
                                return (
                                  <tr key={idx}>
                                    <td className="px-4 py-3 text-slate-500">{col}</td>
                                    <td className="px-4 py-3 text-slate-600 truncate max-w-[150px]">{String(originalRow[col] || '')}</td>
                                    <td className="px-4 py-3 font-medium text-slate-900 truncate max-w-[150px]">{String(row[col] || '')}</td>
                                  </tr>
                                );
                              }
                              return changedCols.map(col => (
                                <tr key={`${idx}-${col}`} className="bg-green-50/50">
                                  <td className="px-4 py-3 text-slate-500">{col}</td>
                                  <td className="px-4 py-3 text-slate-600 truncate max-w-[150px]" title={String(originalRow[col] || '')}>
                                    {originalRow[col] !== undefined && originalRow[col] !== null ? String(originalRow[col]) : <span className="text-slate-400 italic">Empty</span>}
                                  </td>
                                  <td className="px-4 py-3 font-medium text-slate-900 truncate max-w-[150px]" title={String(row[col] || '')}>
                                    {row[col] !== undefined && row[col] !== null ? String(row[col]) : <span className="text-slate-400 italic">Empty</span>}
                                  </td>
                                </tr>
                              ));
                            } else {
                              const oldVal = originalRow ? originalRow[selectedColumn] : '';
                              const newVal = row[selectedColumn];
                              const isChanged = oldVal !== newVal;
                              
                              return (
                                <tr key={idx} className={isChanged ? 'bg-green-50/50' : ''}>
                                  <td className="px-4 py-3 text-slate-600 truncate max-w-[200px]" title={String(oldVal)}>
                                    {oldVal !== undefined && oldVal !== null ? String(oldVal) : <span className="text-slate-400 italic">Empty</span>}
                                  </td>
                                  <td className="px-4 py-3 font-medium text-slate-900 truncate max-w-[200px]" title={String(newVal)}>
                                    {newVal !== undefined && newVal !== null ? String(newVal) : <span className="text-slate-400 italic">Empty</span>}
                                  </td>
                                </tr>
                              );
                            }
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 flex items-center space-x-3">
                <AlertCircle size={20} />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-center pt-6 border-t border-slate-200">
              <button
                onClick={handleDownload}
                disabled={modifiedData.length === 0 || previewData.length === 0}
                className="flex items-center space-x-2 px-8 py-4 bg-brand-600 text-white rounded-full font-bold text-lg shadow-xl hover:bg-brand-700 hover:scale-105 transition-all shadow-brand-500/30 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
              >
                <Download size={24} />
                <span>Download Updated File</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sheet Selection Modal */}
      {showSheetModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-fade-in-up">
            <div className="p-6 border-b border-slate-200 bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">Select Sheet</h2>
              <p className="text-sm text-slate-500 mt-1">
                This file contains multiple sheets. Please select one to process.
              </p>
            </div>
            
            <div className="p-6">
              <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                {sheetNames.map(sheet => (
                  <label 
                    key={sheet}
                    className={`flex items-center p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      selectedSheet === sheet 
                        ? 'border-brand-500 bg-brand-50' 
                        : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="sheet-selection"
                      value={sheet}
                      checked={selectedSheet === sheet}
                      onChange={() => setSelectedSheet(sheet)}
                      className="w-4 h-4 text-brand-600 border-slate-300 focus:ring-brand-500"
                    />
                    <span className="ml-3 font-medium text-slate-700">{sheet}</span>
                  </label>
                ))}
              </div>
            </div>
            
            <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowSheetModal(false);
                  setPendingWorkbook(null);
                  setPendingFile(null);
                }}
                className="px-6 py-2.5 rounded-xl font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSheetSelection}
                disabled={!selectedSheet}
                className="px-6 py-2.5 rounded-xl font-semibold bg-brand-600 text-white hover:bg-brand-700 shadow-lg shadow-brand-500/30 transition-all disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
