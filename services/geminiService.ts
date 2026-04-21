import { GoogleGenAI } from "@google/genai";
import { ComparisonSummary, ComparisonStatus, FileData } from '../types';

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please set process.env.API_KEY.");
  }
  return new GoogleGenAI({ apiKey });
};

// Helper to convert File to Base64
const fileToGenerativePart = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove data url prefix (e.g. "data:image/jpeg;base64,")
      const base64Data = base64String.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Prioritize Gemini 3 Pro and 2.0 Pro for complex menu layout reasoning
const OCR_MODELS = [
  'gemini-3-pro-preview',      // Tier 1: Best for nested menus & variants
  'gemini-2.0-pro-exp-02-05',  // Tier 2: Strong fallback
  'gemini-3-flash-preview'     // Tier 3: Faster, for simpler lists
];

export const extractDataFromImages = async (imageFiles: File[]): Promise<FileData> => {
  const ai = getClient();
  let lastError: any = null;

  // Prepare images once
  const imageParts = await Promise.all(imageFiles.map(async (file) => {
    const base64Data = await fileToGenerativePart(file);
    return { inlineData: { mimeType: file.type, data: base64Data } };
  }));

  const prompt = `
    You are an expert Data Extraction AI specialized in digitizing complex **Restaurant Menus** and **Invoices**.
    
    Your task is to analyze these images and convert them into a flat, structured JSON dataset.
    
    ### SPECIFIC RULES FOR MENUS:
    1.  **Categories as Columns**: Detect section headers (e.g., "Appetizers", "Soups", "Grills"). Create a column named "Category" and apply the section name to all items underneath it.
    2.  **Item Variants**: If an item has multiple sizes or options with different prices (e.g., "Chicken Biryani: Half $10 / Full $18"), you must create **TWO SEPARATE ROWS**:
        - Row 1: Name: "Chicken Biryani - Half", Price: 10
        - Row 2: Name: "Chicken Biryani - Full", Price: 18
    3.  **Multilingual Integrity**: If text is in English and Arabic (or another language), keep them **TOGETHER** in the same cell.
        - Example: Name: "Hummus | حمص", Description: "Chickpeas dip | متبل حمص"
    4.  **Price Formatting**: Extract only the number. Remove currency symbols ($, SR, AED). Convert "12.500" to "12.5".
    5.  **Clean Data**: Ignore page numbers, footers, phone numbers, and "Wifi Password" text.

    ### OUTPUT FORMAT (JSON ONLY):
    Return a single JSON object with a "rows" array.
    
    Example Structure:
    {
      "rows": [
        { "Category": "Starters", "Name": "Spring Rolls", "Description": "3 pcs veg rolls", "Price": "15" },
        { "Category": "Mains", "Name": "Beef Burger", "Description": "With cheese", "Price": "35" }
      ]
    }
  `;

  // Loop through models with retry logic
  for (const model of OCR_MODELS) {
    let attempts = 0;
    const maxAttempts = 2; // Retry once per model for transient errors

    while (attempts < maxAttempts) {
      attempts++;
      try {
        console.log(`Attempting OCR with model: ${model} (Attempt ${attempts})`);
        
        const response = await ai.models.generateContent({
          model: model,
          contents: {
            parts: [
              ...imageParts,
              { text: prompt }
            ]
          },
          config: {
            responseMimeType: "application/json",
            maxOutputTokens: 8192, // Allow large output for full menus
          }
        });

        const text = response.text;
        if (!text) throw new Error("No data returned from AI.");

        // Sanitize text just in case model adds markdown blocks
        const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();

        let jsonResult;
        try {
          jsonResult = JSON.parse(cleanText);
        } catch (e) {
          throw new Error("Failed to parse JSON response from model.");
        }
        
        if (!jsonResult.rows || !Array.isArray(jsonResult.rows) || jsonResult.rows.length === 0) {
          throw new Error("Could not detect a valid table structure (missing 'rows' array).");
        }

        const rows = jsonResult.rows;
        
        // Ensure consistent columns
        const allKeys = new Set<string>();
        rows?.forEach((r: any) => Object.keys(r || {})?.forEach(k => allKeys.add(k)));
        const columns = Array.from(allKeys);

        return {
          name: `Menu_Scan_${new Date().toISOString().slice(0, 10)}`,
          rows: rows,
          columns: columns
        };

      } catch (error: any) {
        console.warn(`Model ${model} failed on attempt ${attempts}:`, error);
        lastError = error;
        
        const isTransient = 
          error.status === 429 || 
          error.status === 503 || 
          error.status === 500 || 
          (error.message && error.message.includes('fetch failed'));

        if (isTransient && attempts < maxAttempts) {
          console.log(`Retrying ${model} due to transient error...`);
          await wait(2000 * attempts);
          continue; 
        }
        break; // Move to next model if error is permanent
      }
    }
  }

  console.error("All OCR models failed.", lastError);
  throw new Error(`Failed to extract menu data. Please ensure images are clear. Last Error: ${lastError?.message || "Unknown error"}`);
};

export const analyzeComparison = async (summary: ComparisonSummary, file1Name: string, file2Name: string): Promise<string> => {
  try {
    const ai = getClient();
    
    // ... Prepare summary prompt ...
    const prompt = `
      Analyze this comparison between "${file1Name}" and "${file2Name}".
      
      Stats: Matches: ${summary.matches}, Mismatches: ${summary.mismatches}, Missing in 1: ${summary.missingIn1}, Missing in 2: ${summary.missingIn2}.
      
      Sample Mismatches: ${JSON.stringify(summary.results.filter(r => r.status === 'MISMATCH').slice(0, 3).map(r => ({ k: r.key, diff: r.differences })))}

      Provide a professional executive summary for a Data Analyst. Focus on data consistency and potential pricing/inventory discrepancies.
    `;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
      return response.text || "No analysis generated.";
    } catch (e) {
       return "Analysis unavailable at this time.";
    }

  } catch (error) {
    return "Failed to generate AI analysis.";
  }
};
