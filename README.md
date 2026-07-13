# Kyo Tools

Bộ công cụ toàn diện cho Cursor & VS Code — phân tích code, review chất lượng, và thiết lập AI workspace ngay trong editor.

## Tính năng

### Phân tích Code

Quét toàn bộ thư mục để tìm vấn đề tiềm ẩn. Hỗ trợ **TypeScript, JavaScript, React, Python, Java**.

- **Code chết** — file không được import, module mồ côi, export không dùng đến
- **Code trùng lặp** — phát hiện block giống hệt (exact) hoặc cùng cấu trúc (structural), kèm gợi ý tách shared module
- **File / function quá lớn** — cảnh báo khi vượt ngưỡng LOC hoặc tham số, kèm đề xuất refactor
- **Copy cho AI** — mỗi block trùng lặp có nút copy prompt refactor để paste thẳng vào chat AI

Cấu hình ngưỡng qua `kyo-tools.codeAnalyze.*` settings.

### Pre-Merge Review

Quality gate trước khi merge. Chọn branch để so sánh với branch hiện tại — chỉ quét **dòng thêm/sửa** từ merge-base, không quét toàn bộ repo.

| Ngôn ngữ      | Cảnh báo                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| JS/TS/React   | `console.log`, `debugger`, TODO/FIXME, code bị comment, import thừa, `any`, `@ts-ignore`, unsafe assertion, inline JSX function |
| Python        | `print()`, bare `except:`, `eval`/`exec`, dynamic import, `Any` typing   |
| Java          | `System.out.println`, empty catch, raw type, reflection                  |
| Chung         | Hardcoded secret, dependency mới, lockfile thay đổi                      |

Issue phân loại theo **Critical / Warning / Info**, click để jump tới dòng code.

### Code Graph

Xây dựng đồ thị phụ thuộc cho một file: danh sách dependency, danh sách file phụ thuộc ngược (import scan + Reference Provider), và các package bên ngoài. Hỗ trợ path alias từ `tsconfig` / `jsconfig`. Click node để mở rộng.

### Code Dashboard

Thống kê code theo ngôn ngữ bằng `cloc`, biểu đồ phân bổ, top file lớn nhất / nhỏ nhất. Kèm **git stats** 30 ngày gần nhất: số dòng thêm, xóa, net theo ngày, scope theo thư mục được chọn.

### Organize Imports

Sắp xếp import hàng loạt cho tất cả file `ts`, `tsx`, `js`, `jsx`, `mjs`, `cjs`, `vue` trong thư mục. Panel tiến trình với tab Updated / Unchanged / Failed.

### Init AI Template

Khởi tạo AI tooling cho workspace chỉ với một lệnh:

| Thành phần      | Cài đặt                                                             |
| --------------- | ------------------------------------------------------------------- |
| **GitNexus**    | MCP server + skills, tự động index codebase                         |
| **Caveman lite**| Rule Cursor cho phản hồi ngắn gọn, `alwaysApply`                    |
| **Ponytail**    | Rule Cursor YAGNI / minimal-diff, `alwaysApply`                     |

File có sẵn sẽ hỏi trước khi ghi đè.

## Yêu cầu

- **Cursor / VS Code** `^1.105.0`
- **Code Dashboard** cần `cloc` (`brew install cloc`)
- **Init AI Template** cần Node.js + mạng

## Cài đặt

Tải từ [VS Code Marketplace](#) hoặc cài thủ công:

```bash
yarn install:local
```

## Settings

| Setting                                   | Mặc định | Mô tả                                    |
| ----------------------------------------- | :------: | ---------------------------------------- |
| `kyo-tools.codeAnalyze.duplicateMinLines` | 6        | Số dòng tối thiểu để phát hiện code trùng |
| `kyo-tools.codeAnalyze.largeFileLoc`      | 300      | Cảnh báo khi file vượt quá số dòng này   |
| `kyo-tools.codeAnalyze.largeFunctionLoc`  | 80       | Cảnh báo khi function vượt quá số dòng này |
| `kyo-tools.codeAnalyze.largeFunctionParams` | 5      | Cảnh báo khi function có nhiều hơn số tham số này |

Xem đầy đủ settings trong `kyo-tools.codeAnalyze.*`.

## Phát triển

Xem [docs/development.md](docs/development.md).
