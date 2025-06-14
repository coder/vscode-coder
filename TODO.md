# VSCode Coder Extension - Testing Status & Coverage Roadmap

## Current Status ✅

**Test Infrastructure Complete:** 17/17 source files have test files  
**Total Tests:** 345 tests passing across 17 test files  
**Test Framework:** Vitest with comprehensive mocking infrastructure  
**Overall Line Coverage:** 70.43% (Target: 100%)

---

## Test Coverage Analysis 📊

### 🎯 **100% Coverage Achieved (4 files)**
| File | Lines | Status |
|------|-------|---------|
| `api-helper.ts` | 100% | ✅ Perfect coverage |
| `api.ts` | 100% | ✅ Perfect coverage |
| `inbox.ts` | 100% | ✅ Perfect coverage |
| `proxy.ts` | 100% | ✅ Perfect coverage |

### 🟢 **High Coverage (90%+ lines, 5 files)**
| File | Lines | Tests | Remaining Gaps |
|------|-------|-------|----------|
| `workspaceMonitor.ts` | 98.65% | 19 | Lines 158-159, 183 |
| `sshConfig.ts` | 96.21% | 14 | Lines 175, 251, 286-287 |
| `extension.ts` | 93.44% | 26 | Lines 271-272, 320-321 |
| `featureSet.ts` | 90.9% | 2 | Lines 18-20 |
| `cliManager.ts` | 90.05% | 6 | Lines 140, 152, 165, 167 |

### 🟡 **Medium Coverage (70-90% lines, 4 files)**
| File | Lines | Tests | Uncovered Lines |
|------|-------|-------|----------|
| `storage.ts` | 89.19% | 55 | Lines 373-374, 390-410 |
| `sshSupport.ts` | 88.78% | 9 | Lines 38, 78-79, 89-90 |
| `headers.ts` | 85.08% | 9 | Lines 33-47, 90-91 |
| `util.ts` | 79.19% | 8 | Lines 127-129, 148-149 |

### 🔴 **Major Coverage Gaps (< 70% lines, 4 files)**
| File | Lines | Tests | Uncovered Lines |
|------|-------|-------|----------|
| **`remote.ts`** | **25.4%** | 17 | Lines 264-996, 1009-1038 (775 lines!) |
| **`workspacesProvider.ts`** | **65.12%** | 27 | Lines 468-485, 521-539 |
| **`error.ts`** | **64.6%** | 11 | Lines 145-166, 171-178 |
| **`commands.ts`** | **56.01%** | 12 | Lines 550-665, 715-723 |

---

## Next Steps - Coverage Improvement 🎯

### **Phase 1: Critical Coverage Gaps (High Priority)**

#### 1. **`remote.ts` - Critical Priority** 🚨
- **Current:** 25.4% lines covered (Major problem!)
- **Missing:** SSH connection setup, workspace lifecycle, process management
- **Action:** Expand existing 17 tests to cover:
  - Complete `setup()` method flow
  - `maybeWaitForRunning()` scenarios
  - SSH config generation and validation
  - Process monitoring and error handling

#### 2. **`commands.ts` - High Priority** 🔸
- **Current:** 56.01% lines covered  
- **Missing:** Command implementations, user interaction flows
- **Action:** Expand existing 12 tests to cover all command handlers

#### 3. **`workspacesProvider.ts` - High Priority** 🔸
- **Current:** 65.12% lines covered
- **Missing:** Tree refresh logic, agent selection, error scenarios
- **Action:** Expand existing 27 tests for complete tree operations

#### 4. **`error.ts` - Medium Priority** 🔸
- **Current:** 64.6% lines covered
- **Missing:** Error transformation scenarios, logging paths
- **Action:** Expand existing 11 tests for all error types

### **Phase 2: Polish Existing High Coverage Files**
- **Target:** Get 90%+ files to 95%+ coverage
- **Files:** `extension.ts`, `storage.ts`, `headers.ts`, `util.ts`, `sshSupport.ts`
- **Effort:** Low (minor gap filling)

### **Phase 3: Integration & Edge Case Testing**
- **Cross-module integration scenarios**
- **Complex error propagation testing**  
- **Performance and timeout scenarios**

---

## Success Metrics 🎯

### **Completed ✅**
- [x] **17/17** source files have test files
- [x] **345** tests passing (zero flaky tests)
- [x] **4/17** files at 100% line coverage
- [x] **9/17** files at 85%+ line coverage

### **Target Goals 🎯**
- [ ] **70% → 100%** overall line coverage (updated goal)
- [ ] **`remote.ts`** from 25% → 100% coverage (critical)
- [ ] **17/17** files at 100% line coverage
- [ ] **100%** branch coverage across all files

---

## Recent Achievements 🏆

✅ **Test Infrastructure Complete** (Just completed)
- Created test files for all 17 source files
- Fixed workspacesProvider test failures through strategic refactoring  
- Added comprehensive tests for proxy, inbox, and workspaceMonitor
- Established robust mocking patterns for VSCode APIs

✅ **Perfect Coverage Achieved** (4 files)
- `api-helper.ts`, `api.ts`, `inbox.ts`, `proxy.ts` at 100% coverage
- Strong foundation with core API and utility functions fully tested

---

## Priority Action Items 📋

**Immediate - 100% Coverage Sprint:**

1. 🚨 **`remote.ts`** (25.4% → 100%) - 775 uncovered lines
   - Complete SSH setup and workspace lifecycle tests
   - Error handling and process management scenarios
   - Mock all VSCode API interactions

2. 🔸 **`commands.ts`** (56.01% → 100%) - ~340 uncovered lines
   - Test all command implementations
   - User interaction flows and error cases

3. 🔸 **`error.ts`** (64.6% → 100%) - ~60 uncovered lines
   - Error transformation scenarios
   - Logging and telemetry paths

4. 🔸 **`workspacesProvider.ts`** (65.12% → 100%) - ~200 uncovered lines
   - Tree operations and refresh logic
   - Agent selection scenarios

5. 📈 **Medium Coverage Files** (70-90% → 100%)
   - `util.ts` (79.19% → 100%)
   - `headers.ts` (85.08% → 100%)  
   - `sshSupport.ts` (88.78% → 100%)
   - `storage.ts` (89.19% → 100%)

6. ✨ **Final Polish** (90%+ → 100%)
   - `cliManager.ts` (90.05% → 100%)
   - `featureSet.ts` (90.9% → 100%)
   - `extension.ts` (93.44% → 100%)
   - `sshConfig.ts` (96.21% → 100%)
   - `workspaceMonitor.ts` (98.65% → 100%)

7. 🌿 **Branch Coverage**
   - `api.ts` (98.52% → 100% branches)
   - `proxy.ts` (95.12% → 100% branches)

**Target:** Achieve **100% line and branch coverage** across all files.