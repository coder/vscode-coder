# UI Testing Patterns for VS Code Extensions

This document describes patterns for testing VS Code UI interactions without requiring manual user input.

## Overview

VS Code integration tests can pause waiting for user input when commands trigger UI elements like QuickPicks or InputBoxes. To automate these tests, we use mock UI elements with simulation capabilities.

## UI Automation Helpers

The `test-helpers.ts` file provides several UI automation utilities:

### 1. Mock InputBox with Automation

```typescript
const inputBox = createMockInputBox();

// Simulate user typing
inputBox.simulateUserInput("test value");

// Simulate pressing Enter
inputBox.simulateAccept();

// Simulate cancellation
inputBox.simulateHide();
```

### 2. Mock QuickPick with Automation

```typescript
const quickPick = createMockQuickPickWithAutomation<vscode.QuickPickItem>();

// Set items
quickPick.items = [
  { label: "Option 1" },
  { label: "Option 2" }
];

// Simulate selecting an item
quickPick.simulateItemSelection(0); // by index
// or
quickPick.simulateItemSelection({ label: "Option 1" }); // by item

// Simulate accepting the selection
quickPick.simulateAccept();
```

## Integration Test Pattern

Here's the pattern for testing commands that show UI:

```typescript
test("should handle UI interaction", async () => {
  // 1. Create mock UI elements
  const quickPick = createMockQuickPickWithAutomation();
  const inputBox = createMockInputBox();
  
  // 2. Save original VS Code methods
  const originalCreateQuickPick = vscode.window.createQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;
  
  try {
    // 3. Replace VS Code methods with mocks
    (vscode.window as any).createQuickPick = () => quickPick;
    (vscode.window as any).showInputBox = async () => {
      return new Promise((resolve) => {
        setTimeout(() => {
          inputBox.simulateUserInput("user input");
          inputBox.simulateAccept();
          resolve("user input");
        }, 10);
      });
    };
    
    // 4. Start the command
    const commandPromise = vscode.commands.executeCommand("your.command");
    
    // 5. Wait for UI to initialize
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // 6. Simulate user interactions
    quickPick.items = [{ label: "Option" }];
    quickPick.simulateItemSelection(0);
    quickPick.simulateAccept();
    
    // 7. Wait for command completion
    await commandPromise;
    
    // 8. Assert results
    assert.ok(quickPick.show.called, "Quick pick should be shown");
  } finally {
    // 9. Restore original methods
    (vscode.window as any).createQuickPick = originalCreateQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }
});
```

## Common Patterns

### Testing Login Flow

```typescript
test("should handle login with URL and token", async () => {
  const quickPick = createMockQuickPickWithAutomation();
  const inputBox = createMockInputBox();
  
  // Mock VS Code UI
  (vscode.window as any).createQuickPick = () => quickPick;
  (vscode.window as any).showInputBox = async (options) => {
    // Handle token validation if needed
    if (options.validateInput) {
      const result = await options.validateInput("test-token");
      if (result) return undefined; // Validation failed
    }
    return "test-token";
  };
  
  // Execute login
  const loginPromise = vscode.commands.executeCommand("coder.login");
  
  // Simulate URL selection
  await new Promise(resolve => setTimeout(resolve, 50));
  quickPick.items = [{ label: "https://coder.example.com" }];
  quickPick.simulateItemSelection(0);
  quickPick.simulateAccept();
  
  await loginPromise;
});
```

### Testing Cancellation

```typescript
test("should handle user cancellation", async () => {
  const quickPick = createMockQuickPickWithAutomation();
  
  (vscode.window as any).createQuickPick = () => quickPick;
  
  const commandPromise = vscode.commands.executeCommand("coder.open");
  
  await new Promise(resolve => setTimeout(resolve, 50));
  
  // Simulate user pressing Escape
  quickPick.simulateHide();
  
  try {
    await commandPromise;
  } catch (error) {
    // Command should handle cancellation gracefully
  }
});
```

### Testing Multi-Step Flows

```typescript
test("should handle multi-step wizard", async () => {
  let step = 0;
  const quickPicks = [
    createMockQuickPickWithAutomation(),
    createMockQuickPickWithAutomation()
  ];
  
  (vscode.window as any).createQuickPick = () => {
    return quickPicks[step++];
  };
  
  const commandPromise = vscode.commands.executeCommand("coder.wizard");
  
  // Step 1
  await new Promise(resolve => setTimeout(resolve, 50));
  quickPicks[0].items = [{ label: "Step 1 Option" }];
  quickPicks[0].simulateItemSelection(0);
  quickPicks[0].simulateAccept();
  
  // Step 2
  await new Promise(resolve => setTimeout(resolve, 50));
  quickPicks[1].items = [{ label: "Step 2 Option" }];
  quickPicks[1].simulateItemSelection(0);
  quickPicks[1].simulateAccept();
  
  await commandPromise;
});
```

## Best Practices

1. **Always restore original methods** - Use try/finally blocks to ensure VS Code methods are restored
2. **Add delays for UI initialization** - Use `setTimeout` to allow commands to initialize their UI
3. **Test both success and cancellation paths** - Ensure commands handle user cancellation gracefully
4. **Mock validation functions** - When testing InputBox validation, mock the validateInput callback
5. **Use type assertions carefully** - Use `(vscode.window as any)` to bypass TypeScript checks when mocking

## Debugging Tips

1. **Add console.log statements** - Log when UI elements are created and interacted with
2. **Check mock call counts** - Use `assert.ok(quickPick.show.called)` to verify UI was shown
3. **Increase timeouts** - If tests are flaky, increase the initialization delay
4. **Run tests in isolation** - Use `.only` to debug specific tests

## Common Issues

1. **Test hangs waiting for input** - Ensure you're mocking the correct VS Code method
2. **Mock not being called** - Check that the command uses the expected UI method
3. **Timing issues** - Adjust delays between command start and UI simulation
4. **Type errors** - Use type assertions when setting mock methods on vscode.window
