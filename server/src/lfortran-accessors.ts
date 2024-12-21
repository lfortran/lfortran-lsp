import {
  DefinitionLink
} from 'vscode-languageserver-protocol';

import {
  Diagnostic,
  Location,
  Position,
  Range,
  SymbolInformation,
  TextEdit,
} from 'vscode-languageserver/node';

import {
  ErrorDiagnostics,
  LFortranSettings,
} from './lfortran-types';

import which from 'which';

import fs from 'fs';

import tmp from 'tmp';

import { spawnSync } from 'node:child_process';

import { Logger } from './logger';

import shellescape from 'shell-escape';

/**
 * Accessor interface for interacting with LFortran. Possible implementations
 * include a CLI accessor and service accessor.
 */
export interface LFortranAccessor {

  /**
   * Looks-up all the symbols in the given document.
   */
  showDocumentSymbols(uri: string,
                      text: string,
                      settings: LFortranSettings): Promise<SymbolInformation[]>;

  /**
   * Looks-up the location and range of the definition of the symbol within the
   * given document at the specified line and column.
   */
  lookupName(uri: string,
             text: string,
             line: number,
             column: number,
             settings: LFortranSettings): Promise<DefinitionLink[]>;

  /**
   * Identifies the errors and warnings about the statements within the given
   * document.
   */
  showErrors(uri: string,
             text: string,
             settings: LFortranSettings): Promise<Diagnostic[]>;

  renameSymbol(uri: string,
               text: string,
               line: number,
               column: number,
               newName: string,
               settings: LFortranSettings): Promise<TextEdit[]>;
}

/**
 * Interacts with LFortran through its escapedCommand-line interface.
 */
export class LFortranCLIAccessor implements LFortranAccessor {
  static LOG_CONTEXT: string = "LFortranCLIAccessor";

  // File handle representing the temporary file used to pass document text to
  // LFortran.
  public tmpFile = tmp.fileSync({
    prefix: "lfortran-lsp",
    postfix: ".tmp"
  });

  public logger: Logger;
  private cleanUpHandler: () => void;

  constructor(logger: Logger) {
    const fnid: string = "constructor";
    const start: number = performance.now();

    this.logger = logger;

    // Be sure to delete the temporary file when possible.
    this.cleanUpHandler = this.cleanUp.bind(this);
    process.on("exit", this.cleanUpHandler);
    process.on("SIGINT", this.cleanUpHandler);
    process.on("uncaughtException", this.cleanUpHandler);

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logger.benchmarkAndTrace(
        LFortranCLIAccessor.LOG_CONTEXT,
        fnid, start,
        [
          "logger", logger,
        ]
      );
    }
  }

  cleanUp(...args: any[]): void {
    const fnid: string = "cleanUp";
    const start: number = performance.now();

    try {
      if (fs.existsSync(this.tmpFile.name)) {
        try {
          this.logger.debug(
            LFortranCLIAccessor.LOG_CONTEXT,
            "Deleting temporary file: %s",
            this.tmpFile.name);
          this.tmpFile.removeCallback();
        } catch (error: any) {
          this.logger.error(
            LFortranCLIAccessor.LOG_CONTEXT,
            "Failed to delete temporary file: %s",
            this.tmpFile.name);
          this.logger.error(LFortranCLIAccessor.LOG_CONTEXT, error);
        }
      }
    } finally {
      process.removeListener("uncaughtException", this.cleanUpHandler);
      process.removeListener("SIGINT", this.cleanUpHandler);
      process.removeListener("exit", this.cleanUpHandler);
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logger.benchmarkAndTrace(
        LFortranCLIAccessor.LOG_CONTEXT,
        fnid, start,
        [
          "args", args,
        ]
      );
    }
  }

  async checkPathExistsAndIsExecutable(path: string): Promise<boolean> {
    const fnid: string = "checkPathExistsAndIsExecutable";
    const start: number = performance.now();

    let pathExistsAndIsExecutable: boolean = false;

    try {
      const stats = await fs.promises.stat(path);
      pathExistsAndIsExecutable = stats.isFile() &&
        (stats.mode & 0o111) !== 0;
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err; // Other errors
      }
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logger.benchmarkAndTrace(
        LFortranCLIAccessor.LOG_CONTEXT,
        fnid, start,
        [
          "path", path,
        ],
        pathExistsAndIsExecutable
      );
    }
    return pathExistsAndIsExecutable;
  }

  /**
   * Invokes LFortran through its command-line interface with the given
   * settings, flags, and document text.
   */
  async runCompiler(settings: LFortranSettings,
                    params: string[],
                    text: string,
                    defaultValue: string = "",
                    noResponseIsSuccess: boolean = false): Promise<string> {
    const fnid: string = "runCompiler";
    const start: number = performance.now();

    let output: string = defaultValue;

    try {
      fs.writeFileSync(this.tmpFile.name, text);

      let lfortranPath: string | null = settings.compiler.lfortranPath;
      if (lfortranPath === "lfortran" || !(await this.checkPathExistsAndIsExecutable(lfortranPath))) {
        lfortranPath = await which("lfortran", { nothrow: true });
        this.logger.debug(
          LFortranCLIAccessor.LOG_CONTEXT,
          "lfortranPath = %s",
          lfortranPath);
      }

      if (lfortranPath === null) {
        this.logger.error(
          LFortranCLIAccessor.LOG_CONTEXT,
          "Failed to locate lfortran, please specify its path in the configuration.");
        return output;
      }

      try {
        try {
          fs.accessSync(lfortranPath, fs.constants.X_OK);
          this.logger.debug(
            LFortranCLIAccessor.LOG_CONTEXT,
            "[%s] is executable",
            lfortranPath);
        } catch (err) {
          this.logger.error(
            LFortranCLIAccessor.LOG_CONTEXT,
            "[%s] is NOT executable",
            lfortranPath);
          this.logger.error(LFortranCLIAccessor.LOG_CONTEXT, err);
        }

        params = params.concat([this.tmpFile.name]);

        let escapedCommand: string | undefined;
        let commandStart: number | undefined;
        if (this.logger.isBenchmarkEnabled() || this.logger.isDebugEnabled()) {
          escapedCommand = shellescape([lfortranPath].concat(params));
          commandStart = performance.now();
        }

        const response = spawnSync(lfortranPath, params, {
          encoding: "utf-8",
          stdio: "pipe"
        });

        this.logger.benchmark(
          LFortranCLIAccessor.LOG_CONTEXT,
          escapedCommand as string,
          commandStart as number);

        if (this.logger.isDebugEnabled()) {
          this.logger.debug(
            LFortranCLIAccessor.LOG_CONTEXT,
            "`%s` yielded status=%s, signal=%s, response=%s",
            escapedCommand, response.status, response.signal,
            JSON.stringify(
              response,
              undefined,
              this.logger.indentSize
            )
          );
        }

        if (response.error) {
          if (response.stderr) {
            output = response.stderr.toString();
          } else {
            this.logger.error(
              LFortranCLIAccessor.LOG_CONTEXT,
              "Failed to get stderr from lfortran");
          }
        } else if (response.stderr) {
          output = response.stderr.toString();
        } else {
          if (response.stdout) {
            output = response.stdout.toString();
          } else if (!noResponseIsSuccess) {
            this.logger.error(
              LFortranCLIAccessor.LOG_CONTEXT,
              "Failed to get stdout from lfortran");
          } else {
            this.logger.debug(
              LFortranCLIAccessor.LOG_CONTEXT,
              "lfortran responded successfully with an empty string.");
          }
        }
      } catch (compileError: any) {
        if (compileError.stderr) {
          output = compileError.stderr;
        } else {
          output = compileError.stdout;
        }
        if (compileError.signal !== null) {
          this.logger.error(
            LFortranCLIAccessor.LOG_CONTEXT,
            "Compilation failed.");
        }
        throw compileError;
      }
    } catch (error: any) {
      this.logger.error(LFortranCLIAccessor.LOG_CONTEXT, error);
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logger.benchmarkAndTrace(
        LFortranCLIAccessor.LOG_CONTEXT,
        fnid, start,
        [
          "settings", settings,
          "params", params,
          "text", text,
          "defaultValue", defaultValue,
          "noResponseIsSuccess", noResponseIsSuccess,
        ],
        output
      );
    }

    return output;
  }

  async showDocumentSymbols(uri: string,
                            text: string,
                            settings: LFortranSettings): Promise<SymbolInformation[]> {
    const fnid: string = "showDocumentSymbols";
    const start: number = performance.now();

    const flags = ["--show-document-symbols", "--continue-compilation"];
    if (settings.compiler.flags !== "") {
      flags.push(settings.compiler.flags);
    }
    const stdout = await this.runCompiler(settings, flags, text, "[]");

    let symbols: SymbolInformation[];

    try {
      symbols = JSON.parse(stdout);
    } catch (error) {
      this.logger.warn(
        LFortranCLIAccessor.LOG_CONTEXT,
        "Failed to parse response: %s",
        stdout);
      this.logger.warn(LFortranCLIAccessor.LOG_CONTEXT, error);
      symbols = [];
    }

    if (Array.isArray(symbols)) {
      for (let i = 0, k = symbols.length; i < k; i++) {
        const symbol: SymbolInformation = symbols[i];

        const location: Location = symbol.location;
        location.uri = uri;

        const range: Range = location.range;

        const start: Position = range.start;
        start.character--;

        const end: Position = range.end;
        end.character--;
      }
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logger.benchmarkAndTrace(
        LFortranCLIAccessor.LOG_CONTEXT,
        fnid, start,
        [
          "uri", uri,
          "text", text,
          "settings", settings,
        ],
        symbols
      );
    }
    return symbols;
  }

  async lookupName(uri: string,
                   text: string,
                   line: number,
                   column: number,
                   settings: LFortranSettings): Promise<DefinitionLink[]> {
    const fnid: string = "lookupName";
    const start: number = performance.now();

    const definitions: DefinitionLink[] = [];

    try {
      const flags = [
        "--lookup-name",
        "--line=" + (line + 1),
        "--column=" + (column + 1),
        "--continue-compilation"
      ];
      if (settings.compiler.flags !== "") {
        flags.push(settings.compiler.flags);
      }
      const stdout = await this.runCompiler(settings, flags, text, "[]");
      const results = JSON.parse(stdout);
      for (let i = 0, k = results.length; i < k; i++) {
        const location = results[i].location;
        if (location !== undefined) {
          const range: Range = location.range;

          const start: Position = range.start;
          start.character--;

          const end: Position = range.end;
          end.character--;

          definitions.push({
            targetUri: uri,
            targetRange: range,
            targetSelectionRange: range
          });

          break;
        }
      }
    } catch (error: any) {
      this.logger.error(
        LFortranCLIAccessor.LOG_CONTEXT,
        "Failed to lookup name at line=%d, column=%d",
        line, column);
      this.logger.error(LFortranCLIAccessor.LOG_CONTEXT, error);
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logger.benchmarkAndTrace(
        LFortranCLIAccessor.LOG_CONTEXT,
        fnid, start,
        [
          "uri", uri,
          "text", text,
          "line", line,
          "column", column,
          "settings", settings,
        ],
        definitions
      );
    }

    return definitions;
  }

  async showErrors(uri: string,
                   text: string,
                   settings: LFortranSettings): Promise<Diagnostic[]> {
    const fnid: string = "showErrors";
    const start: number = performance.now();

    const diagnostics: Diagnostic[] = [];
    let stdout: string | null = null;
    try {
      const flags = ["--show-errors", "--continue-compilation"];
      if (settings.compiler.flags !== "") {
        flags.push(settings.compiler.flags);
      }
      stdout =
        await this.runCompiler(settings, flags, text, "[]", true);
      if (stdout.length > 0) {
        let results: ErrorDiagnostics;
        try {
          results = JSON.parse(stdout);
        } catch (error: any) {
          // FIXME: Remove this repair logic once the respective bug has been
          // fixed (lfortran/lfortran issue #5525)
          // ----------------------------------------------------------------
          this.logger.warn(
            LFortranCLIAccessor.LOG_CONTEXT,
            "Failed to parse response, attempting to repair and re-parse it.");
          const repaired: string = stdout.substring(0, 28) + "{" + stdout.substring(28);
          try {
            results = JSON.parse(repaired);
            this.logger.log(
              LFortranCLIAccessor.LOG_CONTEXT,
              "Repair succeeded, see: https://github.com/lfortran/lfortran/issues/5525");
          } catch {
            this.logger.error(
              LFortranCLIAccessor.LOG_CONTEXT,
              "Failed to repair response");
            throw error;
          }
        }
        if (results?.diagnostics) {
          const k = Math.min(results.diagnostics.length, settings.maxNumberOfProblems);
          for (let i = 0; i < k; i++) {
            const diagnostic: Diagnostic = results.diagnostics[i];
            diagnostic.source = "lfortran-lsp";
            diagnostic.range.start.character--;
            diagnostics.push(diagnostic);
          }
        }
      }
    } catch (error: any) {
      this.logger.error(
        LFortranCLIAccessor.LOG_CONTEXT,
        "Failed to show errors");
      if (stdout !== null) {
        this.logger.error(
          LFortranCLIAccessor.LOG_CONTEXT,
          "Failed to parse response: %s",
          stdout);
      }
      this.logger.error(LFortranCLIAccessor.LOG_CONTEXT, error);
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logger.benchmarkAndTrace(
        LFortranCLIAccessor.LOG_CONTEXT,
        fnid, start,
        [
          "uri", uri,
          "text", text,
          "settings", settings,
        ],
        diagnostics
      );
    }
    return diagnostics;
  }

  async renameSymbol(uri: string,
                     text: string,
                     line: number,
                     column: number,
                     newName: string,
                     settings: LFortranSettings): Promise<TextEdit[]> {
    const fnid: string = "renameSymbol";
    const start: number = performance.now();

    const edits: TextEdit[] = [];
    try {
      const flags = [
        "--rename-symbol",
        "--line=" + (line + 1),
        "--column=" + (column + 1),
        "--continue-compilation"
      ];
      if (settings.compiler.flags !== "") {
        flags.push(settings.compiler.flags);
      }
      const stdout = await this.runCompiler(settings, flags, text, "[]");
      const obj = JSON.parse(stdout);
      for (let i = 0, k = obj.length; i < k; i++) {
        const location = obj[i].location;
        if (location) {
          const range: Range = location.range;

          const start: Position = range.start;
          start.character--;

          const end: Position = range.end;
          end.character--;

          const edit: TextEdit = {
            range: range,
            newText: newName,
          };

          edits.push(edit);
        }
      }
    } catch (error: any) {
      this.logger.error(
        LFortranCLIAccessor.LOG_CONTEXT,
        "Failed to rename symbol at line=%d, column=%d",
        line, column);
      this.logger.error(LFortranCLIAccessor.LOG_CONTEXT, error);
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logger.benchmarkAndTrace(
        LFortranCLIAccessor.LOG_CONTEXT,
        fnid, start,
        [
          "uri", uri,
          "text", text,
          "line", line,
          "column", column,
          "newName", newName,
          "settings", settings,
        ],
        edits
      );
    }

    return edits;
  }
}
