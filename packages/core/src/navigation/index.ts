// biome-ignore-all assist/source/organizeImports: ĐỪNG sắp lại theo alphabet. Thứ tự các dòng
// `export *` ở barrel này quyết định thứ tự nối module trong bundle, và do đó quyết định gzip
// nén được bao nhiêu. Đo 16/09/2026: sắp theo alphabet làm @mapslibvn/core từ 19.98 kB lên
// 20.19 kB — vượt trần 20 kB trong .size-limit.json và chặn build. Thứ tự hiện tại còn nhóm
// theo vùng chức năng cho người đọc.
export * from './types';
export * from './geometry';
export * from './progress';
export * from './snap';
export * from './announce';
export * from './simulate';
export * from './navigator';
export * from './route-features';
export * from './heading';
