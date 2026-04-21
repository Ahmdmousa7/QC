import React, { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, Download, Loader2, ShieldCheck, AlertCircle, CheckCircle2, Eraser } from 'lucide-react';
import * as XLSX from 'xlsx';
import { FileData } from '../types';
import { readWorkbook, extractSheets, exportToExcelMultipleSheets } from '../utils/excelUtils';

export const CheckTool: React.FC = () => {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [stats, setStats] = useState<{ fakeBlanks: number, untrimmed: number, totalIssues: number } | null>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [cleanedData, setCleanedData] = useState<any[]>([]);

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
    setStats(null);
    setIssues([]);
    setCleanedData([]);
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
          analyzeAndClean(data);
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
        analyzeAndClean(data);
      }
      setShowSheetModal(false);
      setPendingWorkbook(null);
      setPendingFile(null);
    } catch (err) {
      setError('Failed to extract sheet.');
      console.error(err);
    }
  };

  const analyzeAndClean = (data: FileData) => {
    let fakeBlanks = 0;
    let untrimmed = 0;
    const foundIssues: any[] = [];
    const newCleanedData: any[] = [];

    data.rows.forEach((row, rowIndex) => {
      let rowHasIssue = false;
      const newRow = { ...row };
      const rowIssues: string[] = [];

      Object.keys(row).forEach(col => {
        const val = row[col];
        if (typeof val === 'string') {
          if (val.length > 0 && val.trim().length === 0) {
            fakeBlanks++;
            rowHasIssue = true;
            newRow[col] = ''; // Convert to truly empty string
            rowIssues.push(`'${col}': Fake blank (spaces only)`);
          } else if (val.length > 0 && val !== val.trim()) {
            untrimmed++;
            rowHasIssue = true;
            newRow[col] = val.trim(); // Trim extra spaces
            rowIssues.push(`'${col}': Leading/trailing spaces`);
          }
        }
      });

      newCleanedData.push(newRow);

      if (rowHasIssue) {
        foundIssues.push({
          rowNum: row.__rowNum__ || rowIndex + 1,
          original: { ...row },
          cleaned: newRow,
          issues: rowIssues
        });
      }
    });

    setStats({
      fakeBlanks,
      untrimmed,
      totalIssues: fakeBlanks + untrimmed
    });
    setIssues(foundIssues);
    setCleanedData(newCleanedData);
  };

  const handleDownload = () => {
    if (!fileData || cleanedData.length === 0) return;
    exportToExcelMultipleSheets([{ name: fileData.name, rows: cleanedData }], `Cleaned_${fileData.name}`);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in">
      <div className="text-center space-y-4">
        <h2 className="text-3xl font-bold text-slate-900 flex items-center justify-center space-x-3">
          <ShieldCheck className="text-brand-600" size={32} />
          <span>Check & Clean Blanks</span>
        </h2>
        <p className="text-slate-600 max-w-2xl mx-auto text-lg">
          Upload your file to automatically detect and fix "fake blanks" (cells with only spaces) and trim extra spaces from your data.
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
                  <p className="text-sm text-slate-500">{fileData.rows.length} rows analyzed</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setFileData(null);
                  setCleanedData([]);
                  setIssues([]);
                  setStats(null);
                }}
                className="text-sm text-slate-500 hover:text-red-600 font-medium transition-colors"
              >
                Change File
              </button>
            </div>

            {stats && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center text-center">
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-4">
                    <Eraser size={24} />
                  </div>
                  <h4 className="text-3xl font-bold text-slate-900 mb-1">{stats.fakeBlanks}</h4>
                  <p className="text-sm font-medium text-slate-500">Fake Blanks Found</p>
                  <p className="text-xs text-slate-400 mt-2">Cells containing only spaces</p>
                </div>
                
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center text-center">
                  <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mb-4">
                    <AlertCircle size={24} />
                  </div>
                  <h4 className="text-3xl font-bold text-slate-900 mb-1">{stats.untrimmed}</h4>
                  <p className="text-sm font-medium text-slate-500">Untrimmed Cells</p>
                  <p className="text-xs text-slate-400 mt-2">Cells with leading/trailing spaces</p>
                </div>

                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center text-center">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${stats.totalIssues === 0 ? 'bg-green-50 text-green-600' : 'bg-brand-50 text-brand-600'}`}>
                    <CheckCircle2 size={24} />
                  </div>
                  <h4 className="text-3xl font-bold text-slate-900 mb-1">{stats.totalIssues === 0 ? 'Perfect!' : stats.totalIssues}</h4>
                  <p className="text-sm font-medium text-slate-500">{stats.totalIssues === 0 ? 'No issues found' : 'Total Issues Fixed'}</p>
                  <p className="text-xs text-slate-400 mt-2">Ready to download cleaned file</p>
                </div>
              </div>
            )}

            {issues.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-slate-900">Preview of Fixed Issues</h4>
                  <span className="text-xs font-medium px-2 py-1 bg-brand-100 text-brand-700 rounded-full">
                    Showing up to 100 rows
                  </span>
                </div>
                
                <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden max-h-[400px] flex flex-col">
                  <div className="overflow-auto flex-1 custom-scrollbar">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-100 text-slate-600 sticky top-0 shadow-sm">
                        <tr>
                          <th className="px-4 py-3 font-semibold border-b border-slate-200 w-20">Row</th>
                          <th className="px-4 py-3 font-semibold border-b border-slate-200">Issues Found</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {issues.slice(0, 100).map((issue, idx) => (
                          <tr key={idx} className="hover:bg-slate-100 transition-colors">
                            <td className="px-4 py-3 text-slate-500 font-medium">#{issue.rowNum}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                {issue.issues.map((msg: string, i: number) => (
                                  <span key={i} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                                    {msg}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 flex items-center space-x-3">
                <AlertCircle size={20} />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-center pt-6 border-t border-slate-200">
              <button
                onClick={handleDownload}
                disabled={cleanedData.length === 0}
                className="flex items-center space-x-2 px-8 py-4 bg-brand-600 text-white rounded-full font-bold text-lg shadow-xl hover:bg-brand-700 hover:scale-105 transition-all shadow-brand-500/30 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
              >
                <Download size={24} />
                <span>Download Cleaned File</span>
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
