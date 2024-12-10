// @ts-expect-error: next-line
import { assert } from "chai";

// import the webdriver and the high level browser wrapper
import {
  EditorView,
  InputBox,
  QuickPickItem,
  TextEditor,
  VSBrowser,
  WebDriver,
  Workbench,
} from "vscode-extension-tester";

import {
  CommonState,
  initState,
} from "./common";

const fileName: string = "issue21.f90";

let browser: VSBrowser;
let driver: WebDriver;
let workbench: Workbench;
let editorView: EditorView;
let editor: TextEditor;

before(async () => {
  const state: CommonState = await initState();
  browser = state.browser;
  driver = state.driver;
  workbench = state.workbench;
  editorView = state.editorView;
});

// Create a Mocha suite
describe(fileName, () => {

  beforeEach(async () => {
    await browser.openResources(`./integ/issues/${fileName}`);
    editor = (await editorView.openEditor(fileName)) as TextEditor;
  });

  afterEach(async () => {
    await workbench.executeCommand("revert file");
    await editorView.closeEditor(fileName);
    await driver.actions().clear();
  });

  describe('When I begin to type a command with `@`', () => {
    it('should provide me with a list of document symbols', async () => {
      const prompt: InputBox = await workbench.openCommandPrompt() as InputBox;
      await prompt.setText('@');
      const quickPicks: QuickPickItem[] = await prompt.getQuickPicks();
      const labels: string[] =
        await Promise.all(quickPicks.map(async (q) => await q.getLabel()));
      let superset: string[] | Set<string> = [
        " expr2",
        " x",
      ];
      try {
        assert.deepEqual(labels, superset);
      } catch {
        console.warn("Failed to exact-match against the suggestion list, checking if the results are a subset of the expected suggestions (such as if the window resolution is too small to display the entire list).")
        superset = new Set<string>(superset);
        assert.isNotEmpty(labels);
        assert.isTrue(
          labels.reduce((acc, label) => acc && (superset as Set<string>).has(label), true),
          `Expected ${labels} to be a subset of ${superset}`);
      }
    });

    describe('when there is an error', () => {
      it('should provide me with the same list of document symbols', async () => {
        await editor.setCursor(7, 11);
        await editor.typeText('x');
        const prompt: InputBox = await workbench.openCommandPrompt() as InputBox;
        await prompt.setText('@');
        const quickPicks: QuickPickItem[] = await prompt.getQuickPicks();
        const labels: string[] =
          await Promise.all(quickPicks.map(async (q) => await q.getLabel()));
        let superset: string[] | Set<string> = [
          " expr2",
          " x",
        ];
        try {
          assert.deepEqual(labels, superset);
        } catch {
          console.warn("Failed to exact-match against the suggestion list, checking if the results are a subset of the expected suggestions (such as if the window resolution is too small to display the entire list).")
          superset = new Set<string>(superset);
          assert.isNotEmpty(labels);
          assert.isTrue(
            labels.reduce((acc, label) => acc && (superset as Set<string>).has(label), true),
            `Expected ${labels} to be a subset of ${superset}`);
        }
      });
    });
  });
});
