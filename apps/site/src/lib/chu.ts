/**
 * Chuỗi chỉ gồm ký tự ASCII in được (U+0020–U+007E). Chỉ chuỗi như vậy mới được đặt trong
 * JetBrains Mono: font này thiếu dải Latin Extended Additional nên dấu tiếng Việt lệch hoặc rơi
 * font (spec 22/09 mục 4.2). Nhãn có dấu dùng Be Vietnam Pro.
 */
export const laAscii = (chu: string): boolean => /^[\x20-\x7e]+$/.test(chu);
