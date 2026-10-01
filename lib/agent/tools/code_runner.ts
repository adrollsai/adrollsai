import { tool } from 'ai';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import * as vm from 'vm';

export function createCodeRunnerTool() {
  return {
    execute_data_code: tool({
      description: 'Executes dynamic JavaScript code in a sandboxed environment to solve data parsing, calculations, or file processing tasks on the fly (e.g. parsing CSV/Excel text, calculating mortgage/EMI, data transformation, deduplicating leads, regex formatting). "XLSX" is pre-loaded for parsing spreadsheets.',
      inputSchema: z.object({
        code: z.string().describe('The JavaScript code to execute. Must return a value or set output.'),
        contextData: z.record(z.string(), z.any()).optional().describe('Optional input data (e.g. raw CSV string, lead array) accessible in sandbox as "data"'),
      }),
      execute: async ({ code, contextData }) => {
        try {
          const logs: string[] = [];

          // Create safe sandbox environment
          const sandbox = {
            data: contextData || {},
            XLSX,
            console: {
              log: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
              error: (...args: any[]) => logs.push('[ERROR] ' + args.join(' ')),
              warn: (...args: any[]) => logs.push('[WARN] ' + args.join(' ')),
            },
            JSON,
            Math,
            Date,
            RegExp,
            Array,
            Object,
            String,
            Number,
            Boolean,
            parseInt,
            parseFloat,
            isNaN,
            isFinite,
          };

          const script = new vm.Script(`
            (function() {
              ${code}
            })()
          `);

          const context = vm.createContext(sandbox);
          const result = script.runInContext(context, { timeout: 4000 });

          return {
            success: true,
            result: result !== undefined ? result : null,
            logs,
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.message,
          };
        }
      },
    }),

    parse_csv_or_excel: tool({
      description: 'Parses a raw CSV string, TSV, or base64 spreadsheet into structured JSON rows using XLSX parser.',
      inputSchema: z.object({
        rawContent: z.string().describe('The raw CSV text content or base64 data'),
        isBase64: z.boolean().default(false).describe('True if content is base64 encoded binary spreadsheet'),
      }),
      execute: async ({ rawContent, isBase64 }) => {
        try {
          let workbook: XLSX.WorkBook;
          if (isBase64) {
            workbook = XLSX.read(rawContent, { type: 'base64' });
          } else {
            workbook = XLSX.read(rawContent, { type: 'string' });
          }

          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

          return {
            success: true,
            totalRows: rows.length,
            columns: rows.length > 0 ? Object.keys(rows[0] as object) : [],
            sampleRows: rows.slice(0, 5),
            rows,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}
