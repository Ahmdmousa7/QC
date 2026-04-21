import * as XLSX from 'xlsx';

const ws = XLSX.utils.json_to_sheet([{ Barcode: "1234560000000" }]);
console.log(ws);
