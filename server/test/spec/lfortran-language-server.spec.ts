import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  _Connection,
  DefinitionLink,
  DefinitionParams,
  Diagnostic,
  DiagnosticSeverity,
  DidChangeConfigurationParams,
  DocumentHighlight,
  DocumentHighlightParams,
  DocumentSymbolParams,
  Hover,
  HoverParams,
  InitializeParams,
  Location,
  MarkedString,
  Position,
  Range,
  RemoteWorkspace,
  RenameParams,
  SymbolInformation,
  SymbolKind,
  TextDocumentChangeEvent,
  TextDocumentPositionParams,
  TextDocuments,
  WorkspaceEdit,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";

import { LFortranSettings } from '../../src/lfortran-types';

import { LFortranCLIAccessor } from "../../src/lfortran-accessors";

import { LFortranLanguageServer } from "../../src/lfortran-language-server";

import { settings } from "./lfortran-common";

import { Logger } from "../../src/logger";

import * as sinon from "sinon";
import { stubInterface } from "ts-sinon";

import { assert } from "chai";

import "mocha";

describe("LFortranLanguageServer", () => {
  let logger: Logger;
  let lfortran: LFortranCLIAccessor;
  let connection: _Connection;
  let documents: TextDocuments<TextDocument>;
  let server: LFortranLanguageServer;
  let document: TextDocument;

  const uri: string = __filename;

  beforeEach(() => {
    logger = new Logger(settings);
    lfortran = new LFortranCLIAccessor(logger);

    connection = stubInterface<_Connection>();
    connection.workspace = stubInterface<RemoteWorkspace & PWorkspace>();
    connection.workspace.getConfiguration.returns(settings);

    document = stubInterface<TextDocument>();
    document.uri = uri;

    documents = stubInterface<TextDocuments<TextDocument>>();
    documents.get.returns(document);
    documents.all.returns([document]);

    server = new LFortranLanguageServer(
      lfortran,
      connection,
      documents,
      logger,
      settings
    );
    server.hasDiagnosticRelatedInformationCapability = true;
  });

  afterEach(() => {
    lfortran.cleanUp();
  });

  describe("onInitialize", () => {
    const params: InitializeParams = {
      processId: null,
      rootUri: uri,
      workspaceFolders: null,
      capabilities: {}
    };

    it("provides document symbols", () => {
      const result = server.onInitialize(params);
      assert.isTrue(result.capabilities.documentSymbolProvider);
    });

    it("provides definitions", () => {
      const result = server.onInitialize(params);
      assert.isTrue(result.capabilities.definitionProvider);
    });
  });

  // describe("onInitialized", () => {
  //   // nothing important to test, here ...
  // });

  describe("onDocumentSymbol", () => {
    const request: DocumentSymbolParams = {
      textDocument: {
        uri: uri
      }
    };

    it("Returns all the symbols", async () => {
      const response: Record<string, any>[] = [
        {
          name: "baz",
          kind: SymbolKind.Function,
          filename: uri,
          location: {
            uri: "uri",
            range: {
              start: {
                line: 1,
                character: 1
              },
              end: {
                line: 1,
                character: 5
              }
            }
          }
        },
        {
          name: "qux",
          kind: SymbolKind.Function,
          filename: uri,
          location: {
            uri: "uri",
            range: {
              start: {
                line: 4,
                character: 15
              },
              end: {
                line: 4,
                character: 25
              }
            }
          }
        },
      ];

      const stdout = JSON.stringify(response);
      sinon.stub(lfortran, "runCompiler").resolves(stdout);
      document.getText.returns("");

      const expected: Record<string, any>[] = [
        {
          name: "baz",
          kind: SymbolKind.Function,
          filename: uri,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 1
              },
              end: {
                line: 0,
                character: 5
              }
            }
          }
        },
        {
          name: "qux",
          kind: SymbolKind.Function,
          filename: uri,
          location: {
            uri: uri,
            range: {
              start: {
                line: 3,
                character: 15
              },
              end: {
                line: 3,
                character: 25
              }
            }
          }
        },
      ];

      for (const symbol of expected) {
        const range = symbol.location.range;
        range.start.character--;
        range.end.character--;
      }

      const actual = await server.onDocumentSymbol(request);
      assert.deepEqual(actual, expected);
    });

    it("Returns nothing when the document has not been defined", async () => {
      const actual = await server.onDocumentSymbol(request);
      assert.isNull(actual);
    });
  });

  describe("onDefinition", () => {
    const request: DefinitionParams = {
      textDocument: {
        uri: uri
      },
      position: {
        line: 0,
        character: 42
      }
    };

    it("returns location where symbol is defined", async () => {
      const range: Range = {
        start: {
          line: 3,
          character: 12
        },
        end: {
          line: 3,
          character: 20
        }
      };

      const expected: DefinitionLink[] = [
        {
          targetUri: uri,
          targetRange: range,
          targetSelectionRange: range,
        },
      ];

      const stdout = JSON.stringify([
        {
          filename: uri,
          location: {
            range: {
              start: {
                line: 4,
                character: 12
              },
              end: {
                line: 4,
                character: 20
              }
            }
          }
        }
      ]);

      sinon.stub(lfortran, "runCompiler").resolves(stdout);
      document.getText.returns("");

      range.start.character--;
      range.end.character--;

      const actual = await server.onDefinition(request);
      assert.deepEqual(actual, expected);
    });

    it("returns nothing when the document has not been defined", async () => {
      const actual = await server.onDefinition(request);
      assert.isEmpty(actual);
    });
  });

  describe("onDidChangeConfiguration", () => {
    const updatedSettings: LFortranSettings = {
      maxNumberOfProblems: 1234,
      compiler: settings.compiler,
      log: settings.log,
    };
    const configChange: DidChangeConfigurationParams = {
      settings: {
        LFortranLanguageServer: updatedSettings
      }
    };

    it("updates the server settings", () => {
      server.onDidChangeConfiguration(configChange);
      assert.equal(server.settings.maxNumberOfProblems,
        updatedSettings.maxNumberOfProblems);
      assert.deepEqual(server.settings.compiler,
        updatedSettings.compiler);
    });

    it("re-validates the documents", () => {
      const validateTextDocument = sinon.spy(server, "validateTextDocument");
      server.onDidChangeConfiguration(configChange);
      assert.isTrue(validateTextDocument.calledOnceWith(document));
    });
  });

  describe("onDidClose", () => {
    it("removes the document from the cache", () => {
      document.getText.returns("");
      const event: TextDocumentChangeEvent<TextDocument> = {
        document: document
      };
      server.onDidClose(event);
      assert.doesNotHaveAnyKeys(server.documentSettings, [document.uri]);
    });
  });

  describe("onDidChangeContent", () => {
    it("validates document from event", () => {
      document.getText.returns("");
      const event: TextDocumentChangeEvent<TextDocument> = {
        document: document
      };
      const validateTextDocument = sinon.spy(server, "validateTextDocument");
      server.onDidChangeContent(event);
      assert.isTrue(validateTextDocument.calledOnceWith(document));
    });
  });

  describe("validateTextDocument", () => {
    it("returns the expected errors", async () => {
      const diagnostics: Diagnostic[] = [
        {
          range: {
            start: {
              line: 0,
              character: 9
            },
            end: {
              line: 2,
              character: 20
            }
          },
          severity: DiagnosticSeverity.Warning,
          source: "lfortran-lsp",
          message: "foo should be bar"
        },
        {
          range: {
            start: {
              line: 5,
              character: 12
            },
            end: {
              line: 5,
              character: 17
            }
          },
          // NOTE: Right now, the severity is hard-coded to Warning ...
          severity: DiagnosticSeverity.Warning,
          source: "lfortran-lsp",
          message: "baz should be qux"
        },
      ];

      const stdout = JSON.stringify({
        diagnostics: [
          {
            range: {
              start: {
                line: 1,
                character: 10
              },
              end: {
                line: 3,
                character: 20
              }
            },
            severity: DiagnosticSeverity.Warning,
            source: "lfortran-lsp",
            message: "foo should be bar"
          },
          {
            range: {
              start: {
                line: 6,
                character: 13
              },
              end: {
                line: 6,
                character: 17
              }
            },
            // NOTE: Right now, the severity is hard-coded to Warning ...
            severity: DiagnosticSeverity.Warning,
            source: "lfortran-lsp",
            message: "baz should be qux"
          },
        ]
      });
      sinon.stub(lfortran, "runCompiler").resolves(stdout);
      document.getText.returns("");

      await server.validateTextDocument(document);
      const sendDiagnostics = connection.sendDiagnostics;
      assert.isTrue(sendDiagnostics.calledOnceWith({ uri: uri, diagnostics }));
    });
  });

  describe("extractDefinition", () => {
    it("extracts definitions from the respective range", async () => {
      const text: string = [
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit,",
        "sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris",
        "nisi ut aliquip ex ea commodo consequat.",
        "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum",
        "dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat",
        "non proident, sunt in culpa qui officia deserunt mollit anim id est",
        "laborum."
      ].join("\n");

      document.getText.returns(text);

      const start: Position = {
        line: 0,
        character: 0,
      };

      const end: Position = {
        line: 0,
        character: 10,
      };

      const range: Range = { start, end };
      const location: Location = { uri, range };

      let definition: string = await server.extractDefinition(location);
      assert.equal(definition, "Lorem ipsum");

      start.line = 2;
      start.character = 8;
      end.line = 5;
      end.character = 31;
      definition = await server.extractDefinition(location);
      assert.equal(definition, [
        "ad minim veniam, quis nostrud exercitation ullamco laboris",
        "nisi ut aliquip ex ea commodo consequat.",
        "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum",
        "dolore eu fugiat nulla pariatur."
      ].join("\n"));
    });
  });

  describe("index", () => {
    it("indexes empty lists of symbols", async () => {
      const symbols: SymbolInformation[] = [];
      await server.index(uri, symbols);
      const dictionary = server.dictionaries.get(uri);
      assert.isDefined(dictionary);
      const indexed: CompletionItem[] =
        Array.from(dictionary) as CompletionItem[];
      assert.isEmpty(indexed);
    });

    it("indexes singleton lists of symbols", async () => {
      const text: string = "def foo; def bar; def baz; def qux; def quo;";
      document.getText.returns(text);

      const symbols: SymbolInformation[] = [
        {
          name: "foo",
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 7,
              },
            },
          },
        },
      ];

      await server.index(uri, symbols);
      const dictionary = server.dictionaries.get(uri);
      assert.isDefined(dictionary);
      const indexed: CompletionItem[] =
        Array.from(dictionary) as CompletionItem[];
      assert.deepEqual(indexed, [
        [
          {
            label: "foo",
            kind: CompletionItemKind.Function,
            detail: "def foo;"
          },
        ],
      ]);
    });

    it("indexes lists of symbols", async () => {
      const text: string = "def foo; def bar; def baz; def qux; def quo;";
      document.getText.returns(text);

      const symbols: SymbolInformation[] = [
        {
          name: "foo",
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 7,
              },
            },
          },
        },
        {
          name: "bar",
          kind: SymbolKind.Variable,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 9,
              },
              end: {
                line: 0,
                character: 16,
              },
            },
          },
        },
        {
          name: "baz",
          kind: SymbolKind.Constant,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 18,
              },
              end: {
                line: 0,
                character: 25,
              },
            },
          },
        },
      ];

      await server.index(uri, symbols);
      const dictionary = server.dictionaries.get(uri);
      assert.isDefined(dictionary);
      const indexed: CompletionItem[] =
        Array.from(dictionary) as CompletionItem[];
      assert.deepEqual(indexed, [
        [
          {
            label: "foo",
            kind: CompletionItemKind.Function,
            detail: "def foo;"
          },
        ],
        [
          {
            label: "bar",
            kind: CompletionItemKind.Variable,
            detail: "def bar;"
          },
        ],
        [
          {
            label: "baz",
            kind: CompletionItemKind.Constant,
            detail: "def baz;"
          },
        ],
      ]);
    });
  });

  describe("extractQuery", () => {
    it("expands identifiable symbols at the given location", () => {
      const text: string = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";

      let query: string = server.extractQuery(text, 0, 0);
      assert.equal(query, "Lorem");

      query = server.extractQuery(text, 0, 25);
      assert.equal(query, "amet");

      query = server.extractQuery(text, 0, 26);  // actual text "," is just right of the word boundary
      assert.equal(query, "amet");

      query = server.extractQuery(text, 0, 27);  // actual text " "
      assert.isNull(query);
    });

    it("extracts prefix types", () => {
      const text: string = "print *, foo_'string'";

      let query: string | null = server.extractQuery(text, 0, 8);
      assert.isNull(query);

      query = server.extractQuery(text, 0, 9);
      assert.equal(query, "foo");

      query = server.extractQuery(text, 0, 10);
      assert.equal(query, "foo");

      query = server.extractQuery(text, 0, 11);
      assert.equal(query, "foo");

      query = server.extractQuery(text, 0, 12);
      assert.equal(query, "foo");

      query = server.extractQuery(text, 0, 13);
      assert.isNull(query);
    });

    it("extracts suffix types", () => {
      const text: string = "f(123.456_my_dbl) + x";

      let query: string | null = server.extractQuery(text, 0, 8);
      assert.isNull(query);

      query = server.extractQuery(text, 0, 9);
      assert.isNull(query);

      query = server.extractQuery(text, 0, 10);
      assert.equal(query, "my_dbl");

      query = server.extractQuery(text, 0, 11);
      assert.equal(query, "my_dbl");

      query = server.extractQuery(text, 0, 12);
      assert.equal(query, "my_dbl");

      query = server.extractQuery(text, 0, 13);
      assert.equal(query, "my_dbl");

      query = server.extractQuery(text, 0, 14);
      assert.equal(query, "my_dbl");

      query = server.extractQuery(text, 0, 15);
      assert.equal(query, "my_dbl");

      query = server.extractQuery(text, 0, 16);
      assert.equal(query, "my_dbl");

      query = server.extractQuery(text, 0, 17);
      assert.isNull(query);
    });
  });

  describe("onCompletion", () => {
    it("completes queries based on indexed terms", async () => {
      const text: string = "def foo; def bar; def baz; def qux; def quo; ba";
      document.getText.returns(text);

      const symbols: SymbolInformation[] = [
        {
          name: "foo",
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 7,
              },
            },
          },
        },
        {
          name: "bar",
          kind: SymbolKind.Variable,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 9,
              },
              end: {
                line: 0,
                character: 16,
              },
            },
          },
        },
        {
          name: "baz",
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 18,
              },
              end: {
                line: 0,
                character: 25,
              },
            },
          },
        },
      ];

      await server.index(uri, symbols);

      const documentPosition: TextDocumentPositionParams = {
        textDocument: {
          uri: uri,
        },
        position: {
          line: 0,
          character: 46,
        },
      };

      let actual: CompletionItem[] | CompletionList =
        server.onCompletion(documentPosition);

      if (!Array.isArray(actual)) {
        actual = (actual as CompletionList).items;
      }

      const expected: CompletionItem[] = [
        {
          label: "bar",
          kind: CompletionItemKind.Variable,
          detail: "def bar;"
        },
        {
          label: "baz",
          kind: CompletionItemKind.Function,
          detail: "def baz;"
        },
      ];

      assert.deepEqual(actual, expected);
    });
  });

  describe("onHover", () => {
    it("displays a symbol's definition", async () => {
      const text: string = "def foo; def bar; def baz; def qux; def quo; ba";
      document.getText.returns(text);

      const stdout = JSON.stringify([
        {
          filename: uri,
          location: {
            uri: "uri",
            range: {
              start: {
                line: 1,
                character: 1,
              },
              end: {
                line: 1,
                character: 8,
              },
            },
          },
        },
      ]);

      sinon.stub(lfortran, "runCompiler").resolves(stdout);

      const hoverParams: HoverParams = {
        textDocument: {
          uri: uri,
        },
        position: {
          line: 0,
          character: 5,
        }
      };

      const response: Hover = await server.onHover(hoverParams);
      const contents: MarkedString = response.contents as MarkedString;
      assert.equal(contents.language, "fortran");
      assert.equal(contents.value, "def foo;");
    });
  });

  describe("onRenameRequest", () => {
    it("should wrap the edits from lfortran within a WorkspaceEdit", async () => {
      const text: string = "foo bar baz qux";
      document.getText.returns(text);

      const newName: string = "quo";

      const results = [
        {
          kind: SymbolInformation.Function,
          location: {
            range: {
              start: {
                line: 1,
                character: 1,
              },
              end: {
                line: 1,
                character: 4,
              },
            },
            uri: "uri",
          },
          name: "foo",
        },
      ];
      const stdout = JSON.stringify(results);
      sinon.stub(lfortran, "runCompiler").resolves(stdout);

      const symbols: SymbolInformation[] = [
        {
          name: "foo",
          kind: SymbolInformation.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 3,
              },
            },
          },
        },
        {
          name: "bar",
          kind: SymbolInformation.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 4,
              },
              end: {
                line: 0,
                character: 7,
              },
            },
          },
        },
        {
          name: "baz",
          kind: SymbolInformation.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 8,
              },
              end: {
                line: 0,
                character: 11,
              },
            },
          },
        },
        {
          name: "qux",
          kind: SymbolInformation.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 12,
              },
              end: {
                line: 0,
                character: 15,
              },
            },
          },
        },
      ];

      await server.index(uri, symbols);

      const expected: WorkspaceEdit = {
        changes: {
          [uri]: [
            {
              range: {
                start: {
                  line: 0,
                  character: 0,
                },
                end: {
                  line: 0,
                  character: 3,
                },
              },
              newText: newName,
            },
          ],
        },
      };

      const params: RenameParams = {
        newName: newName,
        textDocument: document,
        position: {
          line: 0,
          character: 0,
        },
      };

      const actual: WorkspaceEdit = await server.onRenameRequest(params);
      assert.deepEqual(actual, expected);
    });
  });

  describe("onDocumentHighlight", () => {
    it("highlights symbols when they are not recognized", async () => {
      const text: string = "foo bar foo baz.foo";
      document.getText.returns(text);

      const symbols: SymbolInformation[] = [
        {
          name: "foo",
          kind: SymbolInformation.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 3,
              },
            },
          },
        },
      ];

      await server.index(uri, symbols);

      const params: DocumentHighlightParams = {
        textDocument: document,
        position: {
          line: 0,
          character: 4,
        },
      };

      const actual: DocumentHighlight[] | undefined | null = await server.onDocumentHighlight(params);
      assert.deepEqual(actual, [
        {
          range: {
            start: {
              line: 0,
              character: 4,
            },
            end: {
              line: 0,
              character: 7,
            },
          },
        },
      ]);
    });

    it("highlights symbols when they are recognized", async () => {
      const text: string = "foo bar foo baz%foo foo_'str' 123.456_foo";
      document.getText.returns(text);

      const symbols: SymbolInformation[] = [
        {
          name: "foo",
          kind: SymbolInformation.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 3,
              },
            },
          },
        },
      ];

      await server.index(uri, symbols);

      const expected: DocumentHighlight[] = [
        {
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 0,
              character: 3,
            },
          },
        },
        {
          range: {
            start: {
              line: 0,
              character: 8,
            },
            end: {
              line: 0,
              character: 11,
            },
          },
        },
        {
          range: {
            start: {
              line: 0,
              character: 16,
            },
            end: {
              line: 0,
              character: 19,
            },
          },
        },
        {
          range: {
            start: {
              line: 0,
              character: 20,
            },
            end: {
              line: 0,
              character: 23,
            },
          },
        },
        {
          range: {
            start: {
              line: 0,
              character: 38,
            },
            end: {
              line: 0,
              character: 41,
            },
          },
        },
      ];

      const params: DocumentHighlightParams = {
        textDocument: document,
        position: {
          line: 0,
          character: 0,
        },
      };

      const actual: DocumentHighlight[] = await server.onDocumentHighlight(params);
      assert.isDefined(actual);
      assert.deepEqual(actual, expected);
    });
  });
});
