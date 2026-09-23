import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Thư mục build riêng của git hook (NEXT_DIST_DIR=.next-hook, xem next.config.ts). Không
    // bỏ qua thì lint quét chính mã đã đóng gói và đỏ hàng loạt — đã gặp khi push.
    ".next-hook/**",
  ]),
]);

export default eslintConfig;
