/**
 * Khai báo wildcard module chỉ hoạt động khi file KHÔNG có import/export ở top-level
 * (nếu không TS coi nó là augmentation của module đã tồn tại, không phải ambient module mới).
 * Vì vậy tách riêng khỏi env.d.ts (có `import type { Env }`).
 */
declare module '*?raw' {
  const text: string;
  export default text;
}
