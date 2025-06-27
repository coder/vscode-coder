# Test Coverage Impact Analysis

Baseline coverage: 83.78%

## Test File Impact

| Test File                  | Coverage Without File | Coverage Delta | Impact   |
| -------------------------- | --------------------- | -------------- | -------- |
| api-helper.test.ts         | 83.28%                | -0.50%         | Low      |
| api.test.ts                | 78.59%                | -5.19%         | High     |
| cliManager.test.ts         | 81.58%                | -2.20%         | Medium   |
| commands.test.ts           | 88.12%                | +4.34%         | Negative |
| error.test.ts              | 81.53%                | -2.25%         | Medium   |
| extension.test.ts          | 82.75%                | -1.03%         | Low      |
| featureSet.test.ts         | 83.66%                | -0.12%         | Minimal  |
| headers.test.ts            | 82.06%                | -1.72%         | Low      |
| inbox.test.ts              | 83.69%                | -0.09%         | Minimal  |
| logger.test.ts             | 83.08%                | -0.70%         | Low      |
| proxy.test.ts              | 82.10%                | -1.68%         | Low      |
| sshConfig.test.ts          | 82.94%                | -0.84%         | Low      |
| sshSupport.test.ts         | 83.44%                | -0.34%         | Minimal  |
| storage.test.ts            | 85.80%                | +2.02%         | Negative |
| util.test.ts               | 82.12%                | -1.66%         | Low      |
| workspaceMonitor.test.ts   | 83.34%                | -0.44%         | Low      |
| workspacesProvider.test.ts | 83.92%                | +0.14%         | Negative |

## Summary

### High Impact Files (>2% coverage drop):

- **api.test.ts**: -5.19% (critical for API coverage)
- **error.test.ts**: -2.25%
- **cliManager.test.ts**: -2.20%

### Negative Impact Files (coverage increases without them):

- **commands.test.ts**: +4.34% (commands.ts has low coverage at 62.61%)
- **storage.test.ts**: +2.02% (storage.ts has low coverage at 71.01%)
- **workspacesProvider.test.ts**: +0.14%

### Low Impact Files (<2% coverage drop):

- Most other test files have minimal impact on overall coverage

### Recommendations:

1. Keep all High Impact files
2. Consider removing or significantly reducing tests in Negative Impact files
3. Low Impact files are candidates for test reduction based on test quality/value
