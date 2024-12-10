import { Key } from 'selenium-webdriver';

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
  assertHasLines,
  CommonState,
  getCompletionItems,
  getErrorAlert,
  getHighlightedText,
  initState,
  renameSymbol,
  triggerHoverAndGetText,
  UICompletionItem,
} from "./common";

const fileName: string = "function_call1.f90";

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
    await browser.openResources(`./lfortran/tests/${fileName}`);
    editor = (await editorView.openEditor(fileName)) as TextEditor;
  });

  afterEach(async () => {
    await workbench.executeCommand("revert file");
    await editorView.closeEditor(fileName);
    await driver.actions().clear();
  });

  describe('When I type "m"', () => {
    it('should present me with "module_function_call1" and its definition.', async () => {
      await editor.setCursor(20, 33);
      await editor.typeText('\nm');
      const items: UICompletionItem[] = await getCompletionItems(driver) as UICompletionItem[];
      assert.isDefined(items);
      assert.lengthOf(items, 1);
      const item: UICompletionItem = items[0];
      assert.equal(item.label, "module_function_call1");
      assert.isTrue(item.isSelected);
      assertHasLines(item, [
        "module module_function_call1",
        "    type :: softmax",
        "    contains",
        "      procedure :: eval_1d",
        "    end type softmax",
        "  contains",
        "  ",
        "    pure function eval_1d(self, x) result(res)",
        "      class(softmax), intent(in) :: self",
        "      real, intent(in) :: x(:)",
        "      real :: res(size(x))",
        "    end function eval_1d",
        "  ",
        "    pure function eval_1d_prime(self, x) result(res)",
        "      class(softmax), intent(in) :: self",
        "      real, intent(in) :: x(:)",
        "      real :: res(size(x))",
        "      res = self%eval_1d(x)",
        "    end function eval_1d_prime",
        "end module module_function_call1",
      ]);
    });
  });

  describe('When I type "e"', () => {
    it('should present me with "eval_1d", "eval_1d_prime" and their definitions.', async () => {
      await editor.setCursor(20, 33);
      await editor.typeText('\ne');
      let items: UICompletionItem[] = await getCompletionItems(driver) as UICompletionItem[];
      assert.isDefined(items);
      assert.lengthOf(items, 2);

      let item: UICompletionItem = items[0];
      assert.equal(item.label, "eval_1d");
      assert.isTrue(item.isSelected);
      assertHasLines(item, [
        "pure function eval_1d(self, x) result(res)",
        "      class(softmax), intent(in) :: self",
        "      real, intent(in) :: x(:)",
        "      real :: res(size(x))",
        "    end function eval_1d",
      ]);

      item = items[1];
      assert.equal(item.label, "eval_1d_prime");
      assert.isFalse(item.isSelected);

      await driver.actions().clear();  // necessary for the key-down event
      await driver.actions().sendKeys(Key.DOWN).perform();
      items = await getCompletionItems(driver) as UICompletionItem[];
      assert.isDefined(items);
      assert.lengthOf(items, 2);

      item = items[0];
      assert.equal(item.label, "eval_1d");
      assert.isFalse(item.isSelected);

      item = items[1];
      assert.equal(item.label, "eval_1d_prime");
      assert.isTrue(item.isSelected);
      assertHasLines(item, [
        "pure function eval_1d_prime(self, x) result(res)",
        "      class(softmax), intent(in) :: self",
        "      real, intent(in) :: x(:)",
        "      real :: res(size(x))",
        "      res = self%eval_1d(x)",
        "    end function eval_1d_prime",
      ]);
    });
  });

  describe('When I hover over "self%eval_1d"', () => {
    it('should display the definition of "eval_1d"', async () => {
      await editor.setCursor(18, 22);
      const hoverText: string = await triggerHoverAndGetText(driver, workbench);
      assert.isDefined(hoverText);
      assert.equal(hoverText, [
        "pure function eval_1d(self, x) result(res)",
        "      class(softmax), intent(in) :: self",
        "      real, intent(in) :: x(:)",
        "      real :: res(size(x))",
        "    end function eval_1d",
      ].join("\n"));
    });
  });

  describe('When I go to the definition of "self%eval_1d"', () => {
    it('should move the cursor to line 8, column 5.', async () => {
      await editor.setCursor(18, 22);
      await workbench.executeCommand("Go To Definition");
      const [line, column] = await editor.getCoordinates();
      assert.equal(line, 8);
      assert.equal(column, 5);
    });
  });

  describe('When I rename eval_1d to foo', () => {
    it('should rename all the respective symbols', async () => {
      await editor.setCursor(18, 22);  // hover over "eval_1d"
      await renameSymbol(driver, "foo");
      const text: string = await editor.getText();
      assert.equal(text, [
        "module module_function_call1",
        "    type :: softmax",
        "    contains",
        "      procedure :: foo",
        "    end type softmax",
        "  contains",
        "  ",
        "    pure function foo(self, x) result(res)",
        "      class(softmax), intent(in) :: self",
        "      real, intent(in) :: x(:)",
        "      real :: res(size(x))",
        "    end function foo",
        "  ",
        "    pure function eval_1d_prime(self, x) result(res)",
        "      class(softmax), intent(in) :: self",
        "      real, intent(in) :: x(:)",
        "      real :: res(size(x))",
        "      res = self%foo(x)",
        "    end function eval_1d_prime",
        "end module module_function_call1",
        "",
      ].join("\n"));
    });
  });

  describe('When I introduce an error', () => {
    it('should notify me of the issue.', async () => {
      await editor.setCursor(21, 1);
      await editor.typeText("error");
      const errorMessage: string = await getErrorAlert(driver);
      assert.equal(
        errorMessage,
        "Statement or Declaration expected inside program, found Variable name");
    });
  });

  describe('When I begin to type a command with `@`', () => {
    it('should provide me with a list of document symbols', async () => {
      const prompt: InputBox = await workbench.openCommandPrompt() as InputBox;
      await prompt.setText('@');
      const quickPicks: QuickPickItem[] = await prompt.getQuickPicks();
      const labels: string[] =
        await Promise.all(quickPicks.map(async (q) => await q.getLabel()));
      let superset: string[] | Set<string> = [
        " module_function_call1",
        " softmax",
        " eval_1d",
        " self",
        " x",
        " res",
        " eval_1d_prime",
        " self",
        " x",
        " res",
        " 1_eval_1d",
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

  describe('When I navigate over "eval_1d"', () => {
    it('should highlight all its instances', async () => {
      await editor.setCursor(18, 22);
      await workbench.executeCommand("Trigger Symbol Highlight");
      const highlights: string[] = await getHighlightedText(driver);
      assert.isNotEmpty(highlights);
      assert.isTrue(highlights.every(highlight => highlight === "eval_1d"));
    });
  });
});
