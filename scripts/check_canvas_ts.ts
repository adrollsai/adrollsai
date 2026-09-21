import ts from 'typescript';
import path from 'path';

const filePath = path.resolve('app/dashboard/flows/components/manychat-canvas.tsx');
const configPath = ts.findConfigFile('./', ts.sys.fileExists, 'tsconfig.json');
const configFile = ts.readConfigFile(configPath!, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, './');

const program = ts.createProgram([filePath], parsedConfig.options);
const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => d.file?.fileName.includes('manychat-canvas.tsx'));

console.log('Errors in manychat-canvas.tsx:', diagnostics.length);
diagnostics.forEach(d => {
  const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  const { line, character } = d.file!.getLineAndCharacterOfPosition(d.start!);
  console.log(`Line ${line + 1}, col ${character + 1}: ${msg}`);
});
