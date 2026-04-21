import React, { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, Layers, Download, Loader2, FilePlus, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { FileData } from '../types';
import { parseFile, fixScientificNotation } from '../utils/excelUtils';

export const SplitterTool: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Modes: 'sheets' (separate sheets into files) | 'rows' (divide rows into sheets)
  const [mode, setMode] = useState<'sheets' | 'rows'>('sheets');
  const [rowsPerSheet, setRowsPerSheet] = useState<number>(1000);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    setLoading(true);
    setError(null);
    try {
      setFile(uploadedFile);
      const data = await uploadedFile.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(data), { type: 'array', raw: true });
      if (!wb || !wb.SheetNames) {
        throw new Error("Failed to parse workbook");
      }
      wb.SheetNames?.forEach(sheetName => {
        fixScientificNotation(wb.Sheets[sheetName]);
      });
      setWorkbook(wb);
    } catch (err) {
      setError('Failed to read file. Please ensure it is a valid Excel file.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSeparateSheets = async () => {
    if (!workbook || !file) return;
    setLoading(true);
    try {
      const zip = new JSZip();
      
      workbook.SheetNames?.forEach(sheetName => {
        const newWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWb, workbook.Sheets[sheetName], sheetName);
        
        // Write to array buffer
        const wbout = XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
        
        // Add to zip
        const safeName = sheetName.replace(/[^a-zA-Z0-9]/g, '_');
        zip.file(`${safeName}.xlsx`, wbout);
      });

      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `${file.name.replace(/\.[^/.]+$/, "")}_separated_sheets.zip`);
    } catch (err) {
      setError('Failed to separate sheets.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDivideRows = async () => {
    if (!workbook || !file) return;
    if (rowsPerSheet <= 0) {
      setError('Rows per sheet must be greater than 0.');
      return;
    }
    
    setLoading(true);
    try {
      const newWb = XLSX.utils.book_new();
      
      // For each sheet in the original workbook
      workbook.SheetNames?.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as any[][]; // Array of arrays
        
        if (jsonData.length === 0) return;
        
        const header = jsonData[0];
        const rows = jsonData.slice(1);
        
        if (rows.length === 0) {
          // Just copy the empty sheet
          const newSheet = XLSX.utils.aoa_to_sheet([header]);
          XLSX.utils.book_append_sheet(newWb, newSheet, sheetName.substring(0, 31));
          return;
        }
        
        // Split rows into chunks
        const chunks = [];
        for (let i = 0; i < rows.length; i += rowsPerSheet) {
          chunks.push(rows.slice(i, i + rowsPerSheet));
        }
        
        // Create a new sheet for each chunk
        chunks?.forEach((chunk, index) => {
          const sheetData = [header, ...chunk];
          const newSheet = XLSX.utils.aoa_to_sheet(sheetData);
          
          // Sheet names must be <= 31 chars
          let newSheetName = `${sheetName}_${index + 1}`;
          if (newSheetName.length > 31) {
             newSheetName = `${sheetName.substring(0, 25)}_${index + 1}`;
          }
          
          // Ensure unique name
          let finalName = newSheetName;
          let counter = 1;
          while (newWb.SheetNames.includes(finalName)) {
            finalName = `${newSheetName.substring(0, 28)}_${counter}`;
            counter++;
          }
          
          XLSX.utils.book_append_sheet(newWb, newSheet, finalName);
        });
      });
      
      // Write and download
      const wbout = XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      saveAs(blob, `${file.name.replace(/\.[^/.]+$/, "")}_divided.xlsx`);
      
    } catch (err) {
      setError('Failed to divide rows.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-bold text-slate-800 mb-2">Separator Tool</h2>
        <p className="text-slate-600 mb-6">
          Separate multiple sheets into individual files, or divide large sheets into smaller ones based on row count.
        </p>

        {/* Mode Selection */}
        <div className="flex space-x-4 mb-8">
          <button
            onClick={() => setMode('sheets')}
            className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all flex items-center justify-center space-x-2 ${
              mode === 'sheets' 
                ? 'border-brand-500 bg-brand-50 text-brand-700' 
                : 'border-slate-200 hover:border-slate-300 text-slate-600'
            }`}
          >
            <Layers className="w-5 h-5" />
            <span className="font-medium">Separate Sheets to Files</span>
          </button>
          
          <button
            onClick={() => setMode('rows')}
            className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all flex items-center justify-center space-x-2 ${
              mode === 'rows' 
                ? 'border-brand-500 bg-brand-50 text-brand-700' 
                : 'border-slate-200 hover:border-slate-300 text-slate-600'
            }`}
          >
            <FilePlus className="w-5 h-5" />
            <span className="font-medium">Divide Rows to New Sheets</span>
          </button>
        </div>

        {/* File Upload */}
        {!file ? (
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 rounded-xl p-12 text-center hover:bg-slate-50 hover:border-brand-400 transition-all cursor-pointer group"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx,.xls,.csv"
              className="hidden"
            />
            <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
              <Upload className="w-8 h-8 text-brand-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-1">Upload Excel File</h3>
            <p className="text-slate-500">Click to browse or drag and drop</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-brand-100 rounded-lg flex items-center justify-center">
                  <FileSpreadsheet className="w-5 h-5 text-brand-600" />
                </div>
                <div>
                  <p className="font-medium text-slate-800">{file.name}</p>
                  <p className="text-sm text-slate-500">
                    {workbook ? `${workbook.SheetNames.length} sheet(s)` : 'Loading...'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setFile(null); setWorkbook(null); }}
                className="text-sm text-slate-500 hover:text-red-600 font-medium"
              >
                Change File
              </button>
            </div>

            {error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl flex items-start space-x-3 border border-red-100">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            {/* Mode specific options */}
            {mode === 'sheets' && (
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                <h4 className="font-medium text-blue-800 mb-1">Separate Sheets into Files</h4>
                <p className="text-sm text-blue-600 mb-4">
                  This will create a ZIP file containing individual Excel files for each sheet in your uploaded document.
                </p>
                <button
                  onClick={handleSeparateSheets}
                  disabled={loading || !workbook}
                  className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                  <span>Download ZIP</span>
                </button>
              </div>
            )}

            {mode === 'rows' && (
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 space-y-4">
                <div>
                  <h4 className="font-medium text-blue-800 mb-1">Divide Rows into New Sheets</h4>
                  <p className="text-sm text-blue-600 mb-4">
                    This will split large sheets into multiple smaller sheets within the same Excel file.
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Maximum rows per sheet
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={rowsPerSheet}
                    onChange={(e) => setRowsPerSheet(parseInt(e.target.value) || 1000)}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>

                <button
                  onClick={handleDivideRows}
                  disabled={loading || !workbook}
                  className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                  <span>Download Excel File</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
